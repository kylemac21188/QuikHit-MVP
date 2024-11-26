const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const { connectDB } = require('./config/db');
const { initializeSentry } = require('./middlewares/sentry');
const { initializeMetrics } = require('./middlewares/metrics');
const { rateLimiterMiddleware } = require('./middlewares/rateLimiter');
const client = require('prom-client');
const config = require('./config');
const { body, validationResult } = require('express-validator');
const expressAsyncErrors = require('express-async-errors'); // Simplifies async error handling
const mongoose = require('mongoose');
const promClient = require('prom-client');
const redis = require('redis');
const xss = require('xss-clean');
const hpp = require('hpp');
const csp = require('helmet-csp');
const request = require('supertest');
const { describe, it, expect } = require('@jest/globals');
const aiAnalytics = require('./middlewares/aiAnalytics');
const fraudDetection = require('./middlewares/fraudDetection');
const adaptiveRateLimiter = require('./middlewares/adaptiveRateLimiter');
const zeroTrust = require('./middlewares/zeroTrust');
const jwtAuth = require('./middlewares/jwtAuth');
const blockchainLogger = require('./middlewares/blockchainLogger');
const sandbox = require('./middlewares/sandbox');
const selfHealing = require('./middlewares/selfHealing');
const alerts = require('./middlewares/alerts');

require('dotenv').config();

// Validate Required Environment Variables
const requiredEnvVars = ['SENTRY_DSN', 'MONGODB_URI'];
requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        console.error(`Environment variable ${varName} is not set.`);
        process.exit(1);
    }
});

// Initialize Express App
const app = express();

// Logging Setup with Winston
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/error.log' }),
    ],
});

// Middleware: Security and Logging
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(helmet());
app.use(compression());

// Middleware: Request Logging with Correlation IDs
app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Correlation-ID', req.id);
    logger.info({
        correlationId: req.id,
        method: req.method,
        url: req.url,
    });
    next();
});

// Middleware: Sentry Integration
const { requestHandler, errorHandler } = initializeSentry();
app.use(requestHandler);

// Middleware: Prometheus Metrics
const { metricsMiddleware } = initializeMetrics();
app.use(metricsMiddleware);

// Middleware: Rate Limiting
app.use(rateLimiterMiddleware());

// Swagger API Documentation
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'QuikHit API',
            version: '1.0.0',
            description: 'API documentation for QuikHit backend',
        },
    },
    apis: ['./routes/*.js'], // Adjust to match your routes folder
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Health Check Endpoint
app.get('/health', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const healthStatus = dbState === 1 ? 'healthy' : 'unhealthy';
    res.status(dbState === 1 ? 200 : 500).json({ status: healthStatus });
});

// API Versioning
const apiBase = '/api/v1';

// Example Route with Validation
app.post(
    `${apiBase}/example`,
    [
        body('email').isEmail().withMessage('Email must be valid'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        res.json({ message: 'Example route is working!' });
    }
);

// Metrics Endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// Custom Error Handling Middleware
app.use((err, req, res, next) => {
    logger.error({
        message: err.message,
        stack: err.stack,
    });
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
});

// 404 Error Handling for Unhandled Routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Sentry Error Handler
app.use(errorHandler);

// Connect to MongoDB
connectDB();

// Start Server
const PORT = config.server.port || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Graceful Shutdown Handling
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
    server.close(() => {
        logger.info('Server shutting down...');
        process.exit(0);
    });
}
// Middleware: Structured Error Responses
app.use((err, req, res, next) => {
    const errorResponse = {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred',
        details: err.details || {},
    };
    logger.error(errorResponse);
    res.status(err.statusCode || 500).json(errorResponse);
});

// Middleware: API Key Authentication
const apiKeyMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Invalid or missing API key' });
    }
    next();
};

// Middleware: Role-Based Access Control (RBAC)
const rbacMiddleware = (requiredRole) => (req, res, next) => {
    const userRole = req.user.role; // Assuming user role is set in req.user
    if (!userRole || userRole !== requiredRole) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    next();
};

// Real-Time Monitoring with Prometheus
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics();

app.get('/monitoring', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// Caching Layer with Redis
const redisClient = redis.createClient();

const cacheMiddleware = (req, res, next) => {
    const key = req.originalUrl;
    redisClient.get(key, (err, data) => {
        if (err) throw err;
        if (data) {
            res.send(JSON.parse(data));
        } else {
            res.sendResponse = res.send;
            res.send = (body) => {
                redisClient.setex(key, 3600, JSON.stringify(body));
                res.sendResponse(body);
            };
            next();
        }
    });
};

// Enhanced Security Features

app.use(xss());
app.use(hpp());
app.use(csp({
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'trusted-cdn.com'],
        styleSrc: ["'self'", 'trusted-cdn.com'],
        imgSrc: ["'self'", 'trusted-cdn.com'],
    },
}));

// Improved Swagger Documentation
swaggerOptions.swaggerDefinition.components = {
    securitySchemes: {
        ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
        },
    },
};
swaggerOptions.swaggerDefinition.security = [{
    ApiKeyAuth: [],
}];
swaggerOptions.swaggerDefinition.paths = {
    ...swaggerOptions.swaggerDefinition.paths,
    '/example': {
        post: {
            tags: ['Example'],
            summary: 'Example route',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                email: { type: 'string', example: 'user@example.com' },
                                password: { type: 'string', example: 'password123' },
                            },
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Success',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string', example: 'Example route is working!' },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: 'Validation Error',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    errors: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                msg: { type: 'string' },
                                                param: { type: 'string' },
                                                location: { type: 'string' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};

// Integration Testing Setup with Jest and Supertest

describe('GET /health', () => {
    it('should return 200 OK', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('status', 'healthy');
    });
});

describe('POST /api/v1/example', () => {
    it('should return 400 for invalid input', async () => {
        const res = await request(app)
            .post('/api/v1/example')
            .send({ email: 'invalid', password: 'short' });
        expect(res.statusCode).toEqual(400);
        expect(res.body).toHaveProperty('errors');
    });

    it('should return 200 for valid input', async () => {
        const res = await request(app)
            .post('/api/v1/example')
            .send({ email: 'user@example.com', password: 'password123' });
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('message', 'Example route is working!');
    });
});
// AI-Driven Features: Analytics Module
app.use(aiAnalytics.monitorUsage);

// AI-Driven Features: Fraud Detection
app.use(fraudDetection.detectAnomalies);

// AI-Driven Features: Adaptive Rate Limiting
app.use(adaptiveRateLimiter.adjustLimits);

// Scalability and Resilience: Kubernetes Configuration
// (Assuming Kubernetes configuration files are created separately)

// Scalability and Resilience: Multi-Cloud Deployment
// (Assuming multi-cloud deployment scripts are created separately)

// Scalability and Resilience: Global CDN Integration
// (Assuming CDN configuration is done separately)

// Enhanced Security: Zero-Trust Security
app.use(zeroTrust.enforcePolicies);

// Enhanced Security: JWT Authentication
app.use(jwtAuth.verifyToken);

// Enhanced Security: Quantum-Safe Cryptography
// (Assuming quantum-safe cryptography libraries are integrated separately)

// Emerging Technologies: Blockchain Logging
app.use(blockchainLogger.logRequests);

// Emerging Technologies: AR/VR Content Endpoint
app.get('/ar-vr-content', (req, res) => {
    res.json({ message: 'AR/VR content endpoint' });
});

// Developer Ecosystem: Developer Sandbox
app.use('/sandbox', sandbox.handleRequests);

// Developer Ecosystem: SDK Generation
// (Assuming SDK generation scripts are created separately)

// Operational Excellence: Self-Healing Infrastructure
selfHealing.monitorAndHeal();

// Operational Excellence: Real-Time Alerts
alerts.setupAlerts();

// Testing and QA: Mock Redis Caching
jest.mock('redis', () => ({
    createClient: () => ({
        get: jest.fn(),
        setex: jest.fn(),
    }),
}));

// Testing and QA: Integration Tests
describe('Integration Tests', () => {
    it('should handle health check', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toEqual(200);
    });

    it('should handle JWT authentication', async () => {
        const res = await request(app)
            .get('/protected-route')
            .set('Authorization', 'Bearer valid-jwt-token');
        expect(res.statusCode).toEqual(200);
    });

    it('should handle AR/VR content request', async () => {
        const res = await request(app).get('/ar-vr-content');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('message', 'AR/VR content endpoint');
    });
});