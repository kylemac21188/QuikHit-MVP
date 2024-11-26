const mongoose = require('mongoose');
const User = require('./user');
const Ad = require('./ad');
const Campaign = require('./campaign');
const { sendEmail, sendSlackNotification, sendSMS } = require('../utils/notifications');
const { calculateFraudScore, calculatePlatformFees } = require('../utils/fraudDetection');
const Prometheus = require('prom-client');
const Sentry = require('@sentry/node');

const { Schema } = mongoose;

const transactionSchema = new Schema({
    transactionId: { type: String, unique: true, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    ad: { type: Schema.Types.ObjectId, ref: 'Ad' },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    type: { type: String, enum: ['credit', 'debit', 'refund', 'payout'], required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], required: true },
    paymentMethod: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    fraudScore: { type: Number, default: 0 },
    platformFees: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// --- Indexes ---
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ user: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: 1 });

// --- Pre-Save Hook: Calculate Fraud Score and Platform Fees ---
transactionSchema.pre('save', async function (next) {
    if (this.isNew) {
        try {
            this.fraudScore = await calculateFraudScore(this);
            this.platformFees = calculatePlatformFees(this.amount);
        } catch (error) {
            Sentry.captureException(error);
            return next(new Error('Error calculating fraud score or platform fees.'));
        }
    }
    next();
});

// --- Post-Save Hook: Notifications and Prometheus Metrics ---
transactionSchema.post('save', async function (doc) {
    try {
        // Prometheus Metrics
        transactionCounter.inc();
        if (doc.type === 'credit') {
            revenueGauge.inc(doc.amount);
        } else if (doc.type === 'refund') {
            refundCounter.inc();
        } else if (doc.status === 'failed') {
            failedTransactionCounter.inc();
        }

        // Notifications
        if (doc.amount > 10000 || doc.fraudScore > 50) {
            const message = `Transaction Alert: 
                - Amount: ${doc.amount} ${doc.currency}
                - Type: ${doc.type}
                - Fraud Score: ${doc.fraudScore}
                - Status: ${doc.status}`;
            await sendEmail(doc.user, 'High-value or flagged transaction detected', message);
            await sendSlackNotification('admin', message);
            await sendSMS(doc.user, message);
        }
    } catch (error) {
        Sentry.captureException(error);
        console.error('Error in post-save hook for transaction:', error);
    }
});

// --- Static Method: Fetch Transaction History ---
transactionSchema.statics.fetchTransactionHistory = function (userId, filters, pagination) {
    const query = { user: userId, ...filters };
    return this.find(query)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .sort({ createdAt: -1 });
};

// --- Static Method: Calculate Totals ---
transactionSchema.statics.calculateTotals = function (filters) {
    return this.aggregate([
        { $match: filters },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
                totalRefunds: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, '$amount', 0] } },
                totalPayouts: { $sum: { $cond: [{ $eq: ['$type', 'payout'] }, '$amount', 0] } }
            }
        }
    ]);
};

// --- Prometheus Metrics ---
const transactionCounter = new Prometheus.Counter({
    name: 'total_transactions',
    help: 'Total number of transactions'
});
const revenueGauge = new Prometheus.Gauge({
    name: 'total_revenue',
    help: 'Total revenue processed'
});
const refundCounter = new Prometheus.Counter({
    name: 'total_refunds',
    help: 'Total refunds issued'
});
const failedTransactionCounter = new Prometheus.Counter({
    name: 'failed_transactions',
    help: 'Number of failed transactions'
});

// --- Export Model ---
module.exports = mongoose.model('Transaction', transactionSchema);