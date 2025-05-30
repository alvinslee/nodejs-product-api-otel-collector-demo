const { Pool } = require('pg');
const { createClient } = require('redis');
const { logger } = require('./logger');

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

// Connect to Redis
redisClient.connect().catch(err => {
    logger.error('Redis connection error:', err);
});

// Handle Redis connection events
redisClient.on('error', (err) => {
    logger.error('Redis error:', err);
});

redisClient.on('connect', () => {
    logger.info('Connected to Redis');
});

// Handle PostgreSQL connection events
pool.on('connect', () => {
    logger.info('Connected to PostgreSQL');
});

pool.on('error', (err) => {
    logger.error('PostgreSQL error:', err);
});

// Helper function to get cached data
async function getCachedData(key) {
    try {
        const cachedData = await redisClient.get(key);
        if (cachedData) {
            logger.info(`Cache hit for key: ${key}`);
            return JSON.parse(cachedData);
        }
        logger.info(`Cache miss for key: ${key}`);
        return null;
    } catch (error) {
        logger.error('Redis get error:', error);
        return null;
    }
}

// Helper function to set cached data
async function setCachedData(key, data, expirySeconds = 3600) {
    try {
        await redisClient.set(key, JSON.stringify(data), {
            EX: expirySeconds
        });
        logger.info(`Cached data for key: ${key}`);
    } catch (error) {
        logger.error('Redis set error:', error);
    }
}

module.exports = {
    pool,
    redisClient,
    getCachedData,
    setCachedData
}; 