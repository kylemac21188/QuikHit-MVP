const express = require('express');
const { body, validationResult } = require('express-validator');
const PremiumStream = require('../models/premiumStream');
const auctionService = require('../services/auctionService');
const aiMiddleware = require('../middlewares/aiMiddleware');
const blockchainMiddleware = require('../middlewares/blockchainMiddleware');
const promClient = require('prom-client');
const wss = require('../websocketServer');
const winston = require('winston');
const Sentry = require('@sentry/node');
const { checkRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Prometheus metrics
const createStreamCounter = new promClient.Counter({
    name: 'create_premium_stream_requests_total',
    help: 'Total number of create premium stream requests',
});

const updateStreamCounter = new promClient.Counter({
    name: 'update_premium_stream_requests_total',
    help: 'Total number of update premium stream requests',
});

const deleteStreamCounter = new promClient.Counter({
    name: 'delete_premium_stream_requests_total',
    help: 'Total number of delete premium stream requests',
});

// Create Premium Stream
router.post('/create', [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('auctionIds').isArray().withMessage('Auction IDs must be an array'),
    body('region').notEmpty().withMessage('Region is required')
], async (req, res) => {
    createStreamCounter.inc();
    const { title, description, auctionIds, region } = req.body;

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    // AI-powered optimization
    const optimizedConfig = await aiMiddleware.optimizeStreamConfig(req.body);

    // Create stream in database
    const premiumStream = await PremiumStream.create({
        title: optimizedConfig.title,
        description: optimizedConfig.description,
        auctionIds,
        region,
        createdBy: req.user.id,
    });

    // Log to blockchain
    await blockchainMiddleware.logAction({
        action: 'CREATE_PREMIUM_STREAM',
        data: premiumStream,
    });

    // Send real-time notifications
    wss.broadcast(JSON.stringify({ event: 'premiumStreamCreated', data: premiumStream }));

    res.status(201).json({ success: true, premiumStream });
});

// Update Premium Stream
router.put('/update/:id', [
    body('title').optional().notEmpty().withMessage('Title is required'),
    body('description').optional().notEmpty().withMessage('Description is required'),
    body('auctionIds').optional().isArray().withMessage('Auction IDs must be an array'),
    body('region').optional().notEmpty().withMessage('Region is required')
], async (req, res) => {
    updateStreamCounter.inc();
    const { id } = req.params;
    const updates = req.body;

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    // AI-powered optimization
    const optimizedConfig = await aiMiddleware.optimizeStreamConfig(updates);

    // Update stream in database
    const premiumStream = await PremiumStream.findByIdAndUpdate(id, optimizedConfig, { new: true });

    // Log to blockchain
    await blockchainMiddleware.logAction({
        action: 'UPDATE_PREMIUM_STREAM',
        data: premiumStream,
    });

    // Send real-time notifications
    wss.broadcast(JSON.stringify({ event: 'premiumStreamUpdated', data: premiumStream }));

    res.status(200).json({ success: true, premiumStream });
});

// Delete Premium Stream
router.delete('/delete/:id', async (req, res) => {
    deleteStreamCounter.inc();
    const { id } = req.params;

    // Delete stream in database
    const premiumStream = await PremiumStream.findByIdAndDelete(id);

    // Log to blockchain
    await blockchainMiddleware.logAction({
        action: 'DELETE_PREMIUM_STREAM',
        data: premiumStream,
    });

    // Send real-time notifications
    wss.broadcast(JSON.stringify({ event: 'premiumStreamDeleted', data: premiumStream }));

    res.status(200).json({ success: true, premiumStream });
});

// Get Premium Streams
router.get('/', async (req, res) => {
    const filters = req.query;
    const premiumStreams = await PremiumStream.find(filters);
    res.status(200).json({ success: true, premiumStreams });
});

// Get Premium Stream Details
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const premiumStream = await PremiumStream.findById(id);
    res.status(200).json({ success: true, premiumStream });
});

module.exports = router;
// Initialize Sentry
Sentry.init({ dsn: 'YOUR_SENTRY_DSN' });

// Winston logger configuration
const logger = winston.createLogger({
    level: 'error',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log' }),
        new winston.transports.Console()
    ]
});

// Centralized error-handling middleware
router.use((err, req, res, next) => {
    const errorDetails = {
        timestamp: new Date().toISOString(),
        requestId: req.id,
        userId: req.user ? req.user.id : 'anonymous',
        message: err.message,
        stack: err.stack
    };

    logger.error(errorDetails);
    Sentry.captureException(err);

    const statusCode = err.isClientError ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
});

// Role-based access control middleware
const requireRole = (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

// Enhanced endpoints with RBAC
router.post('/create', requireRole(['admin', 'streamer']), [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('auctionIds').isArray().withMessage('Auction IDs must be an array'),
    body('region').notEmpty().withMessage('Region is required')
], async (req, res, next) => {
    try {
        createStreamCounter.inc();
        const { title, description, auctionIds, region } = req.body;

        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // AI-powered optimization
        const optimizedConfig = await aiMiddleware.optimizeStreamConfig(req.body);

        // Create stream in database
        const premiumStream = await PremiumStream.create({
            title: optimizedConfig.title,
            description: optimizedConfig.description,
            auctionIds,
            region,
            createdBy: req.user.id,
        });

        // Log to blockchain with retry mechanism
        try {
            await blockchainMiddleware.logAction({
                action: 'CREATE_PREMIUM_STREAM',
                data: premiumStream,
            });
        } catch (blockchainError) {
            logger.error({ message: 'Blockchain logging failed', error: blockchainError });
            // Retry logic or fallback mechanism
        }

        // Send real-time notifications
        wss.broadcast(JSON.stringify({ event: 'premiumStreamCreated', data: premiumStream }));

        res.status(201).json({ success: true, premiumStream });
    } catch (error) {
        next(error);
    }
});

router.put('/update/:id', requireRole(['admin', 'streamer']), [
    body('title').optional().notEmpty().withMessage('Title is required'),
    body('description').optional().notEmpty().withMessage('Description is required'),
    body('auctionIds').optional().isArray().withMessage('Auction IDs must be an array'),
    body('region').optional().notEmpty().withMessage('Region is required')
], async (req, res, next) => {
    try {
        updateStreamCounter.inc();
        const { id } = req.params;
        const updates = req.body;

        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // AI-powered optimization
        const optimizedConfig = await aiMiddleware.optimizeStreamConfig(updates);

        // Update stream in database
        const premiumStream = await PremiumStream.findByIdAndUpdate(id, optimizedConfig, { new: true });

        // Log to blockchain with retry mechanism
        try {
            await blockchainMiddleware.logAction({
                action: 'UPDATE_PREMIUM_STREAM',
                data: premiumStream,
            });
        } catch (blockchainError) {
            logger.error({ message: 'Blockchain logging failed', error: blockchainError });
            // Retry logic or fallback mechanism
        }

        // Send real-time notifications
        wss.broadcast(JSON.stringify({ event: 'premiumStreamUpdated', data: premiumStream }));

        res.status(200).json({ success: true, premiumStream });
    } catch (error) {
        next(error);
    }
});

router.delete('/delete/:id', requireRole(['admin']), async (req, res, next) => {
    try {
        deleteStreamCounter.inc();
        const { id } = req.params;

        // Delete stream in database
        const premiumStream = await PremiumStream.findByIdAndDelete(id);

        // Log to blockchain with retry mechanism
        try {
            await blockchainMiddleware.logAction({
                action: 'DELETE_PREMIUM_STREAM',
                data: premiumStream,
            });
        } catch (blockchainError) {
            logger.error({ message: 'Blockchain logging failed', error: blockchainError });
            // Retry logic or fallback mechanism
        }

        // Send real-time notifications
        wss.broadcast(JSON.stringify({ event: 'premiumStreamDeleted', data: premiumStream }));

        res.status(200).json({ success: true, premiumStream });
    } catch (error) {
        next(error);
    }
});

// Enhanced GET Premium Streams with pagination and sorting
router.get('/', async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sortBy = 'createdAt', ...filters } = req.query;
        const options = {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            sort: { [sortBy]: 1 }
        };

        const premiumStreams = await PremiumStream.paginate(filters, options);

        res.status(200).json({
            success: true,
            premiumStreams: premiumStreams.docs,
            totalPages: premiumStreams.totalPages,
            currentPage: premiumStreams.page,
            totalRecords: premiumStreams.totalDocs
        });
    } catch (error) {
        next(error);
    }
});

// AI-driven insights endpoint
router.get('/analytics/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const premiumStream = await PremiumStream.findById(id);

        if (!premiumStream) {
            return res.status(404).json({ error: 'Premium stream not found' });
        }

        const insights = await aiMiddleware.analyzeStream(premiumStream);

        res.status(200).json({ success: true, insights });
    } catch (error) {
        next(error);
    }
});

// Prometheus metrics endpoint
router.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// Blockchain logs endpoint
router.get('/blockchain/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const blockchainLogs = await blockchainMiddleware.getLogs(id);

        res.status(200).json({ success: true, blockchainLogs });
    } catch (error) {
        next(error);
    }
});

// Sustainability metrics endpoint
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const premiumStream = await PremiumStream.findById(id);

        if (!premiumStream) {
            return res.status(404).json({ error: 'Premium stream not found' });
        }

        const sustainabilityScore = await sustainabilityMiddleware.calculateScore(premiumStream);

        res.status(200).json({ success: true, premiumStream, sustainabilityScore });
    } catch (error) {
        next(error);
    }
});

// Real-time WebSocket subscription endpoint
router.post('/subscribe', async (req, res, next) => {
    try {
        const { filters } = req.body;
        wss.subscribe(req.user.id, filters);

        res.status(200).json({ success: true, message: 'Subscribed successfully' });
    } catch (error) {
        next(error);
    }
});

// Audit logs endpoint
router.get('/audit/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const auditLogs = await auditMiddleware.getLogs(id);

        res.status(200).json({ success: true, auditLogs });
    } catch (error) {
        next(error);
    }
});

// Gamification leaderboard endpoint
router.get('/leaderboard', async (req, res, next) => {
    try {
        const leaderboard = await gamificationMiddleware.getLeaderboard();

        res.status(200).json({ success: true, leaderboard });
    } catch (error) {
        next(error);
    }
});

module.exports = router;