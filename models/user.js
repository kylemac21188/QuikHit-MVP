require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const EventEmitter = require('events');
const i18n = require('i18n');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const Sentry = require('@sentry/node');
const config = require('./config');

// Define an event emitter for custom notifications
const userEvents = new EventEmitter();

// Define AuditLog Schema
const auditLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: { type: String, required: true },
    ipAddress: { type: String },
    userAgent: { type: String },
    timestamp: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// Define User Schema
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            'Please enter a valid email address'
        ]
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters long'],
        validate: {
            validator: function (value) {
                return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(value);
            },
            message: 'Password must include uppercase, lowercase, numbers, and special characters'
        }
    },
    role: {
        type: String,
        required: true,
        enum: ['advertiser', 'streamer', 'admin'],
        default: 'advertiser'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    twoFactorEnabled: {
        type: Boolean,
        default: false
    },
    twoFactorSecret: {
        type: String,
        default: null
    },
    backupCodes: {
        type: [String],
        default: []
    },
    passwordChangedAt: {
        type: Date,
        default: null
    },
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: {
        type: Date,
        default: null
    },
    sessionVersion: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Index frequently queried fields
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });

// Pre-Save Middleware to Hash Password
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        if (!this.isNew) this.passwordChangedAt = Date.now();
        next();
    } catch (err) {
        next(err);
    }
});

// Instance Method to Compare Passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Instance Method to Check Role Privileges
userSchema.methods.hasRole = function (requiredRole) {
    const rolesHierarchy = { admin: 3, streamer: 2, advertiser: 1 };
    return rolesHierarchy[this.role] >= rolesHierarchy[requiredRole];
};

// Instance Method to Verify Two-Factor Token
userSchema.methods.verifyTwoFactorToken = function (token) {
    return speakeasy.totp.verify({
        secret: this.twoFactorSecret,
        encoding: 'base32',
        token
    });
};

// Instance Method to Invalidate Sessions
userSchema.methods.invalidateSessions = async function () {
    this.sessionVersion = (this.sessionVersion || 0) + 1;
    await this.save();
};

// Static Method to Track Failed Login Attempts
userSchema.statics.failedLoginAttempt = async function (userId) {
    const user = await this.findById(userId);
    user.loginAttempts += 1;
    if (user.loginAttempts >= config.login.maxAttempts) {
        user.lockUntil = Date.now() + config.login.lockDuration; // Lock for configured duration
        try {
            userEvents.emit('userLocked', user);
        } catch (err) {
            console.error('Error emitting userLocked event:', err);
        }
    }
    await user.save();
};

// Static Method to Unlock Accounts
userSchema.statics.unlockAccount = async function (userId) {
    const user = await this.findById(userId);
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();
};

// Static Method to Generate a 2FA Secret
userSchema.statics.generateTwoFactorSecret = function () {
    return speakeasy.generateSecret({ length: 20 }).base32; // Generates a random 2FA secret
};

// Static Method to Enable Two-Factor Authentication
userSchema.statics.enableTwoFactor = async function (userId, secret) {
    const user = await this.findById(userId);
    user.twoFactorEnabled = true;
    user.twoFactorSecret = secret;
    try {
        userEvents.emit('twoFactorEnabled', user);
    } catch (err) {
        console.error('Error emitting twoFactorEnabled event:', err);
    }
    await user.save();
};

// Static Method to Log Audit Events
userSchema.statics.logAuditEvent = async function (userId, event, ipAddress, userAgent) {
    try {
        await AuditLog.create({ userId, event, ipAddress, userAgent });
    } catch (err) {
        console.error('Error logging audit event:', err);
        Sentry.captureException(err);
    }
};

// Middleware to Log Account Lock Event
userSchema.post('save', function (doc) {
    if (doc.isModified('lockUntil') && doc.lockUntil) {
        userEvents.emit('userLocked', doc);
    }
});

// Middleware to Log 2FA Enablement Event
userSchema.post('save', function (doc) {
    if (doc.isModified('twoFactorEnabled') && doc.twoFactorEnabled) {
        userEvents.emit('twoFactorEnabled', doc);
    }
});

// Hook for Account Lock Notification
userEvents.on('userLocked', async (user) => {
    await User.logAuditEvent(user._id, 'Account locked');
    console.log(`Account locked for user ${user.email}. Send notification.`);
    const mailOptions = {
        from: config.email.user,
        to: user.email,
        subject: i18n.__('Account Locked'),
        text: i18n.__('Your account has been locked due to multiple failed login attempts.')
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Email sent:', info.response);
        }
    });
});

// Hook for 2FA Enablement
userEvents.on('twoFactorEnabled', async (user) => {
    await User.logAuditEvent(user._id, '2FA enabled');
    console.log(`2FA enabled for user ${user.email}.`);
    const mailOptions = {
        from: config.email.user,
        to: user.email,
        subject: i18n.__('Two-Factor Authentication Enabled'),
        text: i18n.__('Two-Factor Authentication has been enabled on your account.')
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Email sent:', info.response);
        }
    });
});

// Rate-Limiting at IP Level
const loginLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs, // 15 minutes
    max: config.rateLimit.maxRequests, // Limit each IP to 100 requests per windowMs
    message: 'Too many login attempts from this IP, please try again after 15 minutes'
});

// Monitoring and Alerts
Sentry.init({ dsn: config.sentry.dsn });

userEvents.on('error', (err) => {
    Sentry.captureException(err);
    console.error('Event error:', err);
});

// Export the User Model
const User = mongoose.model('User', userSchema);
module.exports = User;

// Internationalization (i18n) Setup
i18n.configure({
    locales: ['en', 'es', 'fr'], // Add more locales as needed
    directory: __dirname + '/locales',
    defaultLocale: 'en',
    objectNotation: true
});

// Email Transporter Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});
