const express = require('express');
const { check, validationResult } = require('express-validator');
const formatValidator = require('../middlewares/formatValidator');
const aiMiddleware = require('../middlewares/aiMiddleware');
const requireRole = require('../middlewares/requireRole');
const adFormatController = require('../controllers/adFormatController');
const promClient = require('prom-client');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const WebSocket = require('ws');
const Sentry = require('@sentry/node');

const router = express.Router();

// Prometheus metrics
const requestCounter = new promClient.Counter({
    name: 'ad_format_requests_total',
    help: 'Total number of requests for ad format routes',
    labelNames: ['method', 'route', 'status_code']
});

// Rate limiting middleware
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// Swagger setup
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Ad Format API',
            version: '1.0.0',
            description: 'API for managing ad formats'
        }
    },
    apis: ['./routes/adFormatRoutes.js']
};
const swaggerDocs = swaggerJsdoc(swaggerOptions);
router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /ad-formats:
 *   post:
 *     summary: Create a new ad format
 *     tags: [Ad Formats]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *               - mediaType
 *               - region
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               mediaType:
 *                 type: string
 *               region:
 *                 type: string
 *     responses:
 *       201:
 *         description: Ad format created successfully
 *       400:
 *         description: Invalid input
 */
router.post(
    '/ad-formats',
    [
        check('name').notEmpty().withMessage('Name is required'),
        check('description').notEmpty().withMessage('Description is required'),
        check('mediaType').notEmpty().withMessage('Media type is required'),
        check('region').notEmpty().withMessage('Region is required')
    ],
    formatValidator,
    aiMiddleware.optimizeAdFormat,
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        await adFormatController.createAdFormat(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/{id}:
 *   put:
 *     summary: Update an existing ad format
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ad format ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               mediaType:
 *                 type: string
 *               region:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ad format updated successfully
 *       400:
 *         description: Invalid input
 */
router.put(
    '/ad-formats/:id',
    aiMiddleware.optimizeAdFormat,
    async (req, res) => {
        await adFormatController.updateAdFormat(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/{id}:
 *   delete:
 *     summary: Delete an ad format
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ad format ID
 *     responses:
 *       200:
 *         description: Ad format deleted successfully
 *       403:
 *         description: Forbidden
 */
router.delete(
    '/ad-formats/:id',
    requireRole('admin'),
    async (req, res) => {
        await adFormatController.deleteAdFormat(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats:
 *   get:
 *     summary: Retrieve ad formats
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: Filter by region
 *       - in: query
 *         name: mediaType
 *         schema:
 *           type: string
 *         description: Filter by media type
 *     responses:
 *       200:
 *         description: List of ad formats
 */
router.get(
    '/ad-formats',
    async (req, res) => {
        await adFormatController.getAdFormats(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/{id}:
 *   get:
 *     summary: Retrieve detailed insights about a specific ad format
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ad format ID
 *     responses:
 *       200:
 *         description: Detailed insights about the ad format
 */
router.get(
    '/ad-formats/:id',
    async (req, res) => {
        await adFormatController.getAdFormatDetails(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/leaderboard:
 *   get:
 *     summary: Get leaderboard of top contributors
 *     tags: [Ad Formats]
 *     responses:
 *       200:
 *         description: Leaderboard of top contributors
 */
router.get(
    '/ad-formats/leaderboard',
    async (req, res) => {
        await adFormatController.getLeaderboard(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/{id}/analyze:
 *   get:
 *     summary: Analyze an ad format using AI
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ad format ID
 *     responses:
 *       200:
 *         description: AI analysis of the ad format
 */
router.get(
    '/ad-formats/:id/analyze',
    async (req, res) => {
        await adFormatController.analyzeAdFormat(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

/**
 * @swagger
 * /ad-formats/{id}/blockchain-logs:
 *   get:
 *     summary: Fetch blockchain logs associated with a specific ad format
 *     tags: [Ad Formats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ad format ID
 *     responses:
 *       200:
 *         description: Blockchain logs of the ad format
 */
router.get(
    '/ad-formats/:id/blockchain-logs',
    async (req, res) => {
        await adFormatController.getBlockchainLogs(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

module.exports = router;
// AI-Driven Enhancements
router.post(
    '/ad-formats/recommendations',
    aiMiddleware.provideRecommendations,
    async (req, res) => {
        await adFormatController.getRecommendations(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

router.get(
    '/ad-formats/:id/performance-predictions',
    async (req, res) => {
        await adFormatController.predictPerformance(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// Gamification and Community Engagement
router.post(
    '/ad-formats/:id/reward-points',
    async (req, res) => {
        await adFormatController.rewardPoints(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// Advanced Blockchain Features
router.post(
    '/ad-formats/:id/verify-authenticity',
    async (req, res) => {
        await adFormatController.verifyAuthenticity(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// Security and Compliance
router.use('/ad-formats/:id/delete', requireMFA);
router.use('/ad-formats/:id/analyze', requireMFA);

// Performance and Scalability
const roleBasedLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => (req.user.role === 'admin' ? 200 : 50)
});
router.use(roleBasedLimiter);

// Localization and Accessibility
router.use((req, res, next) => {
    res.setHeader('Content-Language', req.headers['accept-language'] || 'en');
    next();
});

// Real-Time Updates and Notifications
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        // Handle subscription messages
    });
    ws.send('Connected to real-time updates');
});

// Sustainability and Corporate Responsibility
router.get(
    '/ad-formats/:id/sustainability-score',
    async (req, res) => {
        await adFormatController.getSustainabilityScore(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// Data Insights and Reporting
router.get(
    '/ad-formats/reports',
    async (req, res) => {
        await adFormatController.generateReport(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// AI Model Retraining
router.post(
    '/ad-formats/retrain-model',
    async (req, res) => {
        await adFormatController.retrainModel(req, res);
        requestCounter.inc({ method: req.method, route: req.route.path, status_code: res.statusCode });
    }
);

// Error Handling and Logging
router.use(Sentry.Handlers.errorHandler());
router.use((err, req, res, next) => {
    Sentry.captureException(err);
    res.status(500).json({ error: 'Internal Server Error' });
});