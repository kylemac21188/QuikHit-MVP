import Stripe from 'stripe';
import PayPal from 'paypal-rest-sdk';
import { ethers } from 'ethers';
import circuitBreaker from 'opossum';
import crypto from 'crypto';
import winston from 'winston';
import promClient from 'prom-client';
import Sentry from '@sentry/node';
import rateLimit from 'express-rate-limit';

// Import necessary SDKs and setup environment configurations for Stripe, PayPal, and Ethereum
require('dotenv').config();

const stripe = Stripe(process.env.STRIPE_API_KEY);

PayPal.configure({
    mode: process.env.PAYPAL_MODE, // 'sandbox' or 'live'
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// Setup provider for Ethereum (Infura, Alchemy, etc.)
const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);

// Circuit breaker configuration to prevent cascading failures
const paymentCircuitBreaker = new circuitBreaker(async (fn) => await fn(), {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
});

// Method for initiating a Stripe payment
// Removed duplicate declaration

// Method for initiating a PayPal payment
export const initiatePayPalPayment = async (amount, currency) => {
    try {
        const createPaymentJson = {
            intent: "sale",
            payer: {
                payment_method: "paypal"
            },
            transactions: [{
                amount: {
                    currency,
                    total: amount.toString(),
                },
                description: "Payment for ad services on QuikHit"
            }],
            redirect_urls: {
                return_url: "https://yourapp.com/payment-success",
                cancel_url: "https://yourapp.com/payment-cancel"
            }
        };

        const payment = await new Promise((resolve, reject) => {
            PayPal.payment.create(createPaymentJson, (error, payment) => {
                if (error) {
                    return reject(error);
                }
                resolve(payment);
            });
        });
        return payment;
    } catch (error) {
        console.error('Error initiating PayPal payment:', error);
        throw new Error('PayPal payment initiation failed');
    }
};

// Method for initiating a Crypto payment
export const initiateCryptoPayment = async (amount, walletAddress) => {
    try {
        const signer = provider.getSigner();
        const transaction = {
            to: walletAddress,
            value: ethers.utils.parseEther(amount.toString()),
        };

        const response = await signer.sendTransaction(transaction);
        await response.wait();
        return response;
    } catch (error) {
        console.error('Error initiating crypto payment:', error);
        throw new Error('Crypto payment initiation failed');
    }
};

// Stripe webhook handler
export const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle different event types (e.g., payment_intent.succeeded)
    switch (event.type) {
        case 'payment_intent.succeeded':
            console.log('Payment succeeded:', event.data.object);
            // Process successful payment logic
            break;
        case 'payment_intent.payment_failed':
            console.log('Payment failed:', event.data.object);
            // Handle payment failure
            break;
        // Handle other event types
        default:
            console.log(`Unhandled event type ${event.type}`);
    }
    res.json({ received: true });
};

// PayPal webhook handler
export const handlePayPalWebhook = async (req, res) => {
    try {
        const body = req.body;
        // Validate the webhook using PayPal SDK or REST API validation
        if (body.event_type === 'PAYMENT.SALE.COMPLETED') {
            console.log('PayPal Payment Sale Completed:', body);
            // Handle successful payment logic here
        }
    } catch (error) {
        console.error('Error handling PayPal webhook:', error);
        return res.status(500).send('Webhook Handling Error');
    }
};

// Crypto payment listener
export const listenForCryptoPayment = async (transactionHash) => {
    provider.once(transactionHash, (transaction) => {
        console.log('Crypto Payment Confirmed:', transaction);
        // Handle post-payment logic
    });
};

// Retry payment function with exponential backoff
// Removed duplicate declaration

// Example usage of retryPayment for Stripe
export const initiateStripePaymentWithRetry = async (amount, currency, paymentMethodId) => {
    return retryPayment(() => initiateStripePayment(amount, currency, paymentMethodId));
};

// Fallback strategy example
export const initiatePaymentWithFallback = async (amount, currency, paymentMethodId) => {
    try {
        return await paymentCircuitBreaker.fire(() => initiateStripePayment(amount, currency, paymentMethodId));
    } catch (error) {
        console.warn('Stripe payment failed, falling back to PayPal...');
        return initiatePayPalPayment(amount, currency);
    }
};

// Process a refund
export const processRefund = async (paymentId, paymentMethod) => {
    try {
        if (paymentMethod === 'stripe') {
            return await stripe.refunds.create({ payment_intent: paymentId });
        } else if (paymentMethod === 'paypal') {
            const saleId = await getSaleId(paymentId); // Assuming there's a way to get saleId from your data
            return await new Promise((resolve, reject) => {
                PayPal.sale.refund(saleId, {}, (error, refund) => {
                    if (error) return reject(error);
                    resolve(refund);
                });
            });
        }
    } catch (error) {
        console.error('Error processing refund:', error);
        throw new Error('Refund processing failed');
    }
};

// Capture payment
export const capturePayment = async (paymentId, paymentMethod) => {
    try {
        if (paymentMethod === 'stripe') {
            return await stripe.paymentIntents.capture(paymentId);
        } else if (paymentMethod === 'paypal') {
            const payment = await new Promise((resolve, reject) => {
                PayPal.payment.execute(paymentId, {}, (error, payment) => {
                    if (error) return reject(error);
                    resolve(payment);
                });
            });
            return payment;
        }
    } catch (error) {
        console.error('Error capturing payment:', error);
        throw new Error('Payment capture failed');
    }
};

// Data encryption example for payment data
// Removed duplicate declaration
// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Configure Prometheus metrics
const paymentSuccessCounter = new promClient.Counter({
    name: 'payment_success_total',
    help: 'Total number of successful payments',
    labelNames: ['gateway']
});

const paymentFailureCounter = new promClient.Counter({
    name: 'payment_failure_total',
    help: 'Total number of failed payments',
    labelNames: ['gateway']
});

const retryCounter = new promClient.Counter({
    name: 'payment_retry_total',
    help: 'Total number of payment retries',
    labelNames: ['gateway']
});

const circuitBreakerState = new promClient.Gauge({
    name: 'circuit_breaker_state',
    help: 'State of the circuit breaker',
    labelNames: ['gateway']
});

// Configure Sentry
Sentry.init({ dsn: process.env.SENTRY_DSN });

// Rate limiting
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 requests per windowMs
    message: 'Too many requests, please try again later.'
});

// Enhanced encryption logic using RSA
export const encryptPaymentData = (data) => {
    const publicKey = process.env.RSA_PUBLIC_KEY;
    const buffer = Buffer.from(JSON.stringify(data), 'utf8');
    const encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
};

export const decryptPaymentData = (encryptedData) => {
    const privateKey = process.env.RSA_PRIVATE_KEY;
    const buffer = Buffer.from(encryptedData, 'base64');
    const decrypted = crypto.privateDecrypt(privateKey, buffer);
    return JSON.parse(decrypted.toString('utf8'));
};

// Utility function for currency conversion
export const convertCurrency = async (amount, fromCurrency, toCurrency) => {
    const response = await fetch(`http://api.currencylayer.com/convert?access_key=${process.env.CURRENCY_LAYER_API_KEY}&from=${fromCurrency}&to=${toCurrency}&amount=${amount}`);
    const data = await response.json();
    if (data.success) {
        return data.result;
    } else {
        throw new Error('Currency conversion failed');
    }
};

// Example usage of retryPayment with jitter
export const retryPayment = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            logger.error(`Retrying payment due to error: ${error.message}`);
            const jitter = Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i) + jitter));
        }
    }
};

// Example usage of logging and metrics in payment initiation
export const initiateStripePayment = async (amount, currency, paymentMethodId, tenantId) => {
    try {
        const convertedAmount = await convertCurrency(amount, currency, 'USD');
        const paymentIntent = await stripe.paymentIntents.create({
            amount: convertedAmount,
            currency: 'USD',
            payment_method: paymentMethodId,
            confirm: true,
            metadata: { tenantId }
        });
        paymentSuccessCounter.inc({ gateway: 'stripe' });
        logger.info('Stripe payment succeeded', { tenantId, amount, currency });
        return paymentIntent;
    } catch (error) {
        paymentFailureCounter.inc({ gateway: 'stripe' });
        logger.error('Error initiating Stripe payment', { tenantId, error: error.message });
        Sentry.captureException(error);
        throw new Error('Stripe payment initiation failed');
    }
};

// Similar updates for other payment methods and webhook handlers...