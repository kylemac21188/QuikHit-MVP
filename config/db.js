import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import winston from 'winston';
import promClient from 'prom-client';
import nodemailer from 'nodemailer';
import { IncomingWebhook } from '@slack/webhook';
import twilio from 'twilio';
import CircuitBreaker from 'opossum';
import AWS from 'aws-sdk';
import os from 'os';

dotenv.config();

// --- Validate Required Environment Variables ---
const requiredEnvVars = [
    'MONGODB_URI',
    'SENTRY_DSN',
    'EMAIL_USER',
    'EMAIL_PASS',
    'SLACK_WEBHOOK_URL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'ALERT_EMAIL_TO',
];

requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        console.error(`Environment variable ${varName} is not set.`);
        process.exit(1);
    }
});

// --- Initialize Sentry ---
Sentry.init({ dsn: process.env.SENTRY_DSN });

// --- Configure Logger ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.File({ filename: 'logs/errors.log', level: 'error' }),
    ],
});

// --- MongoDB Connection Options ---
const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    minPoolSize: 1,
    autoIndex: process.env.NODE_ENV !== 'production',
};

// --- Prometheus Metrics Setup ---
promClient.collectDefaultMetrics();

const activeConnectionsGauge = new promClient.Gauge({
    name: 'mongodb_active_connections',
    help: 'Number of active MongoDB connections',
});

const queryExecutionTimeHistogram = new promClient.Histogram({
    name: 'mongodb_query_execution_time',
    help: 'Histogram of MongoDB query execution times in ms',
    buckets: [50, 100, 200, 500, 1000],
});

// --- Utility Functions ---
const sendAlert = async (message) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const slackWebhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL);
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    if (process.env.ALERT_EMAIL_TO) {
        try {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.ALERT_EMAIL_TO,
                subject: 'MongoDB Alert',
                text: message,
            });
        } catch (error) {
            logger.error(`Failed to send email alert: ${error.message}`);
        }
    }

    if (process.env.SLACK_WEBHOOK_URL) {
        try {
            await slackWebhook.send({ text: message });
        } catch (error) {
            logger.error(`Failed to send Slack alert: ${error.message}`);
        }
    }

    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: process.env.ALERT_EMAIL_TO,
        });
    } catch (error) {
        logger.error(`Failed to send SMS alert: ${error.message}`);
    }
};

// --- MongoDB Connection Management ---
const connectDB = async (retries = 3) => {
    while (retries) {
        try {
            await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
            logger.info('MongoDB connected successfully.');
            activeConnectionsGauge.set(mongoose.connections.length);
            return;
        } catch (error) {
            logger.error(`Failed to connect to MongoDB: ${error.message}`);
            Sentry.captureException(error);
            sendAlert(`MongoDB connection failed: ${error.message}`);
            retries -= 1;

            if (!retries) {
                logger.error('All MongoDB connection retries failed. Exiting...');
                process.exit(1);
            }

            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
};

mongoose.connection.on('connected', () => {
    logger.info('MongoDB connection established.');
    activeConnectionsGauge.set(mongoose.connections.length);
});

mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB connection lost.');
    sendAlert('MongoDB disconnected.');
});

mongoose.connection.on('error', (error) => {
    logger.error(`MongoDB error: ${error.message}`);
    Sentry.captureException(error);
    sendAlert(`MongoDB error: ${error.message}`);
});

// --- Circuit Breaker ---
const circuitBreaker = new CircuitBreaker(connectDB, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 60000,
});

circuitBreaker.on('open', () => {
    logger.warn('MongoDB Circuit Breaker is open. Pausing reconnection attempts.');
    sendAlert('MongoDB Circuit Breaker is open.');
});

circuitBreaker.on('halfOpen', () => {
    logger.info('MongoDB Circuit Breaker is half-open. Retrying connection...');
});

circuitBreaker.on('close', () => {
    logger.info('MongoDB Circuit Breaker is closed. Normal operation resumed.');
});

// --- Health Check Endpoint ---
const healthCheck = async (req, res) => {
    const status = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
    const diagnostics = {
        status,
        activeConnections: mongoose.connections.length,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime(),
        circuitBreakerState: circuitBreaker.status.name,
    };
    res.status(status === 'healthy' ? 200 : 500).json(diagnostics);
};

// --- Graceful Shutdown ---
const closeDB = async () => {
    try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed.');
    } catch (error) {
        logger.error(`Error during MongoDB shutdown: ${error.message}`);
        Sentry.captureException(error);
    }
};

process.on('SIGINT', async () => {
    await closeDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeDB();
    process.exit(0);
});

// --- Exports ---
export { connectDB, closeDB, healthCheck };
