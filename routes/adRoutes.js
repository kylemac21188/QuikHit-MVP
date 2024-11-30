const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimiter = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/authMiddleware');
const ABAC = require('../services/abac');
const Prometheus = require('prom-client');
const Blockchain = require('../services/Blockchain');
const AdController = require('../controllers/adController');
const TwitchAPI = require('../integrations/twitchIntegration');
const AIAdOptimizer = require('../services/AIAdOptimizer'); // AI service for ad recommendations
const logger = require('../services/logger');
const { addCorrelationId } = require('../middleware/correlationId'); // Request tracing
const WebSocket = require('ws');

const router = express.Router();

// Prometheus Metrics for ad management
const adRequests = new Prometheus.Counter({
    name: 'ad_requests_total',
    help: 'Total number of ad-related requests'
});
const adErrors = new Prometheus.Counter({
    name: 'ad_errors_total',
    help: 'Total number of ad-related errors'
});
const adPerformance = new Prometheus.Gauge({
    name: 'ad_performance_score',
    help: 'Performance score of ads based on engagement and success'
});

// Middleware for tracking metrics and adding correlation ID
router.use(addCorrelationId);
router.use((req, res, next) => {
    adRequests.inc();
    next();
});

// 1. Create a new ad with AI optimization
router.post('/create', [
    body('title').isString().notEmpty(),
    body('content').isString().notEmpty(),
    body('targetAudience').isArray(),
    body('budget').isFloat({ min: 1 }),
    body('streamerId').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'createAd' }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        adErrors.inc();
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        // AI-driven content and targeting optimization
        const optimizedAd = await AIAdOptimizer.optimizeAd(req.body);

        const ad = await AdController.createAd(optimizedAd);
        Blockchain.logEvent('AD_CREATED', { adId: ad.id, timestamp: new Date() });

        // Record AI-assessed ad performance score
        adPerformance.set(ad.performanceScore);

        res.status(201).json({ message: 'Ad created successfully', ad });
        logger.info(`Ad created: ${ad.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error creating ad', error);
        res.status(500).send('Internal server error');
    }
});

// 2. Update an existing ad with performance insights
router.put('/update/:id', [
    body('title').optional().isString(),
    body('content').optional().isString(),
    body('targetAudience').optional().isArray(),
    body('budget').optional().isFloat({ min: 1 })
], authMiddleware, ABAC.enforce({ action: 'updateAd' }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        adErrors.inc();
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const updatedAd = await AdController.updateAd(req.params.id, req.body);

        // AI analysis on updated ad
        const performanceScore = await AIAdOptimizer.assessAdPerformance(updatedAd);
        adPerformance.set(performanceScore);

        Blockchain.logEvent('AD_UPDATED', { adId: req.params.id, timestamp: new Date() });

        res.status(200).json({ message: 'Ad updated successfully', updatedAd, performanceScore });
        logger.info(`Ad updated: ${req.params.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error updating ad', error);
        res.status(500).send('Internal server error');
    }
});

// 3. Delete an ad with blockchain transparency
router.delete('/delete/:id', authMiddleware, ABAC.enforce({ action: 'deleteAd' }), async (req, res) => {
    try {
        await AdController.deleteAd(req.params.id);
        Blockchain.logEvent('AD_DELETED', { adId: req.params.id, timestamp: new Date() });
        res.status(200).json({ message: 'Ad deleted successfully' });
        logger.info(`Ad deleted: ${req.params.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error deleting ad', error);
        res.status(500).send('Internal server error');
    }
});

// 4. Get ads for a specific streamer with engagement analytics
router.get('/streamer/:streamerId', authMiddleware, ABAC.enforce({ action: 'viewAds' }), async (req, res) => {
    try {
        const ads = await AdController.getAdsByStreamer(req.params.streamerId);

        // Include engagement analytics in the response
        const analytics = await AdController.getAdEngagementAnalytics(ads);

        res.status(200).json({ ads, analytics });
        logger.info(`Fetched ads for streamer: ${req.params.streamerId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error fetching ads', error);
        res.status(500).send('Internal server error');
    }
});

// 5. Real-time ad overlay for Twitch with fraud detection
router.post('/overlay', [
    body('adId').isString().notEmpty(),
    body('streamerId').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'overlayAd' }), async (req, res) => {
    try {
        // Fraud detection
        const isValid = await AdController.verifyAd(req.body.adId);
        if (!isValid) {
            adErrors.inc();
            return res.status(400).json({ message: 'Ad verification failed' });
        }

        const overlayStatus = await TwitchAPI.displayAdOverlay(req.body.streamerId, req.body.adId);

        res.status(200).json({ message: 'Ad overlay triggered', overlayStatus });
        logger.info(`Ad overlay triggered for streamer: ${req.body.streamerId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error triggering ad overlay', error);
        res.status(500).send('Internal server error');
    }
});

// Export the router
module.exports = router;
// 6. Place bids on premium ad spaces in real time
router.post('/bid', [
    body('adId').isString().notEmpty(),
    body('bidAmount').isFloat({ min: 1 }).notEmpty(),
    body('advertiserId').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'placeBid' }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        adErrors.inc();
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const bid = await AdController.placeBid(req.body);
        Blockchain.logEvent('BID_PLACED', { bidId: bid.id, timestamp: new Date() });
        res.status(201).json({ message: 'Bid placed successfully', bid });
        logger.info(`Bid placed: ${bid.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error placing bid', error);
        res.status(500).send('Internal server error');
    }
});

// 7. Extend real-time ad overlays to multiple platforms
router.post('/overlay/multi', [
    body('adId').isString().notEmpty(),
    body('streamerId').isString().notEmpty(),
    body('platforms').isArray().notEmpty() // List of platforms (e.g., Twitch, YouTube, Facebook Live)
], authMiddleware, ABAC.enforce({ action: 'overlayAdMulti' }), async (req, res) => {
    try {
        const overlayStatus = await AdController.displayAdOverlayMulti(req.body);
        res.status(200).json({ message: 'Ad overlay triggered on multiple platforms', overlayStatus });
        logger.info(`Ad overlay triggered on multiple platforms for streamer: ${req.body.streamerId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error triggering ad overlay on multiple platforms', error);
        res.status(500).send('Internal server error');
    }
});

// 8. Collect user feedback on ad effectiveness
router.post('/feedback', [
    body('adId').isString().notEmpty(),
    body('streamerId').isString().notEmpty(),
    body('feedback').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'submitFeedback' }), async (req, res) => {
    try {
        const feedback = await AdController.collectFeedback(req.body);
        const sentiment = await AIAdOptimizer.analyzeSentiment(feedback);
        Blockchain.logEvent('FEEDBACK_COLLECTED', { feedbackId: feedback.id, timestamp: new Date() });
        res.status(201).json({ message: 'Feedback submitted successfully', feedback, sentiment });
        logger.info(`Feedback submitted for ad: ${req.body.adId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error submitting feedback', error);
        res.status(500).send('Internal server error');
    }
});

// 9. Provide sustainability metrics for ad campaigns
router.get('/sustainability/:advertiserId', authMiddleware, ABAC.enforce({ action: 'viewSustainabilityMetrics' }), async (req, res) => {
    try {
        const metrics = await AdController.getSustainabilityMetrics(req.params.advertiserId);
        res.status(200).json({ metrics });
        logger.info(`Sustainability metrics fetched for advertiser: ${req.params.advertiserId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error fetching sustainability metrics', error);
        res.status(500).send('Internal server error');
    }
});
// 10. Bulk ad creation and budget distribution across campaigns
router.post('/campaigns/create', [
    body('campaignName').isString().notEmpty(),
    body('ads').isArray().notEmpty(), // Array of ad details
    body('totalBudget').isFloat({ min: 1 }).notEmpty()
], authMiddleware, ABAC.enforce({ action: 'createCampaign' }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        adErrors.inc();
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const campaign = await AdController.createCampaign(req.body);
        Blockchain.logEvent('CAMPAIGN_CREATED', { campaignId: campaign.id, timestamp: new Date() });
        res.status(201).json({ message: 'Campaign created successfully', campaign });
        logger.info(`Campaign created: ${campaign.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error creating campaign', error);
        res.status(500).send('Internal server error');
    }
});

// 11. Pause, resume, or terminate campaigns dynamically
router.post('/campaigns/:id/status', [
    body('status').isIn(['pause', 'resume', 'terminate']).notEmpty()
], authMiddleware, ABAC.enforce({ action: 'updateCampaignStatus' }), async (req, res) => {
    try {
        const campaign = await AdController.updateCampaignStatus(req.params.id, req.body.status);
        Blockchain.logEvent('CAMPAIGN_STATUS_UPDATED', { campaignId: req.params.id, status: req.body.status, timestamp: new Date() });
        res.status(200).json({ message: `Campaign ${req.body.status}d successfully`, campaign });
        logger.info(`Campaign ${req.body.status}d: ${req.params.id}`);
    } catch (error) {
        adErrors.inc();
        logger.error(`Error ${req.body.status}ing campaign`, error);
        res.status(500).send('Internal server error');
    }
});

// 12. Real-time notifications via WebSocket
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        console.log('received: %s', message);
    });
});

router.post('/notify', [
    body('event').isString().notEmpty(),
    body('data').isObject().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'sendNotification' }), (req, res) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ event: req.body.event, data: req.body.data }));
        }
    });
    res.status(200).json({ message: 'Notification sent' });
    logger.info(`Notification sent: ${req.body.event}`);
});

// 13. AI-powered bid success prediction
router.post('/predictBidSuccess', [
    body('adId').isString().notEmpty(),
    body('bidAmount').isFloat({ min: 1 }).notEmpty()
], authMiddleware, ABAC.enforce({ action: 'predictBidSuccess' }), async (req, res) => {
    try {
        const prediction = await AIAdOptimizer.predictBidSuccess(req.body);
        res.status(200).json({ prediction });
        logger.info(`Bid success prediction: ${req.body.adId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error predicting bid success', error);
        res.status(500).send('Internal server error');
    }
});

// 14. Localization support for ads
router.post('/localize', [
    body('adId').isString().notEmpty(),
    body('language').isString().notEmpty(),
    body('region').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'localizeAd' }), async (req, res) => {
    try {
        const localizedAd = await AdController.localizeAd(req.body);
        res.status(200).json({ message: 'Ad localized successfully', localizedAd });
        logger.info(`Ad localized: ${req.body.adId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error localizing ad', error);
        res.status(500).send('Internal server error');
    }
});

// 15. Granular analytics dashboards
router.get('/analytics/:advertiserId', authMiddleware, ABAC.enforce({ action: 'viewAnalytics' }), async (req, res) => {
    try {
        const analytics = await AdController.getAnalytics(req.params.advertiserId);
        res.status(200).json({ analytics });
        logger.info(`Analytics fetched for advertiser: ${req.params.advertiserId}`);
    } catch (error) {
        adErrors.inc();
        logger.error('Error fetching analytics', error);
        res.status(500).send('Internal server error');
    }
});