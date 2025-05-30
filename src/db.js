const { Pool } = require('pg');
const { createClient } = require('redis');
const { logger } = require('./logger');
const os = require('os');

// PostgreSQL connection pool
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
});

// Redis client
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

// System information for logging
const systemInfo = {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
    },
    cpus: os.cpus().length,
    uptime: os.uptime()
};

// Connect to Redis
redisClient.connect().catch(err => {
    logger.error({
        message: 'Redis connection error:',
        error: {
            message: err.message,
            stack: err.stack,
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            timestamp: new Date().toISOString(),
            systemInfo,
            connectionAttempt: 1
        }
    });
});

// Handle Redis connection events
redisClient.on('error', (err) => {
    logger.error({
        message: 'Redis error:',
        error: {
            message: err.message,
            stack: err.stack,
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            timestamp: new Date().toISOString(),
            systemInfo,
            memoryUsage: process.memoryUsage()
        }
    });
});

redisClient.on('connect', () => {
    logger.info({
        message: 'Connected to Redis',
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        timestamp: new Date().toISOString(),
        systemInfo,
        connectionTime: new Date().toISOString()
    });
});

// Handle PostgreSQL connection events
pool.on('connect', (client) => {
    logger.info({
        message: 'Connected to PostgreSQL',
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        database: process.env.POSTGRES_DB,
        timestamp: new Date().toISOString(),
        systemInfo,
        connectionInfo: {
            processId: client.processID,
            connectionTime: new Date().toISOString()
        }
    });
});

pool.on('error', (err, client) => {
    logger.error({
        message: 'PostgreSQL error:',
        error: {
            message: err.message,
            stack: err.stack,
            host: process.env.POSTGRES_HOST,
            port: process.env.POSTGRES_PORT,
            database: process.env.POSTGRES_DB,
            timestamp: new Date().toISOString(),
            systemInfo,
            clientInfo: client ? {
                processId: client.processID,
                connectionTime: client.connectionTime
            } : null,
            memoryUsage: process.memoryUsage()
        }
    });
});

// Helper function to get cached data
async function getCachedData(key) {
    const startTime = Date.now();
    try {
        logger.debug({
            message: "Attempting to get cached data",
            key,
            timestamp: new Date().toISOString(),
            memoryUsage: process.memoryUsage()
        });
        
        const cachedData = await redisClient.get(key);
        const duration = Date.now() - startTime;
        
        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            const dataSize = Buffer.byteLength(cachedData, 'utf8');
            
            logger.info({
                message: 'Cache hit',
                key,
                performance: {
                    duration: `${duration}ms`,
                    dataSize: `${(dataSize / 1024).toFixed(2)}KB`
                },
                data: {
                    type: Array.isArray(parsedData) ? 'array' : 'object',
                    itemCount: Array.isArray(parsedData) ? parsedData.length : 1,
                    compressionRatio: (dataSize / JSON.stringify(parsedData).length).toFixed(2)
                },
                timestamp: new Date().toISOString(),
                memoryUsage: process.memoryUsage()
            });
            return parsedData;
        }
        
        logger.info({
            message: 'Cache miss',
            key,
            performance: {
                duration: `${duration}ms`
            },
            timestamp: new Date().toISOString(),
            memoryUsage: process.memoryUsage()
        });
        return null;
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error({
            message: 'Error getting cached data',
            error: {
                message: error.message,
                stack: error.stack,
                key,
                performance: {
                    duration: `${duration}ms`
                },
                timestamp: new Date().toISOString(),
                systemInfo,
                memoryUsage: process.memoryUsage()
            }
        });
        return null;
    }
}

// Helper function to set cached data
async function setCachedData(key, data, expirySeconds = 3600) {
    const startTime = Date.now();
    try {
        const serializedData = JSON.stringify(data);
        const dataSize = Buffer.byteLength(serializedData, 'utf8');
        
        logger.debug({
            message: "Setting cached data",
            key,
            timestamp: new Date().toISOString(),
            memoryUsage: process.memoryUsage()
        });
        
        const setStart = Date.now();
        await redisClient.set(key, serializedData, {
            EX: expirySeconds
        });
        const setDuration = Date.now() - setStart;
        
        logger.info({
            message: 'Cache data set successfully',
            key,
            performance: {
                totalDuration: `${Date.now() - startTime}ms`,
                setDuration: `${setDuration}ms`,
                dataSize: `${(dataSize / 1024).toFixed(2)}KB`
            },
            expirySeconds,
            timestamp: new Date().toISOString(),
            memoryUsage: process.memoryUsage()
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error({
            message: 'Error setting cached data',
            error: {
                message: error.message,
                stack: error.stack,
                key,
                performance: {
                    duration: `${duration}ms`
                },
                expirySeconds,
                timestamp: new Date().toISOString(),
                systemInfo,
                memoryUsage: process.memoryUsage()
            }
        });
    }
}

module.exports = {
    pool,
    redisClient,
    getCachedData,
    setCachedData
}; 