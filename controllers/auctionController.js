const { Auction } = require('../models/auction');
const BiddingEngine = require('../bidding/BiddingEngine');
const blockchainMiddleware = require('../blockchainMiddleware');
const aiMiddleware = require('../aiMiddleware');
const sustainabilityMiddleware = require('../sustainabilityMiddleware');
const localizationMiddleware = require('../localizationMiddleware');
const logger = require('../logger');
const redisClient = require('redis').createClient();
const { validationResult } = require('express-validator');
const promClient = require('prom-client');
const WebSocket = require('ws');

// Prometheus metrics
const totalAuctionsCreated = new promClient.Counter({
    name: 'total_auctions_created',
    help: 'Total number of auctions created'
});
const finalizedAuctions = new promClient.Counter({
    name: 'finalized_auctions',
    help: 'Total number of auctions finalized'
});
const fetchAuctionDetailsLatency = new promClient.Histogram({
    name: 'fetch_auction_details_latency',
    help: 'Latency for fetching auction details',
    buckets: [0.1, 0.5, 1, 2, 5]
});

// WebSocket server for real-time updates
const wsServer = new WebSocket.Server({ port: 8081 });
wsServer.on('connection', (ws) => {
    logger.info('WebSocket client connected');
    ws.on('close', () => logger.info('WebSocket client disconnected'));
});

// Broadcast real-time updates
const broadcastUpdate = (event, data) => {
    wsServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ event, data }));
        }
    });
};

// Controller: Create a new auction
exports.createAuction = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { title, basePrice, currency, startTime, endTime, adDetails, region } = req.body;

        // AI-powered base price recommendation
        const recommendedBasePrice = await aiMiddleware.recommendBasePrice(region, adDetails);
        const finalBasePrice = basePrice || recommendedBasePrice;

        // Fraud detection with federated learning
        const fraudRisk = await aiMiddleware.detectFraud(req.body);
        if (fraudRisk > 0.8) {
            return res.status(400).json({ error: 'High fraud risk detected' });
        }

        const auction = new Auction({
            title,
            basePrice: finalBasePrice,
            currency,
            startTime,
            endTime,
            adDetails,
            highestBid: finalBasePrice,
            status: 'pending',
        });

        await auction.save();
        totalAuctionsCreated.inc();
        logger.info(`Auction created: ${auction._id}`);

        // Broadcast real-time update
        broadcastUpdate('auctionCreated', auction);

        return res.status(201).json({ message: 'Auction created successfully', auction });
    } catch (error) {
        logger.error('Error creating auction:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Controller: Fetch auction details
exports.getAuctionDetails = async (req, res) => {
    const end = fetchAuctionDetailsLatency.startTimer();
    try {
        const { id } = req.params;

        // Check Redis cache first
        const cachedAuction = await redisClient.get(`auction:${id}`);
        if (cachedAuction) {
            logger.info(`Cache hit for auction: ${id}`);
            end();
            return res.status(200).json(JSON.parse(cachedAuction));
        }

        const auction = await Auction.findById(id);
        if (!auction) {
            return res.status(404).json({ error: 'Auction not found' });
        }

        // Sustainability metrics
        const sustainabilityMetrics = await sustainabilityMiddleware.calculateAuctionMetrics(id);

        // Localization support
        const localizedData = await localizationMiddleware.getLocalizedData(auction, req.query.region);

        // Cache auction in Redis
        await redisClient.set(`auction:${id}`, JSON.stringify(auction), 'EX', 3600);
        logger.info(`Auction fetched and cached: ${id}`);
        end();
        return res.status(200).json({ ...auction.toObject(), sustainabilityMetrics, localizedData });
    } catch (error) {
        logger.error('Error fetching auction details:', error);
        end();
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Controller: Fetch all active auctions
exports.getActiveAuctions = async (req, res) => {
    try {
        // Check Redis cache for active auctions
        const cachedAuctions = await redisClient.get('activeAuctions');
        if (cachedAuctions) {
            logger.info('Cache hit for active auctions');
            return res.status(200).json(JSON.parse(cachedAuctions));
        }

        const auctions = await Auction.find({ status: 'active', endTime: { $gte: Date.now() } });
        if (!auctions.length) {
            return res.status(404).json({ error: 'No active auctions found' });
        }

        // Cache active auctions
        await redisClient.set('activeAuctions', JSON.stringify(auctions), 'EX', 3600);
        logger.info('Active auctions fetched and cached');

        // Publish update to Redis Pub/Sub
        redisClient.publish('auctionUpdates', JSON.stringify({ event: 'auctionUpdated', data: auctions }));

        // Broadcast real-time update
        broadcastUpdate('activeAuctionsFetched', auctions);

        return res.status(200).json(auctions);
    } catch (error) {
        logger.error('Error fetching active auctions:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Controller: Finalize an auction
exports.finalizeAuction = async (req, res) => {
    try {
        const { id } = req.params;
        const auction = await Auction.findById(id);

        if (!auction) {
            return res.status(404).json({ error: 'Auction not found' });
        }
        if (auction.status !== 'active') {
            return res.status(400).json({ error: 'Auction is not active' });
        }

        // Fraud detection with federated learning
        const fraudRisk = await aiMiddleware.detectFraud({ auctionId: id });
        if (fraudRisk > 0.8) {
            return res.status(400).json({ error: 'High fraud risk detected' });
        }

        // Finalize auction in BiddingEngine
        await BiddingEngine.finalizeAuction(id);

        // Finalize auction on blockchain
        const transactionHash = await blockchainMiddleware.finalizeAuction(auction);

        // Enable AR/VR features
        await BiddingEngine.enableARFeatures(id);

        auction.status = 'completed';
        await auction.save();
        finalizedAuctions.inc();

        // Broadcast real-time update
        broadcastUpdate('auctionFinalized', { auction, transactionHash });

        logger.info(`Auction finalized: ${id}`);
        return res.status(200).json({ message: 'Auction finalized successfully', auction, transactionHash });
    } catch (error) {
        logger.error('Error finalizing auction:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};