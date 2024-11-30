import React, { useState, useEffect, useContext, lazy, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { makeStyles } from '@material-ui/core/styles';
import { useSnackbar } from 'notistack';
import { ErrorBoundary } from 'react-error-boundary';
import { Helmet } from 'react-helmet';
import { useSpring, animated } from 'react-spring';
import { useSpeechRecognition } from 'react-speech-recognition';
import i18n from '../i18n';
import ReactGA from 'react-ga';
import { AuthContext } from '../context/AuthContext';
import WebSocketManager from '../utils/WebSocketManager';
import TwitchOAuth from '../utils/TwitchOAuth';
import cryptoUtil from '../utils/cryptoUtil';
import sendOtpEmail from '../utils/sendOtpEmail';
import fetchLoginStreak from '../utils/fetchLoginStreak';
import rateLimitExceeded from '../utils/rateLimitExceeded';
import SocialLoginButton from '../components/SocialLoginButton';
import { handleError, handleSuccessfulLogin } from '../utils/authUtils';
import ErrorFallback from '../components/ErrorFallback';
import useThemeContext from '../hooks/useThemeContext';
import useSocialLogin from '../hooks/useSocialLogin';
import useWebSocket from '../hooks/useWebSocket';
import { handleVoiceCommand } from '../utils/voiceCommandUtils';

import { Grid, TextField, Button, Link, CircularProgress, Switch, Typography, Tooltip, Checkbox, FormControlLabel } from '@material-ui/core';
import { Google as GoogleIcon, Facebook as FacebookIcon, SportsEsports as TwitchIcon, Visibility, VisibilityOff } from '@material-ui/icons';

const ReCAPTCHA = lazy(() => import('react-google-recaptcha'));
const Sentry = lazy(() => import('@sentry/react'));

const useStyles = makeStyles((theme) => ({
root: {
    height: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: theme.palette.type === 'dark' ? '#333' : 'linear-gradient(to right, #6a11cb, #2575fc)',
},
formContainer: {
    padding: theme.spacing(4),
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[5],
    textAlign: 'center',
    animation: 'fadeIn 1s ease-in-out',
},
formField: {
    marginBottom: theme.spacing(2),
},
logo: {
    marginBottom: theme.spacing(2),
},
darkModeToggle: {
    position: 'absolute',
    top: theme.spacing(2),
    right: theme.spacing(2),
},
}));

ReactGA.initialize(process.env.REACT_APP_GA_TRACKING_ID);

const Login = () => {
const classes = useStyles();
const { register, handleSubmit, formState: { errors }, getValues } = useForm();
const { enqueueSnackbar } = useSnackbar();
const navigate = useNavigate();
const { setAuthState } = useContext(AuthContext);
const { highContrast, setHighContrast } = useContext(useThemeContext);
const { transcript, resetTranscript } = useSpeechRecognition();
const {
    handleGoogleLogin, handleFacebookLogin, handleTwitchLogin, loadingGoogle, loadingFacebook, loadingTwitch,
} = useSocialLogin({
    setLoadingGoogle, setLoadingFacebook, setLoadingTwitch, setAuthState, enqueueSnackbar, navigate,
});
const [loading, setLoading] = useState(false);
const [showPassword, setShowPassword] = useState(false);
const [otpSent, setOtpSent] = useState(false);
const [otp, setOtp] = useState('');
const [loginStreak, setLoginStreak] = useState(0);
const [rememberMe, setRememberMe] = useState(false);
const [loginAttempts, setLoginAttempts] = useState(0);
const [rateLimited, setRateLimited] = useState(false);
const [passwordStrength, setPasswordStrength] = useState('');

const fadeIn = useSpring({ opacity: 1, from: { opacity: 0 } });

useEffect(() => {
    ReactGA.pageview(window.location.pathname + window.location.search);
    fetchLoginStreak().then(setLoginStreak);
    const storedHighContrast = localStorage.getItem('highContrast') === 'true';
    setHighContrast(storedHighContrast);
}, []);

useWebSocket();  // Hook for handling WebSocket connections for real-time updates

const onSubmit = async (data) => {
    setLoading(true);
    setLoginAttempts((prev) => prev + 1);
    try {
        const encryptedData = cryptoUtil.encrypt(data);
        const response = await axios.post('/api/auth/login', encryptedData);
        if (rateLimitExceeded(response.data.user)) {
            enqueueSnackbar('Rate limit exceeded. Please try again later.', { variant: 'warning' });
            setRateLimited(true);
            return;
        }
        await sendOtpEmail(response.data.user.email);
        setOtpSent(true);
        if (rememberMe) {
            localStorage.setItem('authState', JSON.stringify(response.data));
        }
    } catch (error) {
        handleError(error, 'Invalid credentials or network issue.', enqueueSnackbar);
    } finally {
        setLoading(false);
    }
};

const handleVoiceCommandExecution = () => {
    if (transcript) {
        handleVoiceCommand(transcript, {
            handleSubmit,
            onSubmit,
            resetTranscript,
            setShowPassword,
            enqueueSnackbar,
        });
        const feedback = {
            'login initiated': 'Login initiated',
            'resetting input': 'Resetting input',
            'password is now hidden': 'Password is now hidden',
        };
        const command = transcript.toLowerCase();
        if (feedback[command]) {
            const utterance = new SpeechSynthesisUtterance(feedback[command]);
            window.speechSynthesis.speak(utterance);
        }
    }
};

useEffect(handleVoiceCommandExecution, [transcript]);

const handlePasswordChange = (event) => {
    const password = event.target.value;
    if (password.length < 6) {
        setPasswordStrength('Weak');
    } else if (password.length < 10) {
        setPasswordStrength('Medium');
    } else {
        setPasswordStrength('Strong');
    }
};

const handleDarkModeToggle = () => {
    setHighContrast(!highContrast);
    localStorage.setItem('highContrast', !highContrast);
};

return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
        <Helmet>
            <title>Login</title>
            <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self';" />
        </Helmet>
        <animated.div style={fadeIn} className={classes.root}>
            <Switch className={classes.darkModeToggle} checked={highContrast} onChange={handleDarkModeToggle} />
            <Grid container justifyContent="center">
                <Grid item xs={12} sm={8} md={4}>
                    <div className={classes.formContainer}>
                        <img src="/logo.png" alt="Logo" className={classes.logo} />
                        <Typography variant="h5" gutterBottom>{i18n.t('Login')}</Typography>
                        <form onSubmit={handleSubmit(onSubmit)} role="form">
                            <TextField
                                label={i18n.t('Email')}
                                variant="outlined"
                                fullWidth
                                className={classes.formField}
                                {...register('email', { required: i18n.t('Email is required'), pattern: { value: /^\S+@\S+$/i, message: i18n.t('Invalid email address') } })}
                                error={!!errors.email}
                                helperText={errors.email?.message}
                                aria-label="Email"
                                autoFocus
                            />
                            <TextField
                                label={i18n.t('Password')}
                                type={showPassword ? 'text' : 'password'}
                                variant="outlined"
                                fullWidth
                                className={classes.formField}
                                {...register('password', {
                                    required: i18n.t('Password is required'),
                                    minLength: { value: 6, message: i18n.t('Password must be at least 6 characters') },
                                    pattern: { value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/, message: i18n.t('Password must contain uppercase, lowercase, number, and special character') },
                                })}
                                error={!!errors.password}
                                helperText={errors.password?.message}
                                aria-label="Password"
                                onChange={handlePasswordChange}
                                InputProps={{
                                    endAdornment: (
                                        <Tooltip title={showPassword ? 'Hide password' : 'Show password'}>
                                            <Button onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </Button>
                                        </Tooltip>
                                    ),
                                }}
                            />
                            <Typography variant="body2" className={classes.formField}>
                                {i18n.t(`Password strength: ${passwordStrength}`)}
                            </Typography>
                            <FormControlLabel
                                control={<Checkbox checked={rememberMe} onChange={() => setRememberMe(!rememberMe)} />}
                                label={i18n.t('Remember Me')}
                            />
                            <Suspense fallback={<CircularProgress />}>
                                <ReCAPTCHA sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY} />
                            </Suspense>
                            <Button variant="contained" color="primary" fullWidth type="submit" disabled={loading || rateLimited} aria-label="Login">
                                {loading ? <CircularProgress size={24} /> : i18n.t('Login')}
                            </Button>
                            <SocialLoginButton
                                platform="google"
                                handleSocialLogin={handleGoogleLogin}
                                icon={<GoogleIcon />}
                                label={i18n.t('Login with Google')}
                                className={classes.formField}
                                loading={loadingGoogle}
                            />
                            <SocialLoginButton
                                platform="facebook"
                                handleSocialLogin={handleFacebookLogin}
                                icon={<FacebookIcon />}
                                label={i18n.t('Login with Facebook')}
                                className={classes.formField}
                                loading={loadingFacebook}
                            />
                            <SocialLoginButton
                                platform="twitch"
                                handleSocialLogin={handleTwitchLogin}
                                icon={<TwitchIcon />}
                                label={i18n.t('Login with Twitch')}
                                className={classes.formField}
                                loading={loadingTwitch}
                            />
                            <Button variant="contained" color="default" fullWidth onClick={() => handleMagicLinkLogin(getValues('email'))} className={classes.formField} aria-label="Login with Magic Link">
                                {i18n.t('Login with Magic Link')}
                            </Button>
                        </form>
                        <Typography variant="body2" className={classes.formField}>
                            {`Current login streak: ${loginStreak} days`}
                        </Typography>
                        <Typography variant="body2" className={classes.formField}>
                            {`Login attempts: ${loginAttempts}`}
                        </Typography>
                        {rateLimited && (
                            <Typography variant="body2" color="error" className={classes.formField}>
                                {i18n.t('You have been rate-limited. Please try again later.')}
                            </Typography>
                        )}
                    </div>
                </Grid>
            </Grid>
        </animated.div>
    </ErrorBoundary>
);
};

export default Login;