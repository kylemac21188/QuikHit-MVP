const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const RedisRateLimiter = require('../middleware/redisRateLimiter'); // Redis-backed rate limiter
const authMiddleware = require('../middleware/authMiddleware');
const mfaMiddleware = require('../middleware/mfaMiddleware'); // MFA checks middleware
const aiThreatDetection = require('../services/aiThreatDetection'); // AI-driven threat detection service
const Prometheus = require('prom-client');
const Blockchain = require('../services/Blockchain');
const User = require('../models/User');
const WebsocketManager = require('../services/WebsocketManager');
const winston = require('winston');
const ABAC = require('../services/abac'); // Attribute-Based Access Control service
const { addCorrelationId } = require('../middleware/correlationId'); // Request tracing middleware

const router = express.Router();

// Logger setup
const logger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'auth.log' })
    ]
});

// Prometheus metrics setup
const loginAttempts = new Prometheus.Counter({
    name: 'login_attempts_total',
    help: 'Total number of login attempts'
});
const loginFailures = new Prometheus.Counter({
    name: 'login_failures_total',
    help: 'Total number of failed login attempts'
});
const loginSuccesses = new Prometheus.Counter({
    name: 'login_successes_total',
    help: 'Total number of successful login attempts'
});

// Middleware to track metrics and add correlation ID
router.use(addCorrelationId);
router.use((req, res, next) => {
    loginAttempts.inc();
    next();
});

// Initiate Twitch OAuth flow
router.get('/auth/twitch', passport.authenticate('twitch'));

// Handle Twitch OAuth callback
router.get('/auth/twitch/callback', passport.authenticate('twitch', { failureRedirect: '/' }), async (req, res) => {
    try {
        const user = await User.findOrCreate(
            { twitchId: req.user.id },
            { username: req.user.username, role: 'streamer' }
        );

        // AI-driven anomaly detection
        aiThreatDetection.logLoginEvent(req.ip, req.user);

        // Blockchain logging
        Blockchain.logEvent('USER_LOGIN', { userId: user.id, timestamp: new Date() });

        // Generate short-lived JWT and refresh token
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign({ id: user.id }, process.env.REFRESH_SECRET, { expiresIn: '7d' });

        res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true });
        res.status(200).json({ token });
        WebsocketManager.notifyLogin(user.id);
    } catch (error) {
        logger.error('Error during Twitch OAuth callback', error);
        res.redirect('/');
    }
});

// MFA-protected login route
router.post('/auth/login', [
    body('username').isString().notEmpty(),
    body('password').isString().notEmpty()
], RedisRateLimiter, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        loginFailures.inc();
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const user = await User.authenticate(req.body.username, req.body.password);
        if (!user) {
            loginFailures.inc();
            return res.status(401).send('Invalid credentials');
        }

        // Verify MFA
        if (user.mfaEnabled) {
            mfaMiddleware.verify(req, res, user);
            return; // Stop further processing until MFA is verified
        }

        // Generate JWT and refresh token
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign({ id: user.id }, process.env.REFRESH_SECRET, { expiresIn: '7d' });

        loginSuccesses.inc();
        Blockchain.logEvent('USER_LOGIN', { userId: user.id, timestamp: new Date() });

        res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true });
        res.status(200).json({ token });
        WebsocketManager.notifyLogin(user.id);
    } catch (error) {
        logger.error('Error during login', error);
        res.status(500).send('Internal server error');
    }
});

// Logout route with session revocation
router.post('/auth/logout', authMiddleware, async (req, res) => {
    try {
        await User.revokeSession(req.user.id);
        Blockchain.logEvent('USER_LOGOUT', { userId: req.user.id, timestamp: new Date() });
        res.clearCookie('refreshToken');
        res.status(200).send('Logged out');
        WebsocketManager.notifyLogout(req.user.id);
    } catch (error) {
        logger.error('Error during logout', error);
        res.status(500).send('Internal server error');
    }
});

// Role-based and attribute-based access control
router.post('/auth/assign-role', [
    body('userId').isString().notEmpty(),
    body('role').isString().notEmpty()
], authMiddleware, ABAC.enforce({ action: 'assignRole' }), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const user = await User.findById(req.body.userId);
        user.role = req.body.role;
        await user.save();

        Blockchain.logEvent('ROLE_ASSIGNMENT', { userId: user.id, role: req.body.role, timestamp: new Date() });
        res.status(200).send('Role assigned');
    } catch (error) {
        logger.error('Error assigning role', error);
        res.status(500).send('Internal server error');
    }
});

// Metrics endpoint
router.get('/metrics', async (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType);
    res.end(await Prometheus.register.metrics());
});

// Export the router
module.exports = router;
