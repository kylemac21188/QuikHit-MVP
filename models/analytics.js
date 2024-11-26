const mongoose = require('mongoose');
// Load historical data for training
async function loadHistoricalData(adId) {
    return Analytics.find({ ad: adId }).lean();
}

// Train a model with historical data
async function trainModel(adId) {
    const data = await loadHistoricalData(adId);
    const impressions = data.map(d => d.impressions);
    const clicks = data.map(d => d.clicks);
    const conversions = data.map(d => d.conversions);

    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 1, inputShape: [1] }));
    model.compile({ optimizer: 'sgd', loss: 'meanSquaredError' });

    const xs = tf.tensor2d(impressions, [impressions.length, 1]);
    const ys = tf.tensor2d(clicks, [clicks.length, 1]);

    await model.fit(xs, ys, { epochs: 100 });

    return model;
}

// Predict future performance
analyticsSchema.statics.predictFuturePerformance = async function (adId) {
    try {
        const model = await trainModel(adId);
        const adData = await this.find({ ad: adId }).lean();
        const impressions = adData.map(d => d.impressions);

        const xs = tf.tensor2d(impressions, [impressions.length, 1]);
        const predictions = model.predict(xs);

        const predictedClicks = predictions.dataSync();
        return predictedClicks;
    } catch (error) {
        Sentry.captureException(error);
        throw new Error('Error predicting future performance.');
    }
};
const TensorFlow = require('@tensorflow/tfjs-node');
const Prometheus = require('prom-client');
const EventEmitter = require('events');
const { User, Ad, Campaign, Transaction } = require('./models');
const { sendNotification } = require('../utils/notificationService'); // Centralized notification service
const Sentry = require('@sentry/node');
const tf = require('@tensorflow/tfjs-node');

const { Schema } = mongoose;

// Event Emitter for analytics-related notifications
const analyticsEvents = new EventEmitter();

// Define Analytics Schema
const analyticsSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        ad: { type: Schema.Types.ObjectId, ref: 'Ad', required: true },
        campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
        impressions: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
        conversions: { type: Number, default: 0 },
        revenueGenerated: { type: Number, default: 0 },
        CTR: { type: Number, default: 0 },
        conversionRate: { type: Number, default: 0 },
        fraudScore: { type: Number, default: 0 },
        aiPredictedCTR: { type: Number, default: 0 },
        aiPredictedConversionRate: { type: Number, default: 0 },
        hourlyMetrics: { type: Map, of: Number },
        dailyMetrics: { type: Map, of: Number },
    },
    { timestamps: true }
);

// Indexes for optimized queries
analyticsSchema.index({ ad: 1, user: 1, campaign: 1 });
analyticsSchema.index({ 'hourlyMetrics.date': 1 });
analyticsSchema.index({ 'dailyMetrics.date': 1 });

// --- Pre-Save Hook ---
analyticsSchema.pre('save', async function (next) {
    try {
        this.CTR = this.impressions ? this.clicks / this.impressions : 0;
        this.conversionRate = this.clicks ? this.conversions / this.clicks : 0;

        const transaction = await Transaction.findOne({ ad: this.ad, user: this.user });
        if (transaction) {
            this.fraudScore = transaction.fraudScore;
        }

        next();
    } catch (error) {
        Sentry.captureException(error);
        next(new Error('Error in pre-save hook for analytics.'));
    }
});

// --- Post-Save Hook ---
analyticsSchema.post('save', async function (doc) {
    try {
        // Prometheus metrics
        totalAnalyticsRecords.inc();

        // Notifications for significant metrics
        const notifications = [];
        if (doc.fraudScore > 0.8) {
            analyticsEvents.emit('highFraudScore', doc);
            notifications.push({
                type: 'fraud',
                message: `High Fraud Score Alert: Ad ID: ${doc.ad} has a fraud score of ${doc.fraudScore}.`,
            });
        }
        if (doc.CTR > 0.5) {
            analyticsEvents.emit('highCTR', doc);
            notifications.push({
                type: 'CTR',
                message: `High CTR Alert: Ad ID: ${doc.ad} has a CTR of ${doc.CTR.toFixed(2)}.`,
            });
        }
        if (doc.conversionRate < 0.1) {
            analyticsEvents.emit('lowConversionRate', doc);
            notifications.push({
                type: 'conversionRate',
                message: `Low Conversion Rate Alert: Ad ID: ${doc.ad} has a conversion rate of ${doc.conversionRate.toFixed(2)}.`,
            });
        }

        for (const notification of notifications) {
            await sendNotification(notification.type, notification.message);
        }
    } catch (error) {
        Sentry.captureException(error);
        console.error('Error in post-save hook for analytics:', error);
    }
});

// --- Static Methods ---
analyticsSchema.statics.aggregatePerformanceByUser = async function (userId) {
    try {
        return this.aggregate([
            { $match: { user: mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: '$user',
                    totalImpressions: { $sum: '$impressions' },
                    totalClicks: { $sum: '$clicks' },
                    totalConversions: { $sum: '$conversions' },
                    totalRevenue: { $sum: '$revenueGenerated' },
                },
            },
        ]);
    } catch (error) {
        Sentry.captureException(error);
        throw new Error('Error aggregating performance by user.');
    }
};

// Implement TensorFlow-based prediction logic
analyticsSchema.statics.predictFuturePerformance = async function (adId) {
    try {
        const adData = await this.find({ ad: adId });
        // Example: TensorFlow logic here
        // Return prediction results
    } catch (error) {
        Sentry.captureException(error);
        throw new Error('Error predicting future performance.');
    }
};

// Prometheus Metrics
const totalAnalyticsRecords = new Prometheus.Counter({
    name: 'total_analytics_records',
    help: 'Total number of analytics records',
});

const anomalyDetectionRate = new Prometheus.Counter({
    name: 'anomaly_detection_rate',
    help: 'Rate of anomaly detection',
});

// Expose Prometheus Metrics
analyticsSchema.statics.exposeMetrics = function (app) {
    app.get('/analytics-metrics', (req, res) => {
        res.set('Content-Type', Prometheus.register.contentType);
        res.end(Prometheus.register.metrics());
    });
};

// --- Export Analytics Model ---
const Analytics = mongoose.model('Analytics', analyticsSchema);
module.exports = Analytics;
