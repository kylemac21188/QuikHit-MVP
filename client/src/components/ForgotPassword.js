import React, { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { TextField, Button, Container, Typography, CircularProgress } from '@material-ui/core';
import { useSnackbar } from 'notistack';
import ReCAPTCHA from 'react-google-recaptcha';
import CryptoJS from 'crypto-js';
import winston from 'winston';
import Cookies from 'js-cookie';
import { io } from 'socket.io-client';
import { apiClient } from '../utils/apiClient';
import animationData from '../../animations/loading.json';
import Lottie from 'react-lottie';
import TwitchButton from '../reusable/TwitchButton';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import cron from 'node-cron';

const BiometricAuth = lazy(() => import('../reusable/BiometricAuth'));
const ChatbotAssistant = lazy(() => import('../reusable/ChatbotAssistant'));

const ForgotPassword = () => {
    const { register, handleSubmit, errors } = useForm();
    const { enqueueSnackbar } = useSnackbar();
    const [loading, setLoading] = useState(false);
    const [twitchAccountInfo, setTwitchAccountInfo] = useState(null);
    const [authStatus, setAuthStatus] = useState('');
    const [countdown, setCountdown] = useState(null);
    const recaptchaRef = useRef(null);
    const socket = io('http://your-backend-url');

    // Initialize logger
    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.json(),
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: 'app.log' }),
        ],
    });

    // Centralized error handling function
    const handleApiError = (error, context) => {
        if (error.response) {
            logger.error(`${context} - Server Error: ${error.response.status} - ${error.response.data}`);
            enqueueSnackbar('Server error occurred. Please try again later.', { variant: 'error' });
        } else if (error.request) {
            logger.error(`${context} - Network Error: No response received`);
            enqueueSnackbar('Network error. Please check your internet connection.', { variant: 'error' });
        } else {
            logger.error(`${context} - Error: ${error.message}`);
            enqueueSnackbar('An error occurred. Please try again.', { variant: 'error' });
        }
    };

    // Encrypt message using AES-256
    const encryptMessage = (message) => {
        const key = CryptoJS.enc.Utf8.parse('YOUR_SECRET_KEY');
        const iv = CryptoJS.enc.Utf8.parse('YOUR_IV');
        const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(message), key, {
            keySize: 256 / 8,
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7,
        });
        return encrypted.toString();
    };

    // Submit handler for Forgot Password form
    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const isBiometricallyVerified = await handleBiometricVerification();
            if (!isBiometricallyVerified) {
                setLoading(false);
                return;
            }

            const response = await apiClient.post('/forgot-password', {
                email: encryptMessage(data.email),
                twitchToken: twitchAccountInfo?.twitchToken,
            });
            enqueueSnackbar('Password reset link has been sent to your email.', { variant: 'success' });
        } catch (error) {
            handleApiError(error, 'Sending Reset Link');
        } finally {
            setLoading(false);
        }
    };

    // Handle Twitch OAuth Authentication
    const handleTwitchAuth = async () => {
        const recaptchaToken = await recaptchaRef.current.executeAsync();
        recaptchaRef.current.reset();
        try {
            const response = await apiClient.post('/verify-recaptcha', { token: recaptchaToken });
            if (response.data.success) {
                const clientId = 'YOUR_TWITCH_CLIENT_ID';
                const redirectUri = 'YOUR_REDIRECT_URI';
                const scope = 'user:read:email';
                const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}`;
                window.location.href = authUrl;
            } else {
                enqueueSnackbar('reCAPTCHA verification failed. Please try again.', { variant: 'error' });
            }
        } catch (error) {
            handleApiError(error, 'Initiating Twitch Authentication');
        }
    };

    // Capture Twitch token from URL and validate it
    useEffect(() => {
        const hash = window.location.hash;
        if (hash) {
            const params = new URLSearchParams(hash.replace('#', '?'));
            const twitchToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            if (twitchToken && refreshToken) {
                validateTwitchToken(twitchToken, refreshToken);
            }
        }
    }, []);

    const validateTwitchToken = async (twitchToken, refreshToken) => {
        try {
            const encryptedToken = encryptMessage(twitchToken);
            const response = await apiClient.post('/validate-twitch-token', { twitchToken: encryptedToken });
            if (response.data.valid) {
                enqueueSnackbar('Twitch account linked successfully.', { variant: 'success' });
                setTwitchAccountInfo({
                    displayName: response.data.accountInfo.displayName,
                    twitchToken: twitchToken,
                    refreshToken: refreshToken,
                });
                logger.info('Twitch account linked successfully.');
            } else {
                enqueueSnackbar('Twitch authentication failed.', { variant: 'error' });
                logger.warn('Twitch authentication failed.');
            }
        } catch (error) {
            handleApiError(error, 'Validating Twitch Token');
        }
    };

    // Function to refresh Twitch token
    const refreshTwitchToken = async (refreshToken) => {
        try {
            const response = await apiClient.post('/refresh-twitch-token', { refreshToken });
            if (response.data.accessToken) {
                setTwitchAccountInfo((prevInfo) => ({
                    ...prevInfo,
                    twitchToken: response.data.accessToken,
                }));
                enqueueSnackbar('Twitch token refreshed successfully.', { variant: 'success' });
                logger.info('Twitch token refreshed successfully.');
            } else {
                enqueueSnackbar('Failed to refresh Twitch token. Please re-authenticate.', { variant: 'error' });
                logger.warn('Failed to refresh Twitch token.');
            }
        } catch (error) {
            handleApiError(error, 'Refreshing Twitch Token');
        }
    };

    // Periodically refresh the Twitch token
    useEffect(() => {
        const interval = setInterval(() => {
            if (twitchAccountInfo?.refreshToken) {
                refreshTwitchToken(twitchAccountInfo.refreshToken);
            }
        }, 3600000); // Refresh every hour
        return () => clearInterval(interval);
    }, [twitchAccountInfo]);

    // Update auth status dynamically
    useEffect(() => {
        if (loading) {
            setAuthStatus('Requesting token...');
        } else if (twitchAccountInfo) {
            setAuthStatus('Authentication successful');
        } else {
            setAuthStatus('');
        }
    }, [loading, twitchAccountInfo]);

    // Notify user if Twitch token is about to expire
    useEffect(() => {
        if (twitchAccountInfo?.twitchToken) {
            const tokenExpiryNotification = setTimeout(() => {
                enqueueSnackbar('Your Twitch token is about to expire. Please re-authenticate.', { variant: 'warning' });
            }, 3540000); // Notify 59 minutes after token retrieval
            return () => clearTimeout(tokenExpiryNotification);
        }
    }, [twitchAccountInfo]);

    // Twitch token renewal countdown timer
    useEffect(() => {
        if (twitchAccountInfo?.twitchToken) {
            const tokenExpiryTime = new Date().getTime() + 3600000; // Assuming token expires in 1 hour
            const interval = setInterval(() => {
                const timeLeft = tokenExpiryTime - new Date().getTime();
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    setCountdown('Token expired');
                } else {
                    setCountdown(`Token expires in ${Math.floor(timeLeft / 60000)} minutes`);
                }
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [twitchAccountInfo]);

    // Listen for Twitch token status updates
    useEffect(() => {
        socket.on('twitchTokenStatus', (status) => {
            if (status === 'refreshed') {
                enqueueSnackbar('Twitch token refreshed successfully.', { variant: 'success' });
                setAuthStatus('Token refreshed');
            } else if (status === 'expiringSoon') {
                enqueueSnackbar('Your Twitch token is about to expire. Please re-authenticate.', { variant: 'warning' });
                setAuthStatus('Token expiring soon');
            }
        });

        return () => {
            socket.off('twitchTokenStatus');
        };
    }, []);

    // Function to handle biometric verification using WebAuthn API
    const handleBiometricVerification = async () => {
        try {
            const publicKeyCredentialRequestOptions = await apiClient.get('/generate-assertion-options');
            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions.data,
            });

            const response = await apiClient.post('/verify-assertion', {
                id: assertion.id,
                rawId: Array.from(new Uint8Array(assertion.rawId)),
                type: assertion.type,
                response: {
                    authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
                    clientDataJSON: Array.from(new Uint8Array(assertion.response.clientDataJSON)),
                    signature: Array.from(new Uint8Array(assertion.response.signature)),
                    userHandle: assertion.response.userHandle ? Array.from(new Uint8Array(assertion.response.userHandle)) : null,
                },
            });

            if (response.data.verified) {
                enqueueSnackbar('Biometric verification successful.', { variant: 'success' });
                return true;
            } else {
                enqueueSnackbar('Biometric verification failed. Please try again.', { variant: 'error' });
                return false;
            }
        } catch (error) {
            handleApiError(error, 'Biometric Verification');
            return false;
        }
    };

    // Retry button for Twitch authentication
    const handleRetryAuth = () => {
        handleTwitchAuth();
    };

    // Start voice recognition
    const startVoiceRecognition = () => {
        recognition.start();
        enqueueSnackbar('Voice recognition started. Please speak your command.', { variant: 'info' });
    };

    // Handle voice commands
    const handleVoiceCommand = (command) => {
        if (command.includes('email')) {
            const email = command.replace('email', '').trim();
            document.querySelector('input[name="email"]').value = email;
            enqueueSnackbar('Email field updated via voice command.', { variant: 'info' });
        } else if (command.includes('link Twitch')) {
            handleTwitchAuth();
            enqueueSnackbar('Initiating Twitch OAuth linking via voice command.', { variant: 'info' });
        } else if (command.includes('send reset link')) {
            document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            enqueueSnackbar('Submitting form via voice command.', { variant: 'info' });
        }
    };

    // Handle recognition results
    recognition.onresult = (event) => {
        const command = event.results[0][0].transcript.toLowerCase();
        handleVoiceCommand(command);
    };

    // Handle recognition errors
    recognition.onerror = (event) => {
        enqueueSnackbar(`Voice recognition error: ${event.error}`, { variant: 'error' });
    };

    const lottieOptions = useMemo(() => ({
        loop: true,
        autoplay: true,
        animationData: animationData,
        rendererSettings: {
            preserveAspectRatio: 'xMidYMid slice',
        },
    }), []);

    return (
        <Container maxWidth="sm">
            <Typography variant="h4" gutterBottom>
                Forgot Password
            </Typography>
            <form onSubmit={handleSubmit(onSubmit)}>
                <TextField
                    label="Email"
                    name="email"
                    inputRef={register({ required: 'Email is required' })}
                    error={!!errors.email}
                    helperText={errors.email ? errors.email.message : ''}
                    fullWidth
                    margin="normal"
                    aria-label="Email"
                />
                <ReCAPTCHA
                    sitekey="YOUR_RECAPTCHA_SITE_KEY"
                    size="invisible"
                    ref={recaptchaRef}
                    aria-label="reCAPTCHA"
                />
                <TwitchButton onClick={handleTwitchAuth} aria-label="Link Twitch Account" />
                <Button type="submit" variant="contained" color="primary" fullWidth disabled={loading} aria-label="Send Reset Link">
                    {loading ? <CircularProgress size={24} /> : 'Send Reset Link'}
                </Button>
            </form>

            {loading && (
                <Lottie
                    options={lottieOptions}
                    height={150}
                    width={150}
                    aria-live="polite"
                />
            )}

            {twitchAccountInfo && (
                <Typography variant="body1" style={{ marginTop: 16 }}>
                    Linked Twitch Account: {twitchAccountInfo.displayName}
                </Typography>
            )}

            {authStatus && (
                <Typography variant="body2" style={{ marginTop: 16 }} aria-live="polite">
                    {authStatus}
                </Typography>
            )}

            {!twitchAccountInfo && (
                <Button onClick={handleRetryAuth} variant="contained" color="secondary" style={{ marginTop: 16 }} aria-label="Retry Twitch Authentication">
                    Retry Twitch Authentication
                </Button>
            )}

            <Suspense fallback={<CircularProgress />}>
                <BiometricAuth />
                <ChatbotAssistant />
            </Suspense>

            <Button onClick={startVoiceRecognition} variant="contained" color="secondary" style={{ marginTop: 16 }} aria-label="Start Voice Recognition">
                Start Voice Recognition
            </Button>

            {countdown && (
                <Typography variant="body2" style={{ marginTop: 16 }} aria-live="polite">
                    {countdown}
                </Typography>
            )}
        </Container>
    );
};

export default ForgotPassword;