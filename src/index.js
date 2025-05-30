require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { setupTelemetry } = require('./telemetry');
const { logger } = require('./logger');
const { pool, redisClient } = require('./db');
const { metricsMiddleware, dbQueryDuration, cacheOperationDuration, cacheHitCounter, cacheMissCounter } = require('./metrics');

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenTelemetry
async function startServer() {
    try {
        await setupTelemetry();
        
        // Middleware
        app.use(cors());
        app.use(express.json());
        app.use(metricsMiddleware);

        // Helper function to generate cache key
        function generateCacheKey(query) {
            return `products:${JSON.stringify(query)}`;
        }

        // Wrapper functions for metrics
        async function getCachedDataWithMetrics(key) {
            const startTime = Date.now();
            try {
                const result = await redisClient.get(key);
                const duration = Date.now() - startTime;
                
                cacheOperationDuration.record(duration, {
                    operation: 'get',
                    key
                });
                
                if (result) {
                    cacheHitCounter.add(1, { key });
                    return JSON.parse(result);
                } else {
                    cacheMissCounter.add(1, { key });
                    return null;
                }
            } catch (error) {
                const duration = Date.now() - startTime;
                cacheOperationDuration.record(duration, {
                    operation: 'get',
                    key,
                    error: error.message
                });
                throw error;
            }
        }

        async function setCachedDataWithMetrics(key, data, expirySeconds = 3600) {
            const startTime = Date.now();
            try {
                const serializedData = JSON.stringify(data);
                await redisClient.set(key, serializedData, {
                    EX: expirySeconds
                });
                
                const duration = Date.now() - startTime;
                cacheOperationDuration.record(duration, {
                    operation: 'set',
                    key,
                    expirySeconds
                });
            } catch (error) {
                const duration = Date.now() - startTime;
                cacheOperationDuration.record(duration, {
                    operation: 'set',
                    key,
                    error: error.message
                });
                throw error;
            }
        }

        async function executeQuery(query, params) {
            const startTime = Date.now();
            try {
                const result = await pool.query(query, params);
                const duration = Date.now() - startTime;
                
                dbQueryDuration.record(duration, {
                    query: query.split(' ')[0].toLowerCase(), // GET, INSERT, UPDATE, DELETE
                    table: query.includes('FROM') ? query.split('FROM')[1].split(' ')[1] : 'unknown'
                });
                
                return result;
            } catch (error) {
                const duration = Date.now() - startTime;
                dbQueryDuration.record(duration, {
                    query: query.split(' ')[0].toLowerCase(),
                    table: query.includes('FROM') ? query.split('FROM')[1].split(' ')[1] : 'unknown',
                    error: error.message
                });
                throw error;
            }
        }

        // Get all products with optional filtering
        app.get('/api/products', async (req, res) => {
            const requestId = Math.random().toString(36).substring(7);
            const startTime = Date.now();
                const { category, minQuantity } = req.query;
                const cacheKey = generateCacheKey(req.query);

            try {
                // Try to get from cache first
                const cachedData = await getCachedDataWithMetrics(cacheKey);
                if (cachedData) {
                    res.json(cachedData);
                    return;
                }

                // If not in cache, query the database
                let query = 'SELECT * FROM products';
                const params = [];
                const conditions = [];

                if (category) {
                    conditions.push('category = $1');
                    params.push(category);
                }

                if (minQuantity) {
                    conditions.push(`quantity >= $${params.length + 1}`);
                    params.push(parseInt(minQuantity));
                }

                if (conditions.length > 0) {
                    query += ' WHERE ' + conditions.join(' AND ');
                }

                const result = await executeQuery(query, params);
                await setCachedDataWithMetrics(cacheKey, result.rows);
                res.json(result.rows);
            } catch (error) {
                logger.error({
                    message: "Error fetching products:",
                    requestId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        filters: req.query,
                        timestamp: new Date().toISOString(),
                        errorType: error.name,
                        errorCode: error.code
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get a single product by ID
        app.get('/api/products/:id', async (req, res) => {
            const requestId = Math.random().toString(36).substring(7);
            try {
                const { id } = req.params;
                const cacheKey = `product:${id}`;
                const startTime = Date.now();

                // Try to get from cache first
                const cacheStart = Date.now();
                logger.debug({
                    message: "Cache lookup",
                    requestId,
                    cacheKey,
                    cacheType: "single-product",
                    productId: id
                });
                const cachedData = await getCachedDataWithMetrics(cacheKey);
                const cacheDuration = Date.now() - cacheStart;

                if (cachedData) {
                    const totalDuration = Date.now() - startTime;
                    logger.info({
                        message: "Cache hit",
                        requestId,
                        cacheKey,
                        cacheType: "single-product",
                        productId: id,
                        performance: {
                            cacheDuration: `${cacheDuration}ms`,
                            totalDuration: `${totalDuration}ms`
                        },
                        data: {
                            product: {
                                id: cachedData.id,
                                name: cachedData.name,
                                category: cachedData.category,
                                price: cachedData.price,
                                quantity: cachedData.quantity
                            }
                        }
                    });
                    return res.json(cachedData);
                }

                logger.info({
                    message: "Cache miss",
                    requestId,
                    cacheKey,
                    cacheType: "single-product",
                    productId: id,
                    performance: {
                        cacheDuration: `${cacheDuration}ms`
                    }
                });

                const dbStart = Date.now();
                const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
                const dbDuration = Date.now() - dbStart;
                
                if (result.rows.length === 0) {
                    const totalDuration = Date.now() - startTime;
                    logger.warn({
                        message: "Product not found",
                        requestId,
                        productId: id,
                        performance: {
                            totalDuration: `${totalDuration}ms`
                        }
                    });
                    return res.status(404).json({ error: 'Product not found' });
                }

                // Cache the result
                const cacheSetStart = Date.now();
                logger.debug({
                    message: "Caching result",
                    requestId,
                    cacheKey,
                    cacheType: "single-product",
                    productId: id,
                    data: {
                        product: {
                            name: result.rows[0].name,
                            category: result.rows[0].category,
                            price: result.rows[0].price,
                            quantity: result.rows[0].quantity
                        }
                    }
                });
                await setCachedDataWithMetrics(cacheKey, result.rows[0]);
                const cacheSetDuration = Date.now() - cacheSetStart;
                
                const totalDuration = Date.now() - startTime;
                logger.info({
                    message: "Database fetch",
                    requestId,
                    cacheType: "single-product",
                    productId: id,
                    performance: {
                        dbDuration: `${dbDuration}ms`,
                        cacheSetDuration: `${cacheSetDuration}ms`,
                        totalDuration: `${totalDuration}ms`
                    },
                    data: {
                        product: {
                            id: result.rows[0].id,
                            name: result.rows[0].name,
                            category: result.rows[0].category,
                            price: result.rows[0].price,
                            quantity: result.rows[0].quantity
                        }
                    }
                });
                res.json(result.rows[0]);
            } catch (error) {
                logger.error({
                    message: "Error fetching product:",
                    requestId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        id: req.params.id,
                        timestamp: new Date().toISOString(),
                        errorType: error.name,
                        errorCode: error.code
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Create a new product
        app.post('/api/products', async (req, res) => {
            try {
                const { name, description, category, price, quantity } = req.body;
                const startTime = Date.now();
                
                logger.info({
                    message: "Creating new product",
                    requestId: req.requestId,
                    product: { 
                        name, 
                        category, 
                        price, 
                        quantity,
                        descriptionLength: description?.length || 0
                    },
                    timestamp: new Date().toISOString()
                });
                
                const dbStart = Date.now();
                const result = await pool.query(
                    'INSERT INTO products (name, description, category, price, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                    [name, description, category, price, quantity]
                );
                const dbDuration = Date.now() - dbStart;
                
                // Invalidate cache for all products
                const cacheStart = Date.now();
                await redisClient.del('products:{}');
                const cacheDuration = Date.now() - cacheStart;
                
                const totalDuration = Date.now() - startTime;
                logger.info({
                    message: "Product created successfully",
                    requestId: req.requestId,
                    id: result.rows[0].id,
                    name: result.rows[0].name,
                    performance: {
                        dbDuration: `${dbDuration}ms`,
                        cacheInvalidationDuration: `${cacheDuration}ms`,
                        totalDuration: `${totalDuration}ms`
                    },
                    product: {
                        category: result.rows[0].category,
                        price: result.rows[0].price,
                        quantity: result.rows[0].quantity,
                        createdAt: result.rows[0].created_at
                    }
                });
                
                res.status(201).json(result.rows[0]);
            } catch (error) {
                logger.error({
                    message: "Error creating product:",
                    requestId: req.requestId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        product: req.body,
                        timestamp: new Date().toISOString(),
                        errorType: error.name,
                        errorCode: error.code,
                        validationErrors: error.errors // If using a validation library
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Update a product
        app.put('/api/products/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const { name, description, category, price, quantity } = req.body;
                logger.info({
                    message: "Updating product",
                    id,
                    updates: { name, category, price, quantity }
                });
                
                const result = await pool.query(
                    'UPDATE products SET name = $1, description = $2, category = $3, price = $4, quantity = $5 WHERE id = $6 RETURNING *',
                    [name, description, category, price, quantity, id]
                );
                
                if (result.rows.length === 0) {
                    logger.warn({ id });
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                logger.info({
                    message: "Product updated successfully",
                    id,
                    name: result.rows[0].name 
                });
                res.json(result.rows[0]);
            } catch (error) {
                logger.error({
                    message: "Error updating product:",
                    error: {
                        message: error.message,
                        stack: error.stack,
                        id: req.params.id,
                        updates: req.body 
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Delete a product
        app.delete('/api/products/:id', async (req, res) => {
            try {
                const { id } = req.params;
                logger.info({ id });
                
                const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
                
                if (result.rows.length === 0) {
                    logger.warn({ id });
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                logger.info({ 
                    message: "Product deleted successfully",
                    id,
                    name: result.rows[0].name 
                });
                res.json({ message: 'Product deleted successfully' });
            } catch (error) {
                logger.error({
                    message: "Error deleting product:",
                    error: {
                        message: error.message,
                        stack: error.stack,
                        id: req.params.id 
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Update product quantity
        app.patch('/api/products/:id/quantity', async (req, res) => {
            try {
                const { id } = req.params;
                const { quantity } = req.body;
                logger.info({
                    message: "Updating product quantity",
                    id,
                    newQuantity: quantity 
                });
                
                const result = await pool.query(
                    'UPDATE products SET quantity = $1 WHERE id = $2 RETURNING *',
                    [quantity, id]
                );
                
                if (result.rows.length === 0) {
                    logger.warn({ id });
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                logger.info({
                    message: "Product quantity updated successfully",
                    id,
                    name: result.rows[0].name,
                    newQuantity: result.rows[0].quantity 
                });
                res.json(result.rows[0]);
            } catch (error) {
                logger.error({
                    message: "Error updating product quantity:",
                    error: {
                        message: error.message,
                        stack: error.stack,
                        id: req.params.id,
                        quantity: req.body.quantity 
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Clear Redis cache
        app.delete('/api/cache', async (req, res) => {
            try {
                logger.info({ message: "Clearing Redis cache" });
                
                // Get all keys matching our cache patterns
                const keys = await redisClient.keys('product:*');
                const listKeys = await redisClient.keys('products:*');
                const allKeys = [...keys, ...listKeys];

                if (allKeys.length === 0) {
                    logger.info({ message: "Cache is already empty" });
                    return res.json({ message: 'Cache is already empty' });
                }

                // Delete all matching keys
                await redisClient.del(allKeys);
                
                logger.info({ 
                    message: "Cache cleared successfully",
                    clearedEntries: allKeys.length,
                    clearedKeys: allKeys 
                });
                res.json({ 
                    message: 'Cache cleared successfully',
                    clearedEntries: allKeys.length,
                    clearedKeys: allKeys
                });
            } catch (error) {
                logger.error({
                    message: "Error clearing cache:",
                    error: {
                        message: error.message,
                        stack: error.stack 
                    }
                });
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Start the server
        app.listen(port, () => {
            logger.info({
                message: "Server started",
                port,
                environment: process.env.NODE_ENV || 'development'
            });
        });
    } catch (error) {
        logger.error({
            message: "Failed to start server:",
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        process.exit(1);
    }
}

startServer(); 

module.exports = { app, startServer }; 