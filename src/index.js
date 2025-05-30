require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { setupTelemetry } = require('./telemetry');
const { logger } = require('./logger');
const { pool, redisClient, getCachedData, setCachedData } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenTelemetry
async function startServer() {
    try {
        await setupTelemetry();
        
        // Middleware
        app.use(cors());
        app.use(express.json());

        // Helper function to generate cache key
        function generateCacheKey(query) {
            return `products:${JSON.stringify(query)}`;
        }

        // Get all products with optional filtering
        app.get('/api/products', async (req, res) => {
            try {
                const { category, minQuantity } = req.query;
                const cacheKey = generateCacheKey(req.query);

                // Try to get from cache first
                const cachedData = await getCachedData(cacheKey);
                if (cachedData) {
                    return res.json(cachedData);
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

                const result = await pool.query(query, params);
                
                // Cache the results
                await setCachedData(cacheKey, result.rows);
                
                res.json(result.rows);
            } catch (error) {
                logger.error('Error fetching products:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Get a single product by ID
        app.get('/api/products/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const cacheKey = `product:${id}`;

                // Try to get from cache first
                const cachedData = await getCachedData(cacheKey);
                if (cachedData) {
                    return res.json(cachedData);
                }

                const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }

                // Cache the result
                await setCachedData(cacheKey, result.rows[0]);
                
                res.json(result.rows[0]);
            } catch (error) {
                logger.error('Error fetching product:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Create a new product
        app.post('/api/products', async (req, res) => {
            try {
                const { name, description, category, price, quantity } = req.body;
                
                const result = await pool.query(
                    'INSERT INTO products (name, description, category, price, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                    [name, description, category, price, quantity]
                );
                
                // Invalidate cache for all products
                await redisClient.del('products:{}');
                
                res.status(201).json(result.rows[0]);
            } catch (error) {
                logger.error('Error creating product:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Update a product
        app.put('/api/products/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const { name, description, category, price, quantity } = req.body;
                
                const result = await pool.query(
                    'UPDATE products SET name = $1, description = $2, category = $3, price = $4, quantity = $5 WHERE id = $6 RETURNING *',
                    [name, description, category, price, quantity, id]
                );
                
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                res.json(result.rows[0]);
            } catch (error) {
                logger.error('Error updating product:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Delete a product
        app.delete('/api/products/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                res.json({ message: 'Product deleted successfully' });
            } catch (error) {
                logger.error('Error deleting product:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Update product quantity
        app.patch('/api/products/:id/quantity', async (req, res) => {
            try {
                const { id } = req.params;
                const { quantity } = req.body;
                
                const result = await pool.query(
                    'UPDATE products SET quantity = $1 WHERE id = $2 RETURNING *',
                    [quantity, id]
                );
                
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                // Invalidate both list and individual product caches
                await redisClient.del('products:{}');
                await redisClient.del(`product:${id}`);
                
                res.json(result.rows[0]);
            } catch (error) {
                logger.error('Error updating product quantity:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Clear Redis cache
        app.delete('/api/cache', async (req, res) => {
            try {
                // Get all keys matching our cache patterns
                const keys = await redisClient.keys('product:*');
                const listKeys = await redisClient.keys('products:*');
                const allKeys = [...keys, ...listKeys];

                if (allKeys.length === 0) {
                    return res.json({ message: 'Cache is already empty' });
                }

                // Delete all matching keys
                await redisClient.del(allKeys);
                
                logger.info(`Cleared ${allKeys.length} cache entries`);
                res.json({ 
                    message: 'Cache cleared successfully',
                    clearedEntries: allKeys.length,
                    clearedKeys: allKeys
                });
            } catch (error) {
                logger.error('Error clearing cache:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Start the server
        app.listen(port, () => {
            logger.info(`Server is running on port ${port}`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer(); 