import express from 'express';
import mongoose from 'mongoose';
import WebSocket from 'ws';
import winston from 'winston';
import Prometheus from 'prom-client';
import opossum from 'opossum';
import axios from 'axios';
import crypto from 'crypto';
import Stripe from 'stripe';
import tmi from 'tmi.js';
import Web3 from 'web3';
import Sentry from '@sentry/node';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import React, { useState } from 'react';
// Redis Failover Configuration
redisClient.on('error', (err) => {
    logger.error('Redis error', err);
});

// Setup
const app = express();
app.use(express.json());

// Logger Configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.File({ filename: 'obsPlugin.log' })]
});

// Prometheus Metrics Setup
const connectionAttempts = new Prometheus.Counter({
    name: 'obs_connection_attempts',
    help: 'Number of attempts to connect to OBS WebSocket',
    labelNames: ['streamer_id']
});
const connectionFailures = new Prometheus.Counter({
    name: 'obs_connection_failures',
    help: 'Number of WebSocket connection failures',
    labelNames: ['streamer_id']
});
const sceneSwitches = new Prometheus.Counter({
    name: 'obs_scene_switches',
    help: 'Number of scene switches',
    labelNames: ['streamer_id']
});
const adRenderAttempts = new Prometheus.Counter({
    name: 'ad_render_attempts',
    help: 'Number of attempts to render ads in OBS',
    labelNames: ['streamer_id', 'ad_id']
});
const adClicks = new Prometheus.Counter({
    name: 'ad_clicks',
    help: 'Number of ad clicks from viewers',
    labelNames: ['streamer_id', 'ad_id']
});

// MongoDB Setup
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Schema Definitions
const campaignSchema = new mongoose.Schema({
    advertiser: String,
    budget: Number,
    adContent: String,
    status: String
});
const bidSchema = new mongoose.Schema({
    campaignId: mongoose.Schema.Types.ObjectId,
    bidAmount: Number,
    streamer: String,
    status: String
});
const Campaign = mongoose.model('Campaign', campaignSchema);
const Bid = mongoose.model('Bid', bidSchema);

// WebSocket Manager with Enhanced Circuit Breaker and Exponential Backoff
class WebSocketManager {
    constructor(urls, maxConnections, logger) {
        this.urls = urls;
        this.maxConnections = maxConnections;
        this.logger = logger;
        this.connections = [];
        this.currentServerIndex = 0;
        this.initCircuitBreaker();
    }

    initCircuitBreaker() {
        const circuitBreakerOptions = {
            timeout: 3000,
            errorThresholdPercentage: 50,
            resetTimeout: 10000
        };
        this.connectBreaker = new opossum((wsUrl) => {
            return new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl);

                ws.on('open', () => {
                    this.logger.info('WebSocket connection established');
                    connectionAttempts.labels({ streamer_id: 'default' }).inc();
                    resolve(ws);
                });

                ws.on('error', (error) => {
                    this.logger.error('WebSocket error', error);
                    connectionFailures.labels({ streamer_id: 'default' }).inc();
                    reject(error);
                });

                ws.on('close', () => {
                    this.logger.warn('WebSocket connection closed');
                    this.reconnectWithBackoff();
                });
            });
        }, circuitBreakerOptions);

        this.connectBreaker.fallback(() => {
            this.logger.error('Circuit breaker fallback: Unable to connect to OBS WebSocket');
        });
    }

    getNextWebSocketUrl() {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.urls.length;
        return this.urls[this.currentServerIndex];
    }

    createConnection() {
        const wsUrl = this.getNextWebSocketUrl();
        this.connectBreaker.fire(wsUrl).then(ws => {
            ws.on('message', (data) => this.handleWebSocketMessage(data));
        }).catch(error => {
            this.logger.error('Failed to establish WebSocket connection', error);
        });
    }

    reconnectWithBackoff(retries = 0) {
        const maxRetries = 5;
        if (retries >= maxRetries) {
            this.logger.error('Max retries reached for WebSocket connection');
            return;
        }
        const backoffTime = Math.pow(2, retries) * 1000; // Exponential backoff
        setTimeout(() => {
            this.createConnection();
            this.reconnectWithBackoff(retries + 1);
        }, backoffTime);
    }

    initConnections() {
        for (let i = 0; i < this.maxConnections; i++) {
            this.createConnection();
        }
    }

    handleWebSocketMessage(data) {
        const message = JSON.parse(data);
        this.logger.info(`Received WebSocket message: ${message.type}`);
        if (message.updateType === 'SwitchScenes') {
            sceneSwitches.labels({ streamer_id: 'default' }).inc();
            this.logger.info(`Scene switched to: ${message.sceneName}`);
        }
    }
}

// Ad Manager with Priority Scheduling and Rate Limiting
class AdManager {
    constructor(ws, logger) {
        this.ws = ws;
        this.logger = logger;
        this.lastAdTime = 0;
        this.adInterval = 60000; // 1 minute interval between ads
    }

    renderAdOverlay(ad) {
        const overlay = {
            sourceName: ad.id,
            sourceSettings: {
                url: ad.assetUrl,
                width: ad.width,
                height: ad.height
            }
        };
        this.ws.send(JSON.stringify({
            requestType: 'CreateSource',
            sourceName: overlay.sourceName,
            sourceKind: 'browser_source',
            sourceSettings: overlay.sourceSettings
        }));
        adRenderAttempts.labels({ streamer_id: 'default', ad_id: ad.id }).inc();
        this.logger.info(`Rendered ad overlay for ${ad.id}`);
    }

    scheduleAds(adList) {
        const sortedAds = adList.sort((a, b) => b.priority - a.priority); // Prioritize ads with higher priority
        sortedAds.forEach(ad => {
            setTimeout(() => {
                const currentTime = Date.now();
                if (currentTime - this.lastAdTime >= this.adInterval && this.shouldDisplayAd(ad)) {
                    this.renderAdOverlay(ad);
                    this.trackAdClicks(ad);
                    this.lastAdTime = currentTime;
                }
            }, ad.scheduleTime);
        });
    }

    trackAdClicks(ad) {
        // Placeholder for tracking clicks through WebSocket or Twitch integration
        adClicks.labels({ streamer_id: 'default', ad_id: ad.id }).inc(); // Mock increment
        this.logger.info(`Tracking ad clicks for ${ad.id}`);
    }

    shouldDisplayAd(ad) {
        // Logic for determining if the ad should be displayed, based on viewer engagement metrics
        return ad.viewerEngagement >= 50; // Example condition for MVP
    }
}

// AI-Powered Ad Manager
class AIPoweredAdManager {
    constructor(logger) {
        this.logger = logger;
    }

    optimizeAdPlacement(adMetrics) {
        this.logger.info('Optimizing ad placement based on metrics', adMetrics);
        // Example logic for optimization, will be expanded as more data is collected
    }

    detectFraudulentActivity(adMetrics) {
        this.logger.info('Checking for fraudulent activity', adMetrics);
        // Fraud detection logic with anomaly detection (Placeholder)
    }
}

// Blockchain Ad Tracker with Circuit Breaker and Alert Mechanism
class BlockchainAdTracker {
    constructor(logger) {
        this.logger = logger;
        this.web3 = new Web3(new Web3.providers.HttpProvider(process.env.BLOCKCHAIN_NODE_URL));
        this.contract = new this.web3.eth.Contract(
            JSON.parse(process.env.BLOCKCHAIN_CONTRACT_ABI),
            process.env.BLOCKCHAIN_CONTRACT_ADDRESS
        );
        this.initCircuitBreaker();
    }

    initCircuitBreaker() {
        const circuitBreakerOptions = {
            timeout: 5000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000
        };
        this.circuitBreaker = new opossum(this.logAdActivity.bind(this), circuitBreakerOptions);

        this.circuitBreaker.fallback(() => {
            this.logger.error('Circuit breaker fallback: Unable to log ad activity on blockchain');
            this.sendAlert('Blockchain logging failed multiple times');
        });
    }

    async logAdActivity(adId, impressions, clicks) {
        try {
            const accounts = await this.web3.eth.getAccounts();
            const receipt = await this.contract.methods.logAdActivity(adId, impressions, clicks).send({
                from: accounts[0],
                gas: 3000000
            });
            this.logger.info(`Ad activity logged on blockchain for ad ${adId}`, receipt);
        } catch (error) {
            this.logger.error('Failed to log ad activity on blockchain', error);
            throw error;
        }
    }

    sendAlert(message) {
        // Placeholder for alert mechanism (e.g., email or dashboard notification)
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.ALERT_EMAIL,
                pass: process.env.ALERT_EMAIL_PASSWORD
            }
        });

        const mailOptions = {
            from: process.env.ALERT_EMAIL,
            to: process.env.ALERT_EMAIL,
            subject: 'Blockchain Ad Tracker Alert',
            text: message
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                this.logger.error('Failed to send alert email', error);
            } else {
                this.logger.info('Alert email sent: ' + info.response);
            }
        });
    }
}

// User Authentication Middleware using JWT
const authenticateUser = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).send({ error: 'Unauthorized' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).send({ error: 'Unauthorized' });
    }
};

// Twitch Integration - OAuth2 and Chat Engagement
const twitchChatClient = new tmi.Client({
    options: { debug: true },
    connection: {
        reconnect: true,
        secure: true
    },
    identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: `oauth:${process.env.TWITCH_BOT_OAUTH_TOKEN}`
    },
    channels: [process.env.TWITCH_CHANNEL]
});
twitchChatClient.connect();

twitchChatClient.on('message', (channel, tags, message, self) => {
    if (self) return;
    if (message.toLowerCase() === '!adinfo') {
        twitchChatClient.say(channel, `Current ad campaign: Displaying ads from various sponsors`);
    }
});

// Twitch EventSub for Real-Time Notifications
const subscribeToTwitchEvents = async () => {
    const eventTypes = ['stream.online', 'channel.subscribe', 'channel.follow'];
    for (const eventType of eventTypes) {
        try {
            await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
                type: eventType,
                version: '1',
                condition: { broadcaster_user_id: process.env.TWITCH_BROADCASTER_ID },
                transport: {
                    method: 'webhook',
                    callback: process.env.TWITCH_EVENTSUB_CALLBACK,
                    secret: process.env.TWITCH_EVENTSUB_SECRET
                }
            }, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`
                }
            });
            logger.info(`Successfully subscribed to Twitch Event: ${eventType}`);
        } catch (error) {
            logger.error(`Failed to subscribe to Twitch Event: ${eventType}`, error);
        }
    }
};
subscribeToTwitchEvents();

// API Endpoints for Viewer Engagement Metrics
app.get('/api/viewerEngagement', authenticateUser, async (req, res) => {
    try {
        const metrics = {
            adClicks: await adClicks.get(),
            adRenderAttempts: await adRenderAttempts.get(),
            sceneSwitches: await sceneSwitches.get()
        };
        res.status(200).json(metrics);
    } catch (error) {
        logger.error('Failed to fetch viewer engagement metrics', error);
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

// Example Usage
const OBS_WEBSOCKET_URLS = [
    process.env.OBS_WEBSOCKET_URL_PRIMARY,
    process.env.OBS_WEBSOCKET_URL_SECONDARY
];
const wsManager = new WebSocketManager(OBS_WEBSOCKET_URLS, 2, logger);
wsManager.initConnections();

const adManager = new AdManager(wsManager, logger);
adManager.scheduleAds([]); // Pass ad list here

const aiAdManager = new AIPoweredAdManager(logger);
const adMetrics = { impressions: 1000, clicks: 50, viewerEngagement: 75 };
aiAdManager.optimizeAdPlacement(adMetrics);
aiAdManager.detectFraudulentActivity(adMetrics);

const blockchainAdTracker = new BlockchainAdTracker(logger);
blockchainAdTracker.circuitBreaker.fire('ad123', 1000, 50);

// Start Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`OBS Plugin running on port ${PORT}`);
});

// Prometheus Metrics Endpoint
app.get('/api/metrics', async (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType);
    res.end(await Prometheus.register.metrics());
});

// Error Monitoring with Sentry
Sentry.init({ dsn: process.env.SENTRY_DSN });
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());

// Rate Limiting with Redis to Secure API
const limiter = rateLimit({
    store: new RedisStore({
        client: require('redis').createClient()
    }),
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);
// Heartbeat function to keep WebSocket connection alive
class WebSocketManager {
    constructor(urls, maxConnections, logger) {
        this.urls = urls;
        this.maxConnections = maxConnections;
        this.logger = logger;
        this.connections = [];
        this.currentServerIndex = 0;
        this.heartbeatInterval = 30000; // 30 seconds
        this.initCircuitBreaker();
    }

    initCircuitBreaker() {
        const circuitBreakerOptions = {
            timeout: 3000,
            errorThresholdPercentage: 50,
            resetTimeout: 10000
        };
        this.connectBreaker = new opossum((wsUrl) => {
            return new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl);

                ws.on('open', () => {
                    this.logger.info('WebSocket connection established');
                    connectionAttempts.labels({ streamer_id: 'default' }).inc();
                    this.startHeartbeat(ws);
                    resolve(ws);
                });

                ws.on('error', (error) => {
                    this.logger.error('WebSocket error', error);
                    connectionFailures.labels({ streamer_id: 'default' }).inc();
                    reject(error);
                });

                ws.on('close', () => {
                    this.logger.warn('WebSocket connection closed');
                    this.reconnectWithBackoff();
                });
            });
        }, circuitBreakerOptions);

        this.connectBreaker.fallback(() => {
            this.logger.error('Circuit breaker fallback: Unable to connect to OBS WebSocket');
        });
    }

    getNextWebSocketUrl() {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.urls.length;
        return this.urls[this.currentServerIndex];
    }

    createConnection() {
        const wsUrl = this.getNextWebSocketUrl();
        this.connectBreaker.fire(wsUrl).then(ws => {
            ws.on('message', (data) => this.handleWebSocketMessage(data));
        }).catch(error => {
            this.logger.error('Failed to establish WebSocket connection', error);
        });
    }

    reconnectWithBackoff(retries = 0) {
        const maxRetries = 5;
        if (retries >= maxRetries) {
            this.logger.error('Max retries reached for WebSocket connection');
            return;
        }
        const backoffTime = Math.pow(2, retries) * 1000; // Exponential backoff
        setTimeout(() => {
            this.createConnection();
            this.reconnectWithBackoff(retries + 1);
        }, backoffTime);
    }

    initConnections() {
        for (let i = 0; i < this.maxConnections; i++) {
            this.createConnection();
        }
    }

    handleWebSocketMessage(data) {
        const message = JSON.parse(data);
        this.logger.info(`Received WebSocket message: ${message.type}`);
        if (message.updateType === 'SwitchScenes') {
            sceneSwitches.labels({ streamer_id: 'default' }).inc();
            this.logger.info(`Scene switched to: ${message.sceneName}`);
        }
    }

    startHeartbeat(ws) {
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
                this.logger.info('Sent heartbeat ping to WebSocket server');
            }
        }, this.heartbeatInterval);
    }
}
// React Component for Ad Management

const AdManagement = () => {
    const [adContent, setAdContent] = useState('');
    const [budget, setBudget] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [priority, setPriority] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const adData = {
            adContent,
            budget,
            scheduleTime,
            priority
        };
        try {
            const response = await axios.post('/api/createAd', adData);
            alert('Ad created successfully!');
        } catch (error) {
            console.error('Error creating ad:', error);
            alert('Failed to create ad');
        }
    };

    return (
        <div>
            <h2>Ad Management</h2>
            <form onSubmit={handleSubmit}>
                <div>
                    <label>Ad Content:</label>
                    <input
                        type="text"
                        value={adContent}
                        onChange={(e) => setAdContent(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label>Budget:</label>
                    <input
                        type="number"
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label>Schedule Time:</label>
                    <input
                        type="datetime-local"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label>Priority:</label>
                    <input
                        type="number"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        required
                    />
                </div>
                <button type="submit">Create Ad</button>
            </form>
        </div>
    );
};

export default AdManagement;
// Event Emitter for Ad Actions
class AdEventEmitter extends EventEmitter {}
const adEventEmitter = new AdEventEmitter();

// Event Handlers
adEventEmitter.on('adRendered', (ad) => {
    adRenderAttempts.labels({ streamer_id: 'default', ad_id: ad.id }).inc();
    logger.info(`Ad rendered: ${ad.id}`);
});

adEventEmitter.on('adClicked', (ad) => {
    adClicks.labels({ streamer_id: 'default', ad_id: ad.id }).inc();
    logger.info(`Ad clicked: ${ad.id}`);
});

adEventEmitter.on('adScheduled', (ad) => {
    logger.info(`Ad scheduled: ${ad.id} at ${ad.scheduleTime}`);
});

// Modify AdManager to use EventEmitter
class AdManager {
    constructor(ws, logger) {
        this.ws = ws;
        this.logger = logger;
        this.lastAdTime = 0;
        this.adInterval = 60000; // 1 minute interval between ads
    }
    renderAdOverlay(ad) {
        const overlay = {
            sourceName: ad.id,
            sourceSettings: {
                url: ad.assetUrl,
                width: ad.width,
                height: ad.height
            }
        };
        this.ws.send(JSON.stringify({
            requestType: 'CreateSource',
            sourceName: overlay.sourceName,
            sourceKind: 'browser_source',
            sourceSettings: overlay.sourceSettings
        }));
        adEventEmitter.emit('adRendered', ad);
        this.logger.info(`Rendered ad overlay for ${ad.id}`);
    }

    scheduleAds(adList) {
        const sortedAds = adList.sort((a, b) => b.priority - a.priority); // Prioritize ads with higher priority
        sortedAds.forEach(ad => {
            setTimeout(() => {
                const currentTime = Date.now();
                if (currentTime - this.lastAdTime >= this.adInterval && this.shouldDisplayAd(ad)) {
                    this.renderAdOverlay(ad);
                    this.trackAdClicks(ad);
                    this.lastAdTime = currentTime;
                    adEventEmitter.emit('adScheduled', ad);
                }
            }, ad.scheduleTime);
        });
    }

    trackAdClicks(ad) {
        // Placeholder for tracking clicks through WebSocket or Twitch integration
        adEventEmitter.emit('adClicked', ad); // Mock increment
        this.logger.info(`Tracking ad clicks for ${ad.id}`);
    }

    shouldDisplayAd(ad) {
        // Logic for determining if the ad should be displayed, based on viewer engagement metrics
        return ad.viewerEngagement >= 50; // Example condition for MVP
    }
}

// Grafana Setup Instructions
// 1. Install Grafana: Follow the instructions on the Grafana website to install Grafana on your server.
// 2. Add Prometheus Data Source:
//    - Open Grafana and log in.
//    - Go to Configuration > Data Sources.
//    - Click "Add data source" and select "Prometheus".
//    - Set the URL to your Prometheus instance (e.g., http://localhost:9090).
//    - Click "Save & Test" to verify the connection.

// 3. Create Dashboards:
//    - Go to Create > Dashboard.
//    - Add a new panel and select the Prometheus data source.
//    - Use Prometheus queries to visualize metrics, such as:
//      - `obs_connection_attempts` for WebSocket connection attempts
//      - `obs_connection_failures` for WebSocket connection failures
//      - `obs_scene_switches` for scene switches
//      - `ad_render_attempts` for ad render attempts
//      - `ad_clicks` for ad clicks

// Example Prometheus Queries:
// - WebSocket Connection Attempts: `sum(obs_connection_attempts) by (streamer_id)`
// - WebSocket Connection Failures: `sum(obs_connection_failures) by (streamer_id)`
// - Scene Switches: `sum(obs_scene_switches) by (streamer_id)`
// - Ad Render Attempts: `sum(ad_render_attempts) by (streamer_id, ad_id)`
// - Ad Clicks: `sum(ad_clicks) by (streamer_id, ad_id)`

// 4. Customize and Save Dashboards:
//    - Customize the panels with appropriate titles, legends, and visualization types (e.g., graphs, tables).
//    - Save the dashboard for future use and monitoring.
// Dockerfile content moved to a separate Dockerfile
// Custom Error Handlers
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

const handleServerError = (err, req, res, next) => {
    logger.error('Server error', err);
    res.status(500).json({ error: 'Internal Server Error' });
};

const handleAuthError = (err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
        res.status(401).json({ error: 'Unauthorized' });
    } else {
        next(err);
    }
};

// Example POST endpoint with validation
app.post('/api/createCampaign',
[
    body('advertiser').notEmpty().withMessage('Advertiser is required'),
    body('budget').isNumeric().withMessage('Budget must be a number'),
    body('adContent').notEmpty().withMessage('Ad content is required')
], handleValidationErrors, async (req, res) => {
    const { advertiser, budget, adContent } = req.body;
    const campaign = new Campaign({
        advertiser,
        budget,
        adContent,
        status: 'active'
    });
    await campaign.save();
    res.status(201).json(campaign);
});

// MongoDB Failover Configuration
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    replicaSet: process.env.MONGO_REPLICA_SET,
    readPreference: 'secondaryPreferred'
}).then(() => {
    logger.info('Connected to MongoDB');
}).catch(err => {
    logger.error('Failed to connect to MongoDB', err);
});

// Redis Failover Configuration
const redisClient = require('redis').createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis connection refused');
            return new Error('The server refused the connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
            logger.error('Redis maximum retry attempts reached');
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

redisClient.on('error', (err) => {
    logger.error('Redis error', err);
});

redisClient.on('error', (err) => {
    logger.error('Redis error', err);
});

// Stripe Integration for Payments and Transaction Fees
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post('/api/createCustomer', authenticateUser, async (req, res) => {
    try {
        const customer = await stripe.customers.create({
            email: req.user.email,
            name: req.user.name
        });
        res.status(201).json(customer);
    } catch (error) {
        logger.error('Failed to create Stripe customer', error);
        res.status(500).json({ error: 'Failed to create customer' });
    }
});

app.post('/api/charge', authenticateUser, async (req, res) => {
    const { amount, currency, source, campaignId } = req.body;
    const transactionFee = amount * 0.1; // 10% transaction fee
    const totalAmount = amount + transactionFee;

    try {
        const charge = await stripe.charges.create({
            amount: totalAmount,
            currency,
            source,
            description: `Charge for campaign ${campaignId}`
        });

        const transaction = new Transaction({
            userId: req.user.id,
            campaignId,
            amount,
            transactionFee,
            totalAmount,
            chargeId: charge.id,
            status: 'completed'
        });
        await transaction.save();

        res.status(201).json(charge);
    } catch (error) {
        logger.error('Failed to process charge', error);
        res.status(500).json({ error: 'Failed to process charge' });
    }
});

app.post('/api/subscribe', authenticateUser, async (req, res) => {
    const { planId, paymentMethodId } = req.body;

    try {
        const subscription = await stripe.subscriptions.create({
            customer: req.user.stripeCustomerId,
            items: [{ plan: planId }],
            default_payment_method: paymentMethodId
        });

        const subscriptionRecord = new Subscription({
            userId: req.user.id,
            subscriptionId: subscription.id,
            planId,
            status: subscription.status
        });
        await subscriptionRecord.save();

        res.status(201).json(subscription);
    } catch (error) {
        logger.error('Failed to create subscription', error);
        res.status(500).json({ error: 'Failed to create subscription' });
    }
});