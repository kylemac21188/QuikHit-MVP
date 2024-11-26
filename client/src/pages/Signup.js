import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Grid, TextField, Button, CircularProgress, Typography, Switch, Link } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useSnackbar } from 'notistack';
import { Google as GoogleIcon, Facebook as FacebookIcon, SportsEsports as TwitchIcon } from '@material-ui/icons';
import { ErrorBoundary } from 'react-error-boundary';
import { Helmet } from 'react-helmet';
import { useSpring, animated } from 'react-spring';
import axios from 'axios';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ReactGA from 'react-ga';
import { useEffect } from 'react';

// Import necessary libraries and components

// Initialize Google Analytics
ReactGA.initialize('UA-000000-01');

// Set up i18n for translations
i18n.use(initReactI18next).init({
    resources: {
        en: {
            translation: {
                Signup: "Signup",
                Email: "Email",
                Password: "Password",
                "Confirm Password": "Confirm Password",
                "Already have an account? Login": "Already have an account? Login",
                "Signup with Google": "Signup with Google",
                "Signup with Facebook": "Signup with Facebook",
                "Signup with Twitch": "Signup with Twitch",
                "Something went wrong.": "Something went wrong.",
                Retry: "Retry",
            },
        },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
});

// Define Material-UI styles
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


const ErrorFallback = ({ error, resetErrorBoundary }) => {
    return (
        <div role="alert">
            <p>{i18n.t('Something went wrong.')}</p>
            <pre>{error.message}</pre>
            <Button onClick={resetErrorBoundary}>{i18n.t('Retry')}</Button>
        </div>
    );
};

const SignupPage = () => {
    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Signup />
        </ErrorBoundary>
    );
};

export default SignupPage;

// Enhanced Validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordStrengthRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

const Signup = () => {
    const classes = useStyles();
    const { register, handleSubmit, watch, formState: { errors } } = useForm();
    const navigate = useNavigate();
    const { enqueueSnackbar } = useSnackbar();
    const [loading, setLoading] = useState(false);
    const [darkMode, setDarkMode] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState('');

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            await axios.post('/api/signup', data);
            enqueueSnackbar('Signup successful', { variant: 'success' });
            navigate('/login');
        } catch (error) {
            enqueueSnackbar(i18n.t('Something went wrong.'), { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const password = watch('password');
        if (password) {
            setPasswordStrength(passwordStrengthRegex.test(password) ? 'Strong' : 'Weak');
        }
    }, [watch('password')]);

    const formAnimation = useSpring({ opacity: 1, from: { opacity: 0 } });
    const buttonAnimation = useSpring({ transform: 'scale(1)', from: { transform: 'scale(0.9)' } });

    return (
        <animated.div style={formAnimation} className={classes.root}>
            <Helmet>
                <title>{i18n.t('Signup')}</title>
            </Helmet>
            <Switch
                checked={darkMode}
                onChange={() => setDarkMode(!darkMode)}
                className={classes.darkModeToggle}
            />
            <Grid container justify="center">
                <Grid item xs={12} sm={8} md={6} lg={4}>
                    <div className={classes.formContainer}>
                        <Typography variant="h4" className={classes.logo}>
                            {i18n.t('Signup')}
                        </Typography>
                        <form onSubmit={handleSubmit(onSubmit)}>
                            <TextField
                                label={i18n.t('Email')}
                                variant="outlined"
                                fullWidth
                                className={classes.formField}
                                {...register('email', { required: true, pattern: emailRegex })}
                                error={!!errors.email}
                                helperText={errors.email ? 'Invalid email address' : ''}
                                aria-invalid={!!errors.email}
                            />
                            <TextField
                                label={i18n.t('Password')}
                                type="password"
                                variant="outlined"
                                fullWidth
                                className={classes.formField}
                                {...register('password', { required: true })}
                                error={!!errors.password}
                                helperText={errors.password ? 'Password is required' : passwordStrength}
                                aria-invalid={!!errors.password}
                            />
                            <TextField
                                label={i18n.t('Confirm Password')}
                                type="password"
                                variant="outlined"
                                fullWidth
                                className={classes.formField}
                                {...register('confirmPassword', {
                                    required: true,
                                    validate: (value) => value === watch('password') || 'Passwords do not match',
                                })}
                                error={!!errors.confirmPassword}
                                helperText={errors.confirmPassword && 'Passwords do not match'}
                                aria-invalid={!!errors.confirmPassword}
                            />
                            <animated.div style={buttonAnimation}>
                                <Button
                                    type="submit"
                                    variant="contained"
                                    color="primary"
                                    fullWidth
                                    disabled={loading}
                                >
                                    {loading ? <CircularProgress size={24} /> : i18n.t('Signup')}
                                </Button>
                            </animated.div>
                        </form>
                        <Typography variant="body2" style={{ marginTop: 16 }}>
                            {i18n.t('Already have an account?')} <Link href="/login">{i18n.t('Login')}</Link>
                        </Typography>
                        <Button
                            variant="contained"
                            color="default"
                            startIcon={<GoogleIcon />}
                            fullWidth
                            style={{ marginTop: 16, backgroundColor: '#DB4437', color: '#fff' }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#C33D2E'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#DB4437'}
                        >
                            {i18n.t('Signup with Google')}
                        </Button>
                        <Button
                            variant="contained"
                            color="default"
                            startIcon={<FacebookIcon />}
                            fullWidth
                            style={{ marginTop: 16, backgroundColor: '#4267B2', color: '#fff' }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#365899'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#4267B2'}
                        >
                            {i18n.t('Signup with Facebook')}
                        </Button>
                        <Button
                            variant="contained"
                            color="default"
                            startIcon={<TwitchIcon />}
                            fullWidth
                            style={{ marginTop: 16, backgroundColor: '#6441A4', color: '#fff' }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#4B367C'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#6441A4'}
                        >
                            {i18n.t('Signup with Twitch')}
                        </Button>
                    </div>
                </Grid>
            </Grid>
        </animated.div>
    );
};