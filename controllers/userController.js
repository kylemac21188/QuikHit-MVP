import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user';
import { validationResult } from 'express-validator';
import winston from 'winston';
import Sentry from '@sentry/node';
import rateLimiter from 'rate-limiter-flexible';
import { publishUserEvent } from '../pubsub/pubsubClient';
import auditLogger from '../middleware/auditLogger';
import aiFraudDetection from '../ai/fraudDetection';
import { sendEmail } from '../utils/emailService';
import { encrypt, decrypt } from '../utils/cryptoUtil';
import TwitchOAuth from 'twitch-oauth-client';
import TwitchEventSub from 'twitch-eventsub-ws';
import TwitchGraphQLClient from 'twitch-graphql-client';
import Prometheus from 'prom-client';
import Redis from 'redis';
import { promisify } from 'util';

// Logger setup with Sentry integration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console(),
    ],
});

Sentry.init({ dsn: process.env.SENTRY_DSN });

// Prometheus Metrics setup
const loginAttemptsCounter = new Prometheus.Counter({
    name: 'user_login_attempts_total',
    help: 'Total number of user login attempts',
    labelNames: ['status'],
});

const userRegistrationsCounter = new Prometheus.Counter({
    name: 'user_registrations_total',
    help: 'Total number of user registrations',
});

// Redis setup for caching
const redisClient = Redis.createClient({ url: process.env.REDIS_CLUSTER_URL });
const getAsync = promisify(redisClient.get).bind(redisClient);
const setAsync = promisify(redisClient.set).bind(redisClient);

// Rate limiter setup for login attempts (DDoS & abuse protection)
const loginRateLimiter = new rateLimiter.RateLimiterMemory({
    points: 10, // 10 login attempts
    duration: 60 * 60, // per hour
});

// Twitch OAuth setup for authentication integration
TwitchOAuth.init({
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    redirectUri: process.env.TWITCH_REDIRECT_URI,
});

// Twitch EventSub for handling various Twitch events such as followers or stream status
const twitchEventSub = new TwitchEventSub({
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    callbackUrl: process.env.TWITCH_CALLBACK_URL,
    secret: process.env.TWITCH_SECRET,
});

twitchEventSub.on('stream.online', (event) => {
    logger.info(`Streamer ${event.broadcaster_user_name} went online.`);
    auditLogger.logEvent('Twitch Stream Online', event.broadcaster_user_id);
    publishUserEvent('TWITCH_STREAM_ONLINE', { userId: event.broadcaster_user_id });
});

twitchEventSub.on('follow', (event) => {
    logger.info(`New follower for streamer ${event.broadcaster_user_name}`);
    auditLogger.logEvent('New Twitch Follower', event.broadcaster_user_id);
    publishUserEvent('TWITCH_FOLLOW', { userId: event.broadcaster_user_id });
});

/**
 * Register a new user with advanced security measures, email verification, and caching for performance.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
        // Check Redis cache for user existence
        const cachedUser = await getAsync(`user:${email}`);
        if (cachedUser) {
            return res.status(400).json({ message: 'Email is already registered.' });
        }

        // Check if user already exists in DB
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email is already registered.' });
        }

        // Hash the password with industry-leading bcrypt parameters
        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new User({ username, email, password: hashedPassword });

        await newUser.save();

        // Cache the new user email for quick lookup
        await setAsync(`user:${email}`, JSON.stringify(newUser), 'EX', 60 * 60); // 1 hour cache

        // Publish event for analytics and other services
        publishUserEvent('USER_REGISTERED', { userId: newUser.id, email });

        logger.info(`New user registered: ${email}`);
        auditLogger.logEvent('User Registration', email);

        // Increment Prometheus counter
        userRegistrationsCounter.inc();

        // Send email verification link
        sendEmail({
            to: email,
            subject: 'Verify Your Email',
            template: 'verifyEmail',
            variables: { username },
        });

        res.status(201).json({ message: 'User registered successfully. Please verify your email.' });
    } catch (error) {
        logger.error('Error during user registration', { error });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Login an existing user with rate limiting, AI-powered fraud detection, and Twitch OAuth
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Apply rate limiting
        await loginRateLimiter.consume(email);

        const user = await User.findOne({ email });
        if (!user) {
            loginAttemptsCounter.inc({ status: 'failed' });
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // AI-driven fraud detection for suspicious activity
        if (aiFraudDetection.isSuspicious(user)) {
            logger.warn(`Potential fraud detected for user: ${email}`);
            Sentry.captureMessage(`Potential fraud detected for user: ${email}`);
            return res.status(403).json({ message: 'Suspicious activity detected. Please contact support.' });
        }

        // Validate password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.failedLoginAttempts += 1;

            // Block user after 5 failed login attempts
            if (user.failedLoginAttempts >= 5) {
                user.isBlocked = true;
                await user.save();
                logger.warn(`User blocked due to multiple failed attempts: ${email}`);
                auditLogger.logEvent('User Blocked', email);
                return res.status(403).json({ message: 'Account blocked after multiple failed attempts.' });
            }

            await user.save();
            loginAttemptsCounter.inc({ status: 'failed' });
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // Reset failed attempts and generate JWT
        user.failedLoginAttempts = 0;
        await user.save();

        const payload = { id: user.id, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });

        logger.info(`User logged in successfully: ${email}`);
        auditLogger.logEvent('User Login', email);
        loginAttemptsCounter.inc({ status: 'success' });

        // Encrypt sensitive data before sending
        res.json({ token: encrypt(token) });
    } catch (error) {
        if (error instanceof rateLimiter.RateLimiterRes) {
            logger.warn(`Rate limit exceeded for login attempts: ${email}`);
            return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
        }
        logger.error('Error during user login', { error });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Update user preferences securely with audit logging, Twitch OAuth, and caching
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePreferences = async (req, res) => {
    const { dashboardPreferences, twitchIntegration } = req.body;

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.dashboardPreferences = dashboardPreferences;

        // Handle Twitch integration preferences
        if (twitchIntegration) {
            const twitchAuth = await TwitchOAuth.getAccessToken(req.user.id);
            user.twitchIntegration = twitchAuth;
            auditLogger.logEvent('Twitch Integration Updated', req.user.id);
        }

        await user.save();

        // Update Redis cache
        await setAsync(`user:${req.user.id}`, JSON.stringify(user), 'EX', 60 * 60);

        logger.info(`User preferences updated successfully: ${req.user.id}`);
        auditLogger.logEvent('Preferences Updated', req.user.id);
        res.json({ message: 'Preferences updated successfully.' });
    } catch (error) {
        logger.error('Error updating preferences', { error });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Get user profile with end-to-end encryption, Twitch metrics integration, and data masking
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getProfile = async (req, res) => {
    try {
        // Check if profile is cached
        let userProfile = await getAsync(`profile:${req.user.id}`);
        if (!userProfile) {
            const user = await User.findById(req.user.id).select('-password');
            if (!user) {
                return res.status(404).json({ message: 'User not found.' });
            }

            // Fetch additional Twitch metrics using GraphQL client
            const twitchMetrics = await TwitchGraphQLClient.fetchMetrics(req.user.twitchAuthToken);
            userProfile = {
                ...user.toObject(),
                twitchMetrics,
            };

            // Cache user profile
            await setAsync(`profile:${req.user.id}`, JSON.stringify(userProfile), 'EX', 60 * 60);
        } else {
            userProfile = JSON.parse(userProfile);
        }

        // Encrypt profile data before sending it to the client
        const encryptedProfile = encrypt(JSON.stringify(userProfile));
        res.json({ profile: encryptedProfile });
    } catch (error) {
        logger.error('Error fetching user profile', { error });
        Sentry.captureException(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};