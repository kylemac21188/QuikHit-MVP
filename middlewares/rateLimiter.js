const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const AWS = require('aws-sdk');
const NodeCache = require('node-cache');
const promClient = require('prom-client');
const winston = require('winston');
const schedule = require('node-schedule');
const anomalyDetectionModel = require('./anomalyDetectionModel');
const datadogMetrics = require('datadog-metrics');
const axios = require('axios');
const CircuitBreaker = require('opossum');

// Redis Initialization
const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
};

const pubClient = new Redis(redisOptions);
const subClient = pubClient.duplicate();

// AWS Parameter Store and Local Cache
const parameterStore = new AWS.SSM();
const localCache = new NodeCache({ stdTTL: 300 }); // Cache with 5-minute TTL

// Prometheus Metrics
const pubsubMessagesReceived = new promClient.Counter({
    name: 'redis_pubsub_messages_received_total',
    help: 'Total messages received on Redis PUB/SUB',
});

const awsConfigFetchDuration = new promClient.Histogram({
    name: 'aws_config_fetch_duration_seconds',
    help: 'AWS Parameter Store fetch latency',
});

// Logger Setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.File({ filename: 'logs/rate-limit.log' })],
});

// Redis Event Handling
pubClient.on('connect', () => logger.info('Connected to Redis (PUB client)'));
pubClient.on('ready', () => logger.info('Redis PUB client is ready'));
pubClient.on('error', (error) => logger.error('Redis PUB client error', { error }));
pubClient.on('reconnecting', (delay) => logger.warn(`Redis PUB client reconnecting in ${delay}ms`));

subClient.on('connect', () => logger.info('Connected to Redis (SUB client)'));
subClient.on('ready', () => logger.info('Redis SUB client is ready'));
subClient.on('error', (error) => logger.error('Redis SUB client error', { error }));
subClient.on('reconnecting', (delay) => logger.warn(`Redis SUB client reconnecting in ${delay}ms`));

// Subscribe to Redis PUB/SUB
subClient.subscribe('rate-limit-updates', (err, count) => {
    if (err) {
        logger.error('Error subscribing to Redis channel', { error: err });
    } else {
        logger.info(`Subscribed to ${count} Redis channels.`);
    }
});

subClient.on('message', (channel, message) => {
    if (channel === 'rate-limit-updates') {
        pubsubMessagesReceived.inc();
        try {
            const { key, value } = JSON.parse(message);
            if (!key || typeof value === 'undefined') throw new Error('Invalid PUB/SUB message format');
            localCache.set(key, value);
            logger.info('Rate limit configuration updated via PUB/SUB', { key, value });
        } catch (error) {
            logger.error('Error processing PUB/SUB message', { message, error });
        }
    }
});

// Fetch Configuration from AWS
const fetchConfigFromAWS = async (key, retries = 3) => {
    const endTimer = awsConfigFetchDuration.startTimer();
    try {
        const params = { Name: key, WithDecryption: true };
        const { Parameter } = await parameterStore.getParameter(params).promise();
        endTimer();
        return JSON.parse(Parameter.Value);
    } catch (error) {
        endTimer();
        if (retries > 0) {
            logger.warn(`Retrying AWS fetch for ${key}, attempts left: ${retries - 1}`);
            await new Promise((resolve) => setTimeout(resolve, (4 - retries) * 1000)); // Exponential backoff
            return fetchConfigFromAWS(key, retries - 1);
        }
        logger.error('Error fetching configuration from AWS', { error });
        throw error;
    }
};

// Update Configuration and Publish Updates
const updateConfig = async (key, value) => {
    try {
        const message = JSON.stringify({ key, value });
        await pubClient.publish('rate-limit-updates', message);
        logger.info('Published configuration update', { key, value });
    } catch (error) {
        logger.error('Error publishing configuration update', { error });
    }
};

// Sync Configurations from AWS and Local Cache
const syncConfigurations = async () => {
    const sources = [
        { name: 'AWS Parameter Store', fetch: fetchConfigFromAWS },
        { name: 'Local Cache', fetch: (key) => Promise.resolve(localCache.get(key)) },
    ];
    try {
        for (const source of sources) {
            try {
                const config = await source.fetch('rateLimitConfig');
                if (config) {
                    localCache.set('rateLimitConfig', config);
                    logger.info(`Configuration synced from ${source.name}`);
                }
            } catch (sourceError) {
                logger.warn(`Failed to sync from ${source.name}`, { error: sourceError });
            }
        }
    } catch (error) {
        logger.error('Error syncing configurations', { error });
    }
};

// Express Rate Limiter Factory
const createRateLimiter = (options) => {
    const defaultConfig = localCache.get('rateLimitConfig') || { maxRequests: 100, windowMs: 15 * 60 * 1000 };
    return rateLimit({
        store: new RedisStore({ client: pubClient }),
        windowMs: options?.windowMs || defaultConfig.windowMs,
        max: options?.max || defaultConfig.maxRequests,
        keyGenerator: options?.keyGenerator || ((req) => req.ip),
        handler: (req, res) => {
            res.status(429).json({ error: 'Too many requests, please try again later.' });
        },
        onLimitReached: (req, res) => {
            logger.info(`Rate limit exceeded for ${req.path}`);
        },
    });
};

// Dynamic AI-Driven Rate Limits
const adjustRateLimitsAI = async () => {
    try {
        const predictions = await require('./aiRateLimitModel').predictTrafficPatterns();
        for (const [region, maxRequests] of Object.entries(predictions)) {
            localCache.set(`rateLimit_${region}`, maxRequests);
            logger.info(`AI-driven rate limit adjustment: ${region} -> ${maxRequests}`);
        }
    } catch (error) {
        logger.error('Error adjusting rate limits with AI', { error });
    }
};

// Periodic Config Sync and AI Rate Adjustment
schedule.scheduleJob('*/5 * * * *', syncConfigurations);
schedule.scheduleJob('0 0 * * *', adjustRateLimitsAI);

// Export Rate Limiter
module.exports = {
    createRateLimiter,
    syncConfigurations,
    updateConfig,
    adjustRateLimitsAI,
};
// Initialize Datadog Metrics
datadogMetrics.init({ apiKey: process.env.DATADOG_API_KEY });

// Real-Time Anomaly Detection
const detectAnomalies = async (req) => {
    const trafficData = {
        ip: req.ip,
        endpoint: req.path,
        headers: req.headers,
        timestamp: Date.now(),
    };

    try {
        const isSuspicious = await anomalyDetectionModel.predict(trafficData);
        if (isSuspicious) {
            logger.warn('Suspicious traffic detected', { ip: req.ip, endpoint: req.path });
            return true;
        }
    } catch (error) {
        logger.error('Error during anomaly detection', { error });
    }
    return false;
};

const anomalyDetectionMiddleware = async (req, res, next) => {
    const isAnomalous = await detectAnomalies(req);
    if (isAnomalous) {
        return res.status(403).json({ error: 'Suspicious activity detected' });
    }
    next();
};

// Geo-Specific Rate Limiting
const geoSpecificRateLimiter = async (req, res, next) => {
    try {
        const ip = req.ip;
        const geoData = await axios.get(`https://ipinfo.io/${ip}/json`);
        const region = geoData.data.region || 'Unknown';
        const regionLimits = localCache.get(`rateLimit_${region}`) || 100;

        const rateLimiter = createRateLimiter({ max: regionLimits });
        return rateLimiter(req, res, next);
    } catch (error) {
        logger.error('Error in geo-specific rate limiting', { error });
        next();
    }
};

// Report Metrics to Datadog
const reportMetricsToDatadog = () => {
    const metrics = {
        requestsBlocked: pubsubMessagesReceived.inc,
        awsFetchLatency: awsConfigFetchDuration.startTimer,
    };

    Object.entries(metrics).forEach(([metric, value]) => {
        datadogMetrics.gauge(`rate_limiter.${metric}`, value);
    });
};
setInterval(reportMetricsToDatadog, 60000); // Report every minute

// Circuit Breaker for Redis
const breaker = new CircuitBreaker(async (operation) => operation(), {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
});

breaker.on('open', () => logger.warn('Circuit breaker is open'));
breaker.on('close', () => logger.info('Circuit breaker closed'));

// Use Middleware
app.use(anomalyDetectionMiddleware);
app.use('/api', geoSpecificRateLimiter);