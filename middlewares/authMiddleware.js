const jwt = require('jsonwebtoken');
const redis = require('redis');
const i18n = require('i18n');
const Sentry = require('@sentry/node');
const { promisify } = require('util');
const { getUserRoles, logEventToBlockchain, detectAnomalies, alertAdmin } = require('./utils');
const promClient = require('prom-client');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createCipheriv, createDecipheriv, generateKeyPairSync } = require('crypto');

// RSA key pair generation for JWT
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Redis client setup
const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const pipeline = client.pipeline();

// Localization setup
i18n.configure({
    locales: ['en', 'es', 'fr', 'de', 'zh'],
    directory: __dirname + '/locales',
    fallbacks: { 'es': 'en', 'fr': 'en', 'de': 'en', 'zh': 'en' }
});

// Sentry initialization
Sentry.init({ dsn: process.env.SENTRY_DSN });

// Prometheus metrics setup
const loginAttemptsCounter = new promClient.Counter({
    name: 'login_attempts_total',
    help: 'Total login attempts',
    labelNames: ['status']
});
const anomalyDetectionCounter = new promClient.Counter({
    name: 'anomaly_detection_total',
    help: 'Total anomaly detections',
    labelNames: ['status']
});
const tokenRefreshCounter = new promClient.Counter({
    name: 'token_refresh_total',
    help: 'Total token refresh attempts',
    labelNames: ['status']
});
const blacklistHitsCounter = new promClient.Counter({
    name: 'blacklist_hits_total',
    help: 'Total JWT blacklist hits',
    labelNames: ['status']
});

// JWT signing options
const jwtOptions = {
    expiresIn: '1h',
    algorithm: 'RS256'
};

// Helper to encrypt and decrypt sensitive data
const encryptData = (data) => {
    const cipher = createCipheriv('aes-256-cbc', process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_IV);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
};

// Rate limiter for login attempts
const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: i18n.__('Too many login attempts, please try again later.')
});

// Middleware for authentication
const authenticate = async (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) {
        loginAttemptsCounter.inc({ status: 'failed' });
        return res.status(401).json({ message: i18n.__('Token is required') });
    }

    try {
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        const blacklisted = await getAsync(`blacklist_${token}`);
        if (blacklisted) {
            blacklistHitsCounter.inc({ status: 'hit' });
            loginAttemptsCounter.inc({ status: 'failed' });
            return res.status(401).json({ message: i18n.__('Token is blacklisted') });
        }

        req.user = decoded;
        loginAttemptsCounter.inc({ status: 'success' });
        next();
    } catch (error) {
        Sentry.captureException(error);
        loginAttemptsCounter.inc({ status: 'failed' });
        return res.status(401).json({ message: i18n.__('Invalid token') });
    }
};

// Middleware for authorization
const authorize = (roles) => async (req, res, next) => {
    try {
        const userRoles = await getUserRoles(req.user.id);
        if (!roles.some(role => userRoles.includes(role))) {
            return res.status(403).json({ message: i18n.__('Access denied') });
        }
        next();
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Middleware for refreshing tokens
const refreshToken = async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ message: i18n.__('Token is required') });
    }

    try {
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'], ignoreExpiration: true });
        const newToken = jwt.sign({ id: decoded.id, roles: decoded.roles }, privateKey, jwtOptions);
        tokenRefreshCounter.inc({ status: 'success' });
        res.json({ token: newToken });
    } catch (error) {
        Sentry.captureException(error);
        tokenRefreshCounter.inc({ status: 'failed' });
        return res.status(400).json({ message: i18n.__('Invalid token') });
    }
};

// Middleware for logout
const logout = async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(400).json({ message: i18n.__('Token is required') });
    }

    try {
        await pipeline.set(`blacklist_${token}`, 'true', 'EX', 3600).exec(); // Blacklist token for 1 hour
        await logEventToBlockchain(req.user.id, 'logout');
        res.json({ message: i18n.__('Logged out successfully') });
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Middleware for fraud detection
const detectFraud = async (req, res, next) => {
    try {
        const anomalies = await detectAnomalies(req.user.id, req.ip);
        if (anomalies) {
            anomalyDetectionCounter.inc({ status: 'detected' });
            alertAdmin(`Suspicious activity detected for user ${req.user.id}`);
            return res.status(403).json({ message: i18n.__('Suspicious activity detected') });
        }
        next();
    } catch (error) {
        Sentry.captureException(error);
        anomalyDetectionCounter.inc({ status: 'error' });
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Enhanced error handling middleware
const errorHandler = (err, req, res, next) => {
    Sentry.captureException(err);
    console.error(err.stack);
    res.status(500).json({ message: i18n.__('An unexpected error occurred'), eventId: Sentry.getCurrentHub().lastEventId() });
};

module.exports = {
    authenticate,
    authorize,
    refreshToken,
    logout,
    detectFraud,
    errorHandler,
    loginRateLimiter
};
// Middleware for secondary factor authentication (e.g., OTP)
const secondaryFactorAuth = async (req, res, next) => {
    const { otp } = req.body;
    if (!otp) {
        return res.status(400).json({ message: i18n.__('OTP is required') });
    }

    try {
        const isValidOtp = await verifyOtp(req.user.id, otp); // Assume verifyOtp is a function that verifies the OTP
        if (!isValidOtp) {
            return res.status(401).json({ message: i18n.__('Invalid OTP') });
        }
        next();
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Middleware for dynamic token scope
const issueScopedToken = (permissions) => async (req, res) => {
    try {
        const token = jwt.sign({ id: req.user.id, roles: req.user.roles, permissions }, privateKey, jwtOptions);
        res.json({ token });
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Middleware for AI-powered anomaly insights
const aiAnomalyInsights = async (req, res, next) => {
    try {
        const insights = await classifyAnomalies(req.user.id, req.ip); // Assume classifyAnomalies is a function that uses AI to classify anomalies
        if (insights) {
            alertAdmin(`Anomaly insights for user ${req.user.id}: ${insights}`);
            return res.status(403).json({ message: i18n.__('Anomaly detected'), insights });
        }
        next();
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Middleware for Zero Trust enhancements
const enforceZeroTrust = async (req, res, next) => {
    try {
        const userPolicies = await getUserPolicies(req.user.id); // Assume getUserPolicies fetches user-specific policies
        if (!userPolicies.allowedIPs.includes(req.ip)) {
            return res.status(403).json({ message: i18n.__('Access denied from this IP') });
        }
        next();
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({ message: i18n.__('Server error') });
    }
};

// Enhanced logging middleware
const enrichedLogging = (req, res, next) => {
    const traceId = crypto.randomBytes(16).toString('hex');
    req.traceId = traceId;
    console.log(`[TRACE ID: ${traceId}] ${req.method} ${req.url}`);
    next();
};

module.exports = {
    authenticate,
    authorize,
    refreshToken,
    logout,
    detectFraud,
    errorHandler,
    loginRateLimiter,
    secondaryFactorAuth,
    issueScopedToken,
    aiAnomalyInsights,
    enforceZeroTrust,
    enrichedLogging
};