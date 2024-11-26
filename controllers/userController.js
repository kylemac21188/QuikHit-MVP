import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user';
import { validationResult } from 'express-validator';
import winston from 'winston';

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email is already registered.' });
        }

        // Hash the password and save user
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });

        await newUser.save();

        logger.info(`New user registered: ${email}`);
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        logger.error('Error during user registration', { error });
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Login an existing user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // Check if account is blocked
        if (user.isBlocked) {
            return res.status(403).json({ message: 'Account is blocked. Please contact support.' });
        }

        // Validate password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            user.failedLoginAttempts += 1;

            // Block user after 5 failed login attempts
            if (user.failedLoginAttempts >= 5) {
                user.isBlocked = true;
                await user.save();
                logger.warn(`User blocked due to multiple failed attempts: ${email}`);
                return res.status(403).json({ message: 'Account blocked after multiple failed attempts.' });
            }

            await user.save();
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        // Reset failed attempts and generate JWT
        user.failedLoginAttempts = 0;
        await user.save();

        const payload = { id: user.id, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        logger.info(`User logged in successfully: ${email}`);
        res.json({ token });
    } catch (error) {
        logger.error('Error during user login', { error });
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Update user preferences
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updatePreferences = async (req, res) => {
    const { dashboardPreferences } = req.body;

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.dashboardPreferences = dashboardPreferences;
        await user.save();

        logger.info(`User preferences updated successfully: ${req.user.id}`);
        res.json({ message: 'Preferences updated successfully.' });
    } catch (error) {
        logger.error('Error updating preferences', { error });
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Get user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.json(user);
    } catch (error) {
        logger.error('Error fetching user profile', { error });
        res.status(500).json({ message: 'Internal server error.' });
    }
};