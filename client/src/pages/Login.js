import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Grid, TextField, Button, Link, CircularProgress, Switch, Typography } from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { useSnackbar } from 'notistack';
import { ErrorBoundary } from 'react-error-boundary';
import axios from 'axios';
import { Google as GoogleIcon, Facebook as FacebookIcon, SportsEsports as TwitchIcon } from '@material-ui/icons';
import { Helmet } from 'react-helmet';
import { useSpring, animated } from 'react-spring';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ReactGA from 'react-ga';

const useStyles = makeStyles((theme) => ({
    root: {
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(to right, #6a11cb, #2575fc)',
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

i18n.use(initReactI18next).init({
    resources: {
        en: {
            translation: {
                Login: 'Login',
                Email: 'Email',
                Password: 'Password',
                'Forgot Password?': 'Forgot Password?',
                'Login with Google': 'Login with Google',
                'Login with Facebook': 'Login with Facebook',
                'Login with Twitch': 'Login with Twitch',
                'Something went wrong.': 'Something went wrong.',
                Retry: 'Retry',
            },
        },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
});

ReactGA.initialize('UA-000000-01');

const Login = () => {
    const classes = useStyles();
    const { register, handleSubmit, formState: { errors } } = useForm();
    const { enqueueSnackbar } = useSnackbar();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        ReactGA.pageview(window.location.pathname + window.location.search);
    }, []);

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const response = await axios.post('/api/auth/login', data);
            enqueueSnackbar(i18n.t('Login successful!'), { variant: 'success' });
            navigate('/dashboard');
        } catch (error) {
            enqueueSnackbar(i18n.t('Invalid credentials or network issue.'), { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const googleLogin = () => {
        // Placeholder for Google login logic
    };

    const facebookLogin = () => {
        // Placeholder for Facebook login logic
    };

    const twitchLogin = () => {
        const clientId = 'your-twitch-client-id';
        const redirectUri = 'http://localhost:3000/auth/twitch/callback';
        const twitchAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
            redirectUri
        )}&response_type=token&scope=user:read:email`;

        window.location.href = twitchAuthUrl;
    };

    const fadeIn = useSpring({ opacity: 1, from: { opacity: 0 } });

    return (
        <ErrorBoundary FallbackComponent={() => (
            <div>
                <Typography variant="h6">{i18n.t('Something went wrong.')}</Typography>
                <Button onClick={() => window.location.reload()}>{i18n.t('Retry')}</Button>
            </div>
        )}>
            <Helmet>
                <title>Login</title>
                <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self';" />
            </Helmet>
            <animated.div style={fadeIn} className={classes.root}>
                <Switch className={classes.darkModeToggle} />
                <Grid container justifyContent="center">
                    <Grid item xs={12} sm={8} md={4}>
                        <div className={classes.formContainer}>
                            <img src="/logo.png" alt="Logo" className={classes.logo} />
                            <Typography variant="h5" gutterBottom>{i18n.t('Login')}</Typography>
                            <form onSubmit={handleSubmit(onSubmit)}>
                                <TextField
                                    label={i18n.t('Email')}
                                    variant="outlined"
                                    fullWidth
                                    className={classes.formField}
                                    {...register('email', { required: i18n.t('Email is required'), pattern: { value: /^\S+@\S+$/i, message: i18n.t('Invalid email address') } })}
                                    error={!!errors.email}
                                    helperText={errors.email?.message}
                                    inputProps={{ 'aria-label': 'email' }}
                                />
                                <TextField
                                    label={i18n.t('Password')}
                                    type={showPassword ? 'text' : 'password'}
                                    variant="outlined"
                                    fullWidth
                                    className={classes.formField}
                                    {...register('password', { required: i18n.t('Password is required'), minLength: { value: 6, message: i18n.t('Password must be at least 6 characters') } })}
                                    error={!!errors.password}
                                    helperText={errors.password?.message}
                                    inputProps={{ 'aria-label': 'password' }}
                                />
                                <Button variant="contained" color="primary" fullWidth type="submit" disabled={loading} aria-label="login">
                                    {loading ? <CircularProgress size={24} /> : i18n.t('Login')}
                                </Button>
                                <Button
                                    variant="contained"
                                    color="secondary"
                                    fullWidth
                                    startIcon={<GoogleIcon />}
                                    onClick={googleLogin}
                                    className={classes.formField}
                                    aria-label="login with google"
                                >
                                    {i18n.t('Login with Google')}
                                </Button>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    fullWidth
                                    startIcon={<FacebookIcon />}
                                    onClick={facebookLogin}
                                    className={classes.formField}
                                    aria-label="login with facebook"
                                >
                                    {i18n.t('Login with Facebook')}
                                </Button>
                                <Button
                                    variant="contained"
                                    style={{ backgroundColor: '#9146FF', color: 'white' }}
                                    fullWidth
                                    startIcon={<TwitchIcon />}
                                    onClick={twitchLogin}
                                    className={classes.formField}
                                    aria-label="login with twitch"
                                >
                                    {i18n.t('Login with Twitch')}
                                </Button>
                                <Link href="/forgot-password" variant="body2" className={classes.formField} aria-label="forgot password">{i18n.t('Forgot Password?')}</Link>
                            </form>
                        </div>
                    </Grid>
                </Grid>
            </animated.div>
        </ErrorBoundary>
    );
};

export default Login;