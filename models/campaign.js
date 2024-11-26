const mongoose = require('mongoose');
const User = require('./user');
const Ad = require('./ad');
const EventEmitter = require('events');
const tf = require('@tensorflow/tfjs-node');
const nodemailer = require('nodemailer');
const { WebClient } = require('@slack/web-api');
const i18n = require('i18n');
const Prometheus = require('prom-client');

const { Schema } = mongoose;
const eventEmitter = new EventEmitter();

const campaignSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },
    advertiser: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        validate: {
            validator: async function(value) {
                const user = await User.findById(value);
                return user && user.role === 'advertiser';
            },
            message: 'Advertiser must be a valid user with advertiser role.'
        }
    },
    ads: [{
        type: Schema.Types.ObjectId,
        ref: 'Ad'
    }],
    budget: {
        type: Number,
        required: true,
        min: 1,
        validate: {
            validator: function(value) {
                // Assuming advertiser has a method to check available funds
                return this.advertiser.checkAvailableFunds(value);
            },
            message: 'Insufficient funds for the campaign budget.'
        }
    },
    remainingBudget: {
        type: Number,
        default: function() {
            return this.budget;
        }
    },
    status: {
        type: String,
        enum: ['active', 'paused', 'completed', 'cancelled'],
        default: 'active'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    targetAudience: {
        demographics: {
            age: [Number],
            gender: [String]
        },
        interests: [String],
        location: {
            type: String
        }
    },
    performanceMetrics: {
        impressions: {
            type: Number,
            default: 0
        },
        clicks: {
            type: Number,
            default: 0
        },
        conversions: {
            type: Number,
            default: 0
        },
        conversionRate: {
            type: Number,
            default: 0
        },
        aiPredictedCTR: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

campaignSchema.pre('save', function(next) {
    if (this.startDate >= this.endDate) {
        return next(new Error('Start date must be before end date.'));
    }
    this.performanceMetrics.conversionRate = this.performanceMetrics.clicks / this.performanceMetrics.impressions;
    next();
});

campaignSchema.post('save', function(doc) {
    if (doc.status === 'active') {
        eventEmitter.emit('campaignStarted', doc);
    }
    if (doc.remainingBudget <= 0) {
        eventEmitter.emit('budgetExhausted', doc);
    }
});

campaignSchema.methods.calculatePerformance = function() {
    this.performanceMetrics.conversionRate = this.performanceMetrics.clicks / this.performanceMetrics.impressions;
    return this.performanceMetrics;
};

campaignSchema.methods.isBudgetExhausted = function() {
    return this.remainingBudget <= 0;
};

campaignSchema.methods.pauseCampaign = function() {
    this.status = 'paused';
    this.save();
    eventEmitter.emit('campaignPaused', this);
};

campaignSchema.statics.fetchActiveCampaigns = function(targetAudience) {
    const query = { status: 'active' };
    if (targetAudience) {
        query['targetAudience'] = targetAudience;
    }
    return this.find(query);
};

campaignSchema.statics.calculateTotalSpending = function(campaignId) {
    return this.aggregate([
        { $match: { _id: mongoose.Types.ObjectId(campaignId) } },
        { $unwind: '$ads' },
        { $lookup: { from: 'ads', localField: 'ads', foreignField: '_id', as: 'adDetails' } },
        { $unwind: '$adDetails' },
        { $group: { _id: '$_id', totalSpending: { $sum: '$adDetails.spending' } } }
    ]);
};

campaignSchema.index({ advertiser: 1, status: 1 });
campaignSchema.index({ 'targetAudience.location': 1 });
campaignSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
// AI-driven prediction system
campaignSchema.methods.predictPerformance = async function() {
    // Load historical data and create a TensorFlow model for prediction
    const historicalData = await this.model('Campaign').find({ advertiser: this.advertiser });
    const model = tf.sequential();
    // Define model layers and compile
    model.add(tf.layers.dense({ units: 50, activation: 'relu', inputShape: [historicalData.length] }));
    model.add(tf.layers.dense({ units: 1, activation: 'linear' }));
    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

    // Prepare data for training
    const xs = tf.tensor2d(historicalData.map(c => [c.performanceMetrics.impressions, c.performanceMetrics.clicks]));
    const ys = tf.tensor2d(historicalData.map(c => c.performanceMetrics.conversionRate));

    // Train the model
    await model.fit(xs, ys, { epochs: 50 });

    // Predict future performance
    const prediction = model.predict(tf.tensor2d([[this.performanceMetrics.impressions, this.performanceMetrics.clicks]]));
    return prediction.dataSync()[0];
};

campaignSchema.methods.suggestOptimizedTargeting = function() {
    // Suggest optimized targeting parameters based on historical data
    // This is a placeholder for a more complex AI-driven suggestion system
    return {
        location: 'New York',
        demographics: { age: [25, 34], gender: ['male'] },
        bidAmount: this.budget * 0.1
    };
};

campaignSchema.methods.flagAnomalies = function() {
    // Flag potential anomalies in campaign metrics
    const anomalyThreshold = 0.1; // Example threshold
    if (Math.abs(this.performanceMetrics.conversionRate - this.performanceMetrics.aiPredictedCTR) > anomalyThreshold) {
        eventEmitter.emit('anomalyDetected', this);
        return true;
    }
    return false;
};

// Notifications and Alerts
eventEmitter.on('campaignPaused', async (campaign) => {
    const message = i18n.__('Campaign %s has been paused.', campaign.name);
    await sendNotification(message);
});

eventEmitter.on('budgetExhausted', async (campaign) => {
    const message = i18n.__('Campaign %s has exhausted its budget.', campaign.name);
    await sendNotification(message);
});

eventEmitter.on('anomalyDetected', async (campaign) => {
    const message = i18n.__('Anomaly detected in campaign %s.', campaign.name);
    await sendNotification(message);
});

async function sendNotification(message) {
    // Send email notification
    const transporter = nodemailer.createTransport({ /* SMTP config */ });
    await transporter.sendMail({ from: 'no-reply@example.com', to: 'admin@example.com', subject: 'Campaign Notification', text: message });

    // Send Slack notification
    const slackClient = new WebClient('your-slack-token');
    await slackClient.chat.postMessage({ channel: '#campaign-alerts', text: message });

    // Send SMS notification (using a service like Twilio)
    // await twilioClient.messages.create({ body: message, from: '+1234567890', to: '+0987654321' });
}

// Real-Time Monitoring with Prometheus
const activeCampaignsGauge = new Prometheus.Gauge({ name: 'active_campaigns', help: 'Number of active campaigns' });
const pausedCampaignsGauge = new Prometheus.Gauge({ name: 'paused_campaigns', help: 'Number of paused campaigns' });
const totalImpressionsCounter = new Prometheus.Counter({ name: 'total_impressions', help: 'Total impressions across all campaigns' });

campaignSchema.post('save', function(doc) {
    if (doc.status === 'active') {
        activeCampaignsGauge.inc();
    } else if (doc.status === 'paused') {
        pausedCampaignsGauge.inc();
    }
    totalImpressionsCounter.inc(doc.performanceMetrics.impressions);
});

app.get('/campaign-metrics', (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType);
    res.end(Prometheus.register.metrics());
});

// Extended Fraud Prevention
campaignSchema.methods.checkFraud = function() {
    // Integrate with fraud prevention system
    const fraudDetected = this.flagAnomalies();
    if (fraudDetected) {
        this.status = 'paused';
        this.save();
        eventEmitter.emit('fraudDetected', this);
    }
};

// Campaign Analytics Dashboard
campaignSchema.statics.getCampaignAnalytics = async function(campaignId) {
    const campaign = await this.findById(campaignId).populate('ads');
    const totalSpending = await this.calculateTotalSpending(campaignId);
    const topPerformingAds = campaign.ads.sort((a, b) => b.performanceMetrics.conversionRate - a.performanceMetrics.conversionRate).slice(0, 5);
    const underperformingSegments = campaign.ads.filter(ad => ad.performanceMetrics.conversionRate < 0.01);

    return {
        campaign,
        totalSpending,
        topPerformingAds,
        underperformingSegments
    };
};