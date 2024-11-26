const express = require('express');
const Joi = require('joi');
const { validateRequest, authenticate, authorize } = require('../middleware');
const streamAnalytics = require('../services/streamAnalytics');
const AIInsights = require('../services/AIInsights');
const Observability = require('../services/Observability');
const Prometheus = require('../services/Prometheus');
const Redis = require('../services/Redis');
const Blockchain = require('../services/Blockchain');
const winston = require('winston');
const zlib = require('zlib');
const WebSocket = require('ws');
const geoOptimize = require('../services/GeoOptimization');
const tracing = require('../services/Tracing');
const rateLimiter = require('../services/RateLimiter');

const router = express.Router();

// Validation schemas
const streamIdSchema = Joi.object({
    streamId: Joi.string().required()
});

// Middleware for request validation
const validateStreamId = (req, res, next) => {
    const { error } = streamIdSchema.validate(req.params);
    if (error) return res.status(400).send(error.details[0].message);
    next();
};

// Real-Time Analytics Endpoint
router.get('/real-time/:streamId', authenticate, validateStreamId, async (req, res) => {
    try {
        const { streamId } = req.params;
        const metrics = await streamAnalytics.getRealTimeMetrics(streamId);
        res.json(metrics);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Predictive Analytics Endpoint
router.post('/predictive/:streamId', authenticate, validateStreamId, async (req, res) => {
    try {
        const { streamId } = req.params;
        const predictions = await AIInsights.getPredictions(streamId);
        res.json(predictions);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Anomaly Detection Endpoint
router.post('/anomaly-detection/:streamId', authenticate, validateStreamId, async (req, res) => {
    try {
        const { streamId } = req.params;
        const anomalies = await Observability.detectAnomalies(streamId);
        res.json(anomalies);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Custom Dashboards Endpoint
router.get('/trends/:streamId', authenticate, authorize(['streamer', 'advertiser', 'admin']), validateStreamId, async (req, res) => {
    try {
        const { streamId } = req.params;
        const trends = await streamAnalytics.getTrends(streamId);
        res.json(trends);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Analytics Export Endpoint
router.get('/export/:streamId', authenticate, authorize(['admin']), validateStreamId, async (req, res) => {
    try {
        const { streamId } = req.params;
        const exportData = await streamAnalytics.exportData(streamId);
        await Blockchain.logExport(streamId, exportData);
        res.json(exportData);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

module.exports = router;
// Initialize WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Winston logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'analytics.log' })
    ]
});

// Middleware for data compression
const compressResponse = (req, res, next) => {
    const originalSend = res.send;
    res.send = (body) => {
        zlib.gzip(body, (err, compressed) => {
            if (err) {
                logger.error('Compression error', err);
                return originalSend.call(res, body);
            }
            res.set('Content-Encoding', 'gzip');
            originalSend.call(res, compressed);
        });
    };
    next();
};

// Middleware for Prometheus metrics
const prometheusMetrics = (req, res, next) => {
    const end = Prometheus.startTimer();
    res.on('finish', () => {
        Prometheus.observeResponseTime(req.path, res.statusCode, end());
    });
    next();
};

// Apply middlewares
router.use(compressResponse);
router.use(prometheusMetrics);

// WebSocket real-time updates
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const { streamId } = JSON.parse(message);
        try {
            const metrics = await streamAnalytics.getRealTimeMetrics(streamId);
            ws.send(JSON.stringify(metrics));
        } catch (error) {
            logger.error('WebSocket error', error);
            ws.send(JSON.stringify({ error: error.message }));
        }
    });
});

// Enhanced error handling
router.use((err, req, res, next) => {
    logger.error('API error', err);
    res.status(500).json({ error: err.message });
});

module.exports = router;
// Route WebSocket connections to the optimal server based on user location

wss.on('connection', (ws, req) => {
    const userLocation = geoOptimize.getUserLocation(req);
    const optimalServer = geoOptimize.getOptimalServer(userLocation);

    ws.on('message', async (message) => {
        const { streamId } = JSON.parse(message);
        try {
            const metrics = await streamAnalytics.getRealTimeMetrics(streamId, optimalServer);
            ws.send(JSON.stringify(metrics));
        } catch (error) {
            logger.error('WebSocket error', error);
            ws.send(JSON.stringify({ error: error.message }));
        }
    });
});

// Add failover capabilities for high availability
wss.on('error', (error) => {
    logger.error('WebSocket server error', error);
    // Implement failover logic here
});

// AI-Driven Insights and Adaptive Dashboards
router.get('/adaptive-dashboard/:role', authenticate, authorize(['streamer', 'advertiser', 'admin']), async (req, res) => {
    try {
        const { role } = req.params;
        const dashboard = await AIInsights.getAdaptiveDashboard(role);
        res.json(dashboard);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Blockchain for Data Integrity
router.post('/log-transaction', authenticate, async (req, res) => {
    try {
        const { transaction } = req.body;
        await Blockchain.logTransaction(transaction);
        res.status(200).send('Transaction logged successfully');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Redis Caching for High-Performance Access
const cache = (req, res, next) => {
    const key = req.originalUrl;
    Redis.get(key, (err, data) => {
        if (err) return next(err);
        if (data) return res.send(JSON.parse(data));
        next();
    });
};

router.use(cache);

// Advanced Observability

router.use((req, res, next) => {
    const traceId = tracing.startTrace(req);
    res.on('finish', () => {
        tracing.endTrace(traceId, res.statusCode);
    });
    next();
});

// Dynamic Rate Limiting

router.use((req, res, next) => {
    const role = req.user.role;
    rateLimiter.checkRateLimit(role, req, res, next);
});

// Enhanced Error Handling
router.use((err, req, res, next) => {
    logger.error('API error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: err.message, stack: err.stack });
});

// Prometheus Metrics Augmentation
router.use((req, res, next) => {
    Prometheus.trackUserActivity(req.user.id);
    Prometheus.trackSystemHealth();
    next();
});