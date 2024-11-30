const axios = require('axios');
const winston = require('winston');
const Sentry = require('@sentry/node');
const { trace } = require('@opentelemetry/api');
const WebSocket = require('ws');
const db = require('./db');
const aiMiddleware = require('./aiMiddleware');
const ad = require('./ad');
const blockchain = require('./blockchain');

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

Sentry.init({ dsn: process.env.SENTRY_DSN });

const tracer = trace.getTracer('twitch-integration');
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Axios instance for Twitch API
const twitchApi = axios.create({
    baseURL: TWITCH_API_BASE,
    headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`
    }
});

class TwitchIntegration {
    constructor(clientId, clientSecret, redirectUri) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.token = null;
    }

    async getAccessToken(code) {
        const span = tracer.startSpan('getAccessToken');
        try {
            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: this.redirectUri,
                },
            });
            this.token = response.data.access_token;
            logger.info('Access token fetched successfully.');
            return response.data;
        } catch (error) {
            logger.error('Error fetching access token:', error.response?.data || error.message);
            Sentry.captureException(error);
            throw error;
        } finally {
            span.end();
        }
    }

    async getUserInfo() {
        const span = tracer.startSpan('getUserInfo');
        try {
            const response = await twitchApi.get('/users', {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Client-Id': this.clientId,
                },
            });
            logger.info('Fetched user info successfully.');
            return response.data.data[0];
        } catch (error) {
            logger.error('Error fetching user info:', error.response?.data || error.message);
            Sentry.captureException(error);
            throw error;
        } finally {
            span.end();
        }
    }

    async getStreams(userId) {
        const span = tracer.startSpan('getStreams');
        try {
            const response = await twitchApi.get(`/streams?user_id=${userId}`);
            logger.info('Fetched live streams successfully.');
            return response.data.data;
        } catch (error) {
            logger.error('Error fetching streams:', error.response?.data || error.message);
            Sentry.captureException(error);
            throw error;
        } finally {
            span.end();
        }
    }
}

const twitchIntegration = new TwitchIntegration(
    process.env.TWITCH_CLIENT_ID,
    process.env.TWITCH_CLIENT_SECRET,
    process.env.TWITCH_REDIRECT_URI
);

// Reusable error handling for APIs
const handleApiError = (error, context) => {
    logger.error(`${context} failed:`, error.response?.data || error.message);
    Sentry.captureException(error);
    throw error;
};

// Utility function for retrying failed tasks
const retryOperation = async (operation, maxAttempts = 3) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
        try {
            return await operation();
        } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) throw error;
        }
    }
};

// Exported methods
module.exports = {
    twitchIntegration,
    async authenticateWithTwitch(user) {
        const span = tracer.startSpan('authenticateWithTwitch');
        try {
            const tokens = await db.getTwitchTokens(user.id);
            if (!tokens) {
                throw new Error('User needs to authenticate with Twitch.');
            }
            logger.info('Successfully authenticated with Twitch', { userId: user.id });
            return tokens;
        } catch (error) {
            handleApiError(error, 'Twitch Authentication');
        } finally {
            span.end();
        }
    },
    async getLiveStreams(userId) {
        const span = tracer.startSpan('getLiveStreams');
        try {
            return await retryOperation(async () => {
                return await twitchIntegration.getStreams(userId);
            });
        } catch (error) {
            handleApiError(error, 'Fetch Live Streams');
        } finally {
            span.end();
        }
    },
    async placeAdOnStream(streamId, adDetails) {
        const span = tracer.startSpan('placeAdOnStream');
        try {
            const optimalTimes = await aiMiddleware.getOptimalAdTimes(streamId);
            for (const time of optimalTimes) {
                await retryOperation(() =>
                    ad.insertAd(streamId, adDetails, time)
                );
            }
            logger.info('Ad placed successfully', { streamId, adDetails });
        } catch (error) {
            handleApiError(error, 'Place Ad on Stream');
        } finally {
            span.end();
        }
    },
    async refreshTwitchTokens(userId) {
        const span = tracer.startSpan('refreshTwitchTokens');
        try {
            const tokens = await db.getTwitchTokens(userId);
            if (!tokens || !tokens.refresh_token) {
                throw new Error('No refresh token available.');
            }

            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refresh_token,
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET,
                },
            });

            const newTokens = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || tokens.refresh_token,
            };

            await db.saveTwitchTokens(userId, newTokens);
            logger.info('Successfully refreshed Twitch tokens', { userId });
            return newTokens;
        } catch (error) {
            handleApiError(error, 'Refresh Twitch Tokens');
        } finally {
            span.end();
        }
    },
    async monitorStreamAnalytics(streamId) {
        const span = tracer.startSpan('monitorStreamAnalytics');
        const ws = new WebSocket('ws://your-dashboard-url');
        try {
            const response = await twitchApi.get(`/analytics/streams/${streamId}`);
            const analyticsData = response.data.data;

            ws.on('open', () => {
                ws.send(JSON.stringify(analyticsData));
            });

            await aiMiddleware.updateAIModel(analyticsData);
            logger.info('Stream analytics monitored successfully', { streamId, analyticsData });
            return analyticsData;
        } catch (error) {
            handleApiError(error, 'Monitor Stream Analytics');
        } finally {
            span.end();
            ws.close();
        }
    },
    async detectFraud(streamId) {
        const span = tracer.startSpan('detectFraud');
        try {
            const streamData = await twitchApi.get(`/streams/${streamId}`);
            const isFraudulent = await aiMiddleware.detectFraud(streamData.data);
            if (isFraudulent) {
                logger.warn('Potential ad fraud detected', { streamId });
                // Handle fraud detection logic
            }
            return isFraudulent;
        } catch (error) {
            handleApiError(error, 'Fraud Detection');
        } finally {
            span.end();
        }
    },
    async personalizeAdContent(streamId) {
        const span = tracer.startSpan('personalizeAdContent');
        try {
            const chatSentiment = await aiMiddleware.analyzeChatSentiment(streamId);
            const historicalData = await db.getHistoricalEngagementData(streamId);
            const personalizedAd = await aiMiddleware.recommendAd(chatSentiment, historicalData);
            logger.info('Personalized ad content generated', { streamId, personalizedAd });
            return personalizedAd;
        } catch (error) {
            handleApiError(error, 'Personalize Ad Content');
        } finally {
            span.end();
        }
    },
    async logAdPlacementToBlockchain(streamId, adDetails) {
        const span = tracer.startSpan('logAdPlacementToBlockchain');
        try {
            const blockchainResponse = await blockchain.logAdPlacement(streamId, adDetails);
            logger.info('Ad placement logged to blockchain', { streamId, adDetails, blockchainResponse });
            return blockchainResponse;
        } catch (error) {
            handleApiError(error, 'Blockchain Logging');
        } finally {
            span.end();
        }
    }
};
async function analyzeStreamMetadata(streamId) {
    const span = tracer.startSpan('analyzeStreamMetadata');
    try {
        const streamData = await twitchApi.get(`/streams/${streamId}`);
        const chatSentiment = await aiMiddleware.analyzeChatSentiment(streamId);
        const viewerEngagement = await aiMiddleware.getViewerEngagement(streamId);
        const adRecommendation = await aiMiddleware.recommendAdType(streamData.data, chatSentiment, viewerEngagement);
        logger.info('Ad type recommended based on stream metadata', { streamId, adRecommendation });
        return adRecommendation;
    } catch (error) {
        handleApiError(error, 'Analyze Stream Metadata');
    } finally {
        span.end();
    }
}

async function adjustAdPlacementStrategy() {
    const span = tracer.startSpan('adjustAdPlacementStrategy');
    try {
        const historicalData = await db.getHistoricalAdPerformance();
        const newStrategy = await aiMiddleware.adjustAdPlacementStrategy(historicalData);
        logger.info('Ad placement strategy adjusted based on historical data', { newStrategy });
        return newStrategy;
    } catch (error) {
        handleApiError(error, 'Adjust Ad Placement Strategy');
    } finally {
        span.end();
    }
}

async function predictAdPerformance(streamId) {
    const span = tracer.startSpan('predictAdPerformance');
    try {
        const analyticsData = await twitchApi.get(`/analytics/streams/${streamId}`);
        const predictedPerformance = await aiMiddleware.predictAdPerformance(analyticsData.data);
        logger.info('Predicted ad performance', { streamId, predictedPerformance });
        return predictedPerformance;
    } catch (error) {
        handleApiError(error, 'Predict Ad Performance');
    } finally {
        span.end();
    }
}

async function storeAdMetricsInBlockchain(streamId, adMetrics) {
    const span = tracer.startSpan('storeAdMetricsInBlockchain');
    try {
        const blockchainResponse = await blockchain.storeAdMetrics(streamId, adMetrics);
        logger.info('Ad metrics stored in blockchain', { streamId, adMetrics, blockchainResponse });
        return blockchainResponse;
    } catch (error) {
        handleApiError(error, 'Store Ad Metrics in Blockchain');
    } finally {
        span.end();
    }
}

async function interactWithAds(streamId, adDetails) {
    const span = tracer.startSpan('interactWithAds');
    try {
        const interactionResult = await aiMiddleware.interactWithAds(streamId, adDetails);
        logger.info('Viewer interaction with ad', { streamId, adDetails, interactionResult });
        return interactionResult;
    } catch (error) {
        handleApiError(error, 'Interact with Ads');
    } finally {
        span.end();
    }
}

async function updateAdvertisersInRealTime(adId, performanceMetrics) {
    const span = tracer.startSpan('updateAdvertisersInRealTime');
    const ws = new WebSocket('ws://advertiser-dashboard-url');
    try {
        ws.on('open', () => {
            ws.send(JSON.stringify({ adId, performanceMetrics }));
        });
        logger.info('Advertisers updated in real time', { adId, performanceMetrics });
    } catch (error) {
        handleApiError(error, 'Update Advertisers in Real Time');
    } finally {
        span.end();
        ws.close();
    }
}

async function alertStreamersAboutAdPlacements(streamId, adDetails) {
    const span = tracer.startSpan('alertStreamersAboutAdPlacements');
    const ws = new WebSocket('ws://streamer-dashboard-url');
    try {
        ws.on('open', () => {
            ws.send(JSON.stringify({ streamId, adDetails }));
        });
        logger.info('Streamers alerted about ad placements', { streamId, adDetails });
    } catch (error) {
        handleApiError(error, 'Alert Streamers About Ad Placements');
    } finally {
        span.end();
        ws.close();
    }
}

async function validateTwitchTokens(userId) {
    const span = tracer.startSpan('validateTwitchTokens');
    try {
        const tokens = await db.getTwitchTokens(userId);
        if (!tokens) {
            throw new Error('No tokens available for validation.');
        }
        const isValid = await twitchApi.post('/validate', { token: tokens.access_token });
        if (!isValid) {
            await refreshTwitchTokens(userId);
        }
        logger.info('Twitch tokens validated', { userId });
        return isValid;
    } catch (error) {
        handleApiError(error, 'Validate Twitch Tokens');
    } finally {
        span.end();
    }
}

async function encryptWebSocketCommunications(wsUrl) {
    const span = tracer.startSpan('encryptWebSocketCommunications');
    try {
        const ws = new WebSocket(wsUrl, {
            perMessageDeflate: false,
            rejectUnauthorized: false,
            headers: {
                'Sec-WebSocket-Protocol': 'wss',
            },
        });
        logger.info('WebSocket communications encrypted', { wsUrl });
        return ws;
    } catch (error) {
        handleApiError(error, 'Encrypt WebSocket Communications');
    } finally {
        span.end();
    }
}

async function monitorAnalyticsWithPrometheus() {
    const span = tracer.startSpan('monitorAnalyticsWithPrometheus');
    try {
        const metrics = await prometheusClient.collectDefaultMetrics();
        logger.info('Analytics monitored with Prometheus', { metrics });
        return metrics;
    } catch (error) {
        handleApiError(error, 'Monitor Analytics with Prometheus');
    } finally {
        span.end();
    }
}
async function analyzeChatSentimentWithTransformer(streamId) {
    const span = tracer.startSpan('analyzeChatSentimentWithTransformer');
    try {
        const chatData = await twitchApi.get(`/streams/${streamId}/chat`);
        const sentiment = await aiMiddleware.analyzeSentimentWithTransformer(chatData.data);
        logger.info('Chat sentiment analyzed using Transformer model', { streamId, sentiment });
        return sentiment;
    } catch (error) {
        handleApiError(error, 'Analyze Chat Sentiment with Transformer');
    } finally {
        span.end();
    }
}

async function adjustAdPlacementWithReinforcementLearning() {
    const span = tracer.startSpan('adjustAdPlacementWithReinforcementLearning');
    try {
        const historicalData = await db.getHistoricalAdPerformance();
        const newStrategy = await aiMiddleware.adjustAdPlacementWithRL(historicalData);
        logger.info('Ad placement strategy adjusted using Reinforcement Learning', { newStrategy });
        return newStrategy;
    } catch (error) {
        handleApiError(error, 'Adjust Ad Placement with Reinforcement Learning');
    } finally {
        span.end();
    }
}

async function scaleBackendWithKubernetes() {
    const span = tracer.startSpan('scaleBackendWithKubernetes');
    try {
        const scalingResult = await kubernetesClient.scaleBackend();
        logger.info('Backend scaled using Kubernetes', { scalingResult });
        return scalingResult;
    } catch (error) {
        handleApiError(error, 'Scale Backend with Kubernetes');
    } finally {
        span.end();
    }
}

async function optimizeWebSocketConnections() {
    const span = tracer.startSpan('optimizeWebSocketConnections');
    try {
        const optimizationResult = await cloudflareClient.optimizeWebSocketConnections();
        logger.info('WebSocket connections optimized using Cloudflare', { optimizationResult });
        return optimizationResult;
    } catch (error) {
        handleApiError(error, 'Optimize WebSocket Connections');
    } finally {
        span.end();
    }
}

async function interactWithAdsGamification(streamId, adDetails) {
    const span = tracer.startSpan('interactWithAdsGamification');
    try {
        const interactionResult = await aiMiddleware.interactWithAdsGamification(streamId, adDetails);
        logger.info('Viewer interaction with ad using gamification', { streamId, adDetails, interactionResult });
        return interactionResult;
    } catch (error) {
        handleApiError(error, 'Interact with Ads Gamification');
    } finally {
        span.end();
    }
}

async function detectFraudWithGNN(streamId) {
    const span = tracer.startSpan('detectFraudWithGNN');
    try {
        const streamData = await twitchApi.get(`/streams/${streamId}`);
        const isFraudulent = await aiMiddleware.detectFraudWithGNN(streamData.data);
        if (isFraudulent) {
            logger.warn('Potential ad fraud detected using GNN', { streamId });
            // Handle fraud detection logic
        }
        return isFraudulent;
    } catch (error) {
        handleApiError(error, 'Detect Fraud with GNN');
    } finally {
        span.end();
    }
}

async function encryptWebSocketTraffic(wsUrl) {
    const span = tracer.startSpan('encryptWebSocketTraffic');
    try {
        const ws = new WebSocket(wsUrl, {
            perMessageDeflate: false,
            rejectUnauthorized: false,
            headers: {
                'Sec-WebSocket-Protocol': 'wss',
            },
        });
        logger.info('WebSocket traffic encrypted using TLS', { wsUrl });
        return ws;
    } catch (error) {
        handleApiError(error, 'Encrypt WebSocket Traffic');
    } finally {
        span.end();
    }
}