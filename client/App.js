import React, { useState, useMemo, useReducer, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { createTheme, ThemeProvider, CssBaseline, Grid, Box } from '@material-ui/core';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { GlobalContext, globalReducer, initialState } from './GlobalContext';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import NotificationBar from './components/NotificationBar';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { establishWebSocketConnection } from './websocket';
import analytics from './analytics';

const Home = lazy(() => import('./pages/Home'));
const LiveMetrics = lazy(() => import('./pages/LiveMetrics'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

const App = () => {
    const [state, dispatch] = useReducer(globalReducer, initialState);
    const { t } = useTranslation();

    const theme = useMemo(() => createTheme({
        palette: {
            type: state.darkMode ? 'dark' : 'light',
        },
    }), [state.darkMode]);

    useEffect(() => {
        establishWebSocketConnection(dispatch);
        analytics.init();
    }, []);

    return (
        <GlobalContext.Provider value={{ state, dispatch }}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Router>
                    <ErrorBoundary>
                        <Grid container>
                            <Grid item xs={12}>
                                <Header />
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <Sidebar />
                            </Grid>
                            <Grid item xs={12} sm={9}>
                                <Box p={2}>
                                    <Suspense fallback={<div>{t('loading')}</div>}>
                                        <Switch>
                                            <Route path="/login" component={Login} />
                                            <ProtectedRoute path="/live-metrics" component={LiveMetrics} />
                                            <ProtectedRoute path="/settings" component={Settings} />
                                            <ProtectedRoute path="/" exact component={Home} />
                                            <Redirect to="/" />
                                        </Switch>
                                    </Suspense>
                                </Box>
                            </Grid>
                        </Grid>
                        <NotificationBar />
                    </ErrorBoundary>
                </Router>
            </ThemeProvider>
        </GlobalContext.Provider>
    );
};

const eventHandlers = {
    COLLABORATION_UPDATE: (data) => dispatch({
        type: 'ADD_NOTIFICATION',
        payload: {
            message: data.message,
            type: 'info',
            priority: 'high',
            category: 'collaboration',
            link: data.link || null,
            timestamp: new Date(),
        },
    }),
    NEW_MESSAGE: (data) => dispatch({
        type: 'ADD_NOTIFICATION',
        payload: {
            message: data.message,
            type: 'info',
            priority: 'medium',
            category: 'user',
            link: data.link || null,
            timestamp: new Date(),
        },
    }),
    SYSTEM_ALERT: (data) => dispatch({
        type: 'ADD_NOTIFICATION',
        payload: {
            message: data.message,
            type: 'error',
            priority: 'high',
            category: 'system',
            link: data.link || null,
            timestamp: new Date(),
        },
    }),
};

useEffect(() => {
    establishWebSocketConnection((event) => {
        if (eventHandlers[event.type]) {
            eventHandlers[event.type](event.data);
        } else {
            console.warn('Unhandled WebSocket event:', event.type);
        }
    });
}, []);

const apiErrorHandler = (err, context) => {
    logError(err, { context });
    dispatch({
        type: 'ADD_NOTIFICATION',
        payload: { message: `Failed: ${context}`, type: 'error', priority: 'high', timestamp: new Date() },
    });
};

useEffect(() => {
    async function fetchPredictions() {
        try {
            const response = await axios.get('/api/predictive-analytics');
            dispatch({ type: 'SET_PREDICTIVE_INSIGHTS', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'fetchPredictions');
        }
    }
    fetchPredictions();
}, []);

useEffect(() => {
    async function validateMetrics() {
        try {
            const response = await axios.post('/api/validate-metrics', { metrics: state.metrics });
            dispatch({
                type: 'ADD_NOTIFICATION',
                payload: {
                    message: `Metrics validated: ${response.data.status}`,
                    type: response.data.valid ? 'success' : 'error',
                    priority: 'medium',
                    link: '/live-metrics',
                    timestamp: new Date(),
                },
            });
            dispatch({ type: 'SET_VALIDATION_STATUS', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'validateMetrics');
        }
    }
    validateMetrics();
}, [state.metrics]);

useEffect(() => {
    async function fetchBranding() {
        setLoading(true);
        try {
            const response = await axios.get('/api/branding');
            dispatch({ type: 'SET_BRANDING', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'fetchBranding');
        } finally {
            setLoading(false);
        }
    }
    fetchBranding();
}, []);

useEffect(() => {
    async function fetchExternalMetrics() {
        try {
            const response = await axios.get('/api/external-metrics');
            dispatch({ type: 'SET_EXTERNAL_METRICS', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'fetchExternalMetrics');
        }
    }
    fetchExternalMetrics();
}, []);

useEffect(() => {
    async function fetchTenantConfig() {
        try {
            const response = await axios.get('/api/tenant-config');
            dispatch({ type: 'SET_TENANT_CONFIG', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'fetchTenantConfig');
        }
    }
    fetchTenantConfig();
}, []);

useEffect(() => {
    async function fetchRecommendations() {
        try {
            const response = await axios.get('/api/ai-recommendations');
            dispatch({ type: 'SET_RECOMMENDATIONS', payload: response.data });
        } catch (err) {
            apiErrorHandler(err, 'fetchRecommendations');
        }
    }
    fetchRecommendations();
}, []);

useEffect(() => {
    const unlisten = history.listen((location) => {
        analytics.trackPageView(location.pathname);
    });
    return () => unlisten();
}, [history]);

useEffect(() => {
    window.addEventListener('offline', () => {
        dispatch({ type: 'SET_OFFLINE_MODE', payload: true });
    });
    window.addEventListener('online', () => {
        dispatch({ type: 'SET_OFFLINE_MODE', payload: false });
    });
}, []);
const groupedNotifications = state.notifications.reduce((groups, notification) => {
    const { category } = notification;
    if (!groups[category]) groups[category] = [];
    groups[category].push(notification);
    return groups;
}, {});

const [loading, setLoading] = useState(false);

async function fetchData() {
    setLoading(true);
    try {
        const response = await axios.get('/api/data');
        dispatch({ type: 'SET_DATA', payload: response.data });
    } catch (err) {
        apiErrorHandler(err, 'fetchData');
    } finally {
        setLoading(false);
    }
}

const establishWebSocketConnection = (dispatch) => {
    let socket = new WebSocket('wss://example.com/ws');
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (eventHandlers[data.type]) {
            eventHandlers[data.type](data);
        } else {
            console.warn('Unhandled WebSocket event:', data.type);
        }
    };
    socket.onclose = () => {
        setTimeout(() => establishWebSocketConnection(dispatch), 5000); // Retry every 5 seconds
    };
};

const ProtectedRoute = ({ component: Component, roles, ...rest }) => (
    <Route
        {...rest}
        render={(props) =>
            state.user && roles.includes(state.user.role) ? (
                <Component {...props} />
            ) : (
                <Redirect to="/login" />
            )
        }
    />
);

return (
    <GlobalContext.Provider value={{ state, dispatch }}>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Router>
                <ErrorBoundary>
                    <Grid container>
                        <Grid item xs={12}>
                            <Header />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <Sidebar />
                        </Grid>
                        <Grid item xs={12} sm={9}>
                            <Box p={2}>
                                {loading && <CircularProgress />}
                                <Suspense fallback={<div>{t('loading')}</div>}>
                                    <Switch>
                                        <Route path="/login" component={Login} />
                                        <ProtectedRoute path="/live-metrics" component={LiveMetrics} />
                                        <ProtectedRoute path="/settings" component={Settings} />
                                        <ProtectedRoute path="/" exact component={Home} />
                                        <ProtectedRoute path="/admin" component={AdminDashboard} roles={['admin']} />
                                        <Redirect to="/" />
                                    </Switch>
                                </Suspense>
                            </Box>
                        </Grid>
                    </Grid>
                    <NotificationBar>
                        {Object.entries(groupedNotifications).map(([category, notifications]) => (
                            <div key={category}>
                                <h3>{category}</h3>
                                {notifications.map((note) => <NotificationItem key={note.timestamp} {...note} />)}
                            </div>
                        ))}
                    </NotificationBar>
                </ErrorBoundary>
            </Router>
        </ThemeProvider>
    </GlobalContext.Provider>
);
