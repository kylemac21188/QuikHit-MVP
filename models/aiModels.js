import * as tf from '@tensorflow/tfjs-node'; // Enables TensorFlow GPU support
import redis from 'redis';
import { SHAP, LIME } from 'explainability-libraries';
import { Counter, Histogram, Gauge } from 'prom-client';
import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import config from './config'; // Import configurations from a config file

const redisClient = redis.createClient();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_IV = process.env.ENCRYPTION_IV;

class AIModels {
    constructor() {
        this.models = {};
        this.contextMap = {};
        this.cacheFallback = new Map(); // In-memory fallback cache
        this.initializeMetrics();
        this.gpuAvailable = tf.engine().backendName === 'tensorflow';
        this.blockchainClient = new config.BlockchainClient();
        this.metaLearner = new config.MetaLearner();
        this.serverlessClient = new config.ServerlessClient();
        this.config = config; // Load configuration
    }

    initializeMetrics() {
        this.metrics = {};
        const metricConfigs = this.config.metricConfigs;

        metricConfigs.forEach(({ name, type, options }) => {
            this.metrics[name] = new (promClient[type])(options);
        });
    }

    validateInput(input, expectedShape) {
        const isValid = expectedShape.every((dim, idx) => dim === null || input[idx].length === dim);
        if (!isValid) {
            throw new Error(`Input shape does not match expected shape: ${expectedShape}`);
        }
    }

    async trainModel(data, config) {
        try {
            const start = Date.now();
            const model = tf.sequential();
            config.layers.forEach(layerConfig =>
                model.add(tf.layers[layerConfig.type](layerConfig.options))
            );
            model.compile(config.compileOptions);

            await model.fit(data.inputs, data.labels, config.fitOptions);

            const trainingTime = (Date.now() - start) / 1000;
            this.metrics.trainingTime.labels(config.modelName).observe(trainingTime);

            this.models[config.modelName] = model;
            this.metrics.accuracy.labels(config.modelName).set(config.accuracy || 0);

            return model;
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Error during model training');
        }
    }

    async predict(modelName, inputData) {
        try {
            this.validateModel(modelName);
            this.validateInput(inputData, [1, null]); // Example shape validation

            const model = this.models[modelName];
            if (!model) throw new Error(`Model "${modelName}" not found.`);

            const start = Date.now();
            const prediction = model.predict(tf.tensor(inputData));
            const latency = Date.now() - start;

            this.metrics.inferenceLatency.labels(modelName).observe(latency);
            return prediction.dataSync();
        } catch (error) {
            Sentry.captureException(error);
            this.metrics.inferenceFailures.labels(modelName).inc();
            throw new Error('Inference failed');
        }
    }

    async explainPrediction(modelName, inputData, method = 'SHAP') {
        try {
            const explainer = method === 'LIME'
                ? new LIME(this.models[modelName])
                : new SHAP(this.models[modelName]);
            return explainer.explain(inputData);
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Explainability failed');
        }
    }

    encryptData(data) {
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, ENCRYPTION_IV);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decryptData(encryptedData) {
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, ENCRYPTION_IV);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    async encryptWeightsAsync(modelName) {
        try {
            const model = this.models[modelName];
            if (!model) throw new Error(`Model "${modelName}" not found.`);
            const weights = model.getWeights();

            return await Promise.all(weights.map(async (weight) => {
                const buffer = Buffer.from(weight.dataSync());
                return this.encryptData(buffer);
            }));
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Error during encryption of weights');
        }
    }

    async decryptWeights(encryptedWeights) {
        try {
            return encryptedWeights.map(encryptedWeight => {
                const decrypted = this.decryptData(encryptedWeight);
                return tf.tensor(decrypted); // Convert back to Tensor
            });
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Decryption of weights failed');
        }
    }

    async monitorHealth() {
        Prometheus.collectDefaultMetrics();
    }

    registerContexts(contextMappings) {
        this.contextMap = { ...this.contextMap, ...contextMappings };
    }

    switchModel(context) {
        const modelName = this.contextMap?.[context];
        if (!modelName || !this.models[modelName]) {
            throw new Error(`No model registered for context "${context}".`);
        }
        return this.models[modelName];
    }

    async updateModel(modelName, newData, config) {
        try {
            const model = this.models[modelName];
            if (!model) throw new Error(`Model "${modelName}" not found.`);

            await model.fit(newData.inputs, newData.labels, config.fitOptions);
            this.models[modelName] = model;
            return model;
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Error during model update');
        }
    }

    async versionModel(modelName) {
        try {
            const model = this.models[modelName];
            if (!model) throw new Error(`Model "${modelName}" not found.`);

            const version = Date.now();
            const versionedModelPath = `models/${modelName}_v${version}.json`;
            await model.save(`file://${versionedModelPath}`);
            return versionedModelPath;
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Error during model versioning');
        }
    }

    async failoverPrediction(modelName, inputData) {
        try {
            return await this.predict(modelName, inputData);
        } catch (error) {
            Sentry.captureException(error);
            const cachedPrediction = await this.getCachedPrediction(modelName);
            if (cachedPrediction) {
                return cachedPrediction;
            }
            throw new Error('Prediction failed and no cached prediction available');
        }
    }

    async cachePrediction(key, value) {
        try {
            await this.secureRedisOperation('set', key, JSON.stringify(value), 'EX', 3600);
        } catch (error) {
            this.cacheFallback.set(key, { value, expiry: Date.now() + 3600000 });
        }
    }

    async getCachedPrediction(key) {
        try {
            return await this.secureRedisOperation('get', key);
        } catch (error) {
            const fallback = this.cacheFallback.get(key);
            if (fallback && fallback.expiry > Date.now()) {
                return fallback.value;
            }
            return null;
        }
    }

    async monitorAdvancedMetrics() {
        const gpuUtilization = this.gpuAvailable ? tf.memory().numBytesInGPUAllocated : 0;
        const memoryConsumption = tf.memory().numBytes;
        const successRate = this.metrics.inferenceFailures.get().values[0]?.value / this.metrics.inferenceLatency.get().values[0]?.value;

        return {
            gpuUtilization,
            memoryConsumption,
            successRate: successRate || 0
        };
    }

    async secureRedisOperation(operation, ...args) {
        try {
            return await new Promise((resolve, reject) => {
                redisClient[operation](...args, (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
        } catch (error) {
            Sentry.captureException(error);
            return null; // Default fallback
        }
    }

    async healthCheck() {
        return Object.entries(this.models).reduce((acc, [modelName, model]) => {
            try {
                const prediction = model.predict(tf.tensor([[0]])); // Example input
                acc[modelName] = prediction ? 'Healthy' : 'Unhealthy';
            } catch (error) {
                acc[modelName] = 'Unhealthy';
            }
            return acc;
        }, {});
    }

    async decentralizedTraining(dataSources, config) {
        try {
            const aggregatedModel = tf.sequential();
            config.layers.forEach(layerConfig =>
                aggregatedModel.add(tf.layers[layerConfig.type](layerConfig.options))
            );
            aggregatedModel.compile(config.compileOptions);

            const weightsSum = aggregatedModel.getWeights().map(weight => tf.zerosLike(weight));
            const totalDataSize = dataSources.reduce((sum, ds) => sum + ds.data.inputs.length, 0);

            await Promise.all(
                dataSources.map(async (dataSource) => {
                    const localModel = await this.trainModel(dataSource.data, config);
                    const localWeights = localModel.getWeights();
                    const weightFactor = dataSource.data.inputs.length / totalDataSize;
                    localWeights.forEach((weight, i) => {
                        weightsSum[i] = weightsSum[i].add(weight.mul(weightFactor));
                    });
                })
            );

            aggregatedModel.setWeights(weightsSum);
            this.models[config.modelName] = aggregatedModel;
            return aggregatedModel;
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Decentralized training failed');
        }
    }

    async logToBlockchain(modelName, metrics) {
        const retryLimit = this.config.blockchainRetryLimit;
        let attempts = 0;
        while (attempts < retryLimit) {
            try {
                const logData = {
                    modelName,
                    version: Date.now(),
                    metrics,
                };
                await this.blockchainClient.log(logData);
                this.metrics.blockchainStatus.labels(modelName).set(1); // Success
                return;
            } catch (error) {
                attempts++;
                Sentry.captureException(error, {
                    extra: {
                        retryAttempts: attempts,
                        modelName,
                        metrics,
                    }
                });
                if (attempts >= retryLimit) {
                    this.metrics.blockchainStatus.labels(modelName).set(0); // Failure
                    throw new Error('Blockchain logging failed after multiple attempts');
                }
            }
        }
    }

    async explainableAIDashboard(modelName, inputData, method = 'SHAP') {
        try {
            const explainer = method === 'LIME'
                ? new LIME(this.models[modelName])
                : new SHAP(this.models[modelName]);
            const explanation = await explainer.explain(inputData);
            this.updateDashboard(modelName, explanation);
        } catch (error) {
            Sentry.captureException(error);
            throw new Error('Explainable AI dashboard update failed');
        }
    }

    updateDashboard(modelName, explanation) {
        // Hypothetical function to update the dashboard
        console.log(`Updating dashboard for model ${modelName} with explanation:`, explanation);
    }

    async aiDrivenModelSwitching(context, inputData) {
        try {
            const bestModelName = await this.metaLearner.determineBestModel(context, inputData);
            if (!this.models[bestModelName]) {
                throw new Error(`Model "${bestModelName}" not found.`);
            }
            return this.models[bestModelName];
        } catch (error) {
            Sentry.captureException(error);
            return this.switchModel(context); // Fallback to default model switching
        }
    }

    async serverlessPrediction(modelName, inputData) {
        const timeout = this.config.serverlessTimeout; // Configurable timeout
        try {
            const response = await Promise.race([
                this.serverlessClient.invokeFunction('predict', { modelName, inputData }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
            ]);
            this.metrics.serverlessLatency.labels(modelName).observe(response.latency);
            return response.prediction;
        } catch (error) {
            Sentry.captureException(error, {
                extra: {
                    modelName,
                    inputData,
                }
            });
            throw new Error('Serverless prediction failed');
        }
    }
}

export default new AIModels();