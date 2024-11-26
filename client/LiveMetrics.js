import React, { useState, useMemo, lazy, Suspense, useCallback } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { Line, Pie } from 'react-chartjs-2';
import { useTheme, ThemeProvider } from '@material-ui/core/styles';
import { CircularProgress, Select, MenuItem, Button, Typography, Grid, Box } from '@material-ui/core';
import ProgressBar from './ProgressBar';
import NotificationBar from './NotificationBar';
import { useTranslation } from 'react-i18next';
import useWebSocket from './useWebSocket';
import { useLocalStorage } from './useLocalStorage';
import { logError } from './errorLogger';
import { useThemeSwitcher } from './useThemeSwitcher';

const ARCanvas = lazy(() => import('@react-three/fiber').then((mod) => ({ default: mod.ARCanvas })));

const LiveMetrics = () => {
    const [metrics, setMetrics] = useState({
        impressions: [],
        clicks: [],
        engagement: { likes: 0, shares: 0, comments: 0 },
        ctr: 0,
        conversionRate: 0,
        anomalies: [],
        recommendations: [],
    });
    const [timeRange, setTimeRange] = useState('lastHour');
    const [audienceSegment, setAudienceSegment] = useState('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedWidgets, setSelectedWidgets] = useLocalStorage('selectedWidgets', ['lineChart', 'pieChart']);
    const [isARActive, setIsARActive] = useState(false);
    const theme = useTheme();
    const { t } = useTranslation();
    const { toggleTheme } = useThemeSwitcher();

    // Toggle AR View
    const toggleAR = useCallback(() => {
        setIsARActive((prev) => !prev);
    }, []);

    // Memoized Line Chart Data
    const lineChartData = useMemo(() => ({
        labels: metrics.impressions.map((_, index) => index),
        datasets: [
            { label: 'Impressions', data: metrics.impressions, borderColor: theme.palette.primary.main, fill: false },
            { label: 'Clicks', data: metrics.clicks, borderColor: theme.palette.secondary.main, fill: false },
        ],
    }), [metrics.impressions, metrics.clicks, theme.palette.primary.main, theme.palette.secondary.main]);

    // Memoized Pie Chart Data
    const pieChartData = useMemo(() => ({
        labels: ['Likes', 'Shares', 'Comments'],
        datasets: [
            {
                data: [metrics.engagement.likes, metrics.engagement.shares, metrics.engagement.comments],
                backgroundColor: [theme.palette.primary.main, theme.palette.secondary.main, theme.palette.error.main],
            },
        ],
    }), [metrics.engagement, theme.palette.primary.main, theme.palette.secondary.main, theme.palette.error.main]);

    // Fetch Metrics
    const fetchMetrics = useCallback(async () => {
        try {
            const response = await axios.get('/api/live-metrics', { params: { timeRange, audienceSegment } });
            setMetrics((prevMetrics) => ({ ...prevMetrics, ...response.data }));
        } catch (err) {
            setError(err);
            logError(err);
        } finally {
            setLoading(false);
        }
    }, [timeRange, audienceSegment]);

    useWebSocket('/api/live-metrics', setMetrics, fetchMetrics);

    // Export Metrics Utility
    const exportMetrics = useCallback(async (format) => {
        const formatHandlers = {
            csv: () => {
                const csvContent = `data:text/csv;charset=utf-8,${Object.entries(metrics)
                    .map(([key, value]) => `${key},${JSON.stringify(value)}`)
                    .join('\n')}`;
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement('a');
                link.setAttribute('href', encodedUri);
                link.setAttribute('download', 'metrics.csv');
                link.click();
            },
            pdf: async () => {
                const { default: jsPDF } = await import('jspdf');
                const doc = new jsPDF();
                doc.text('Metrics Report', 10, 10);
                Object.entries(metrics).forEach(([key, value], index) => {
                    doc.text(`${key}: ${JSON.stringify(value)}`, 10, 20 + index * 10);
                });
                doc.save('metrics.pdf');
            },
            excel: async () => {
                const { default: XLSX } = await import('xlsx');
                const ws = XLSX.utils.json_to_sheet(metrics);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Metrics');
                XLSX.writeFile(wb, 'metrics.xlsx');
            },
        };

        if (formatHandlers[format]) {
            await formatHandlers[format]();
        } else {
            console.error('Unsupported export format:', format);
        }
    }, [metrics]);

    // Error and Loading State
    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <Typography color="error" variant="h6">{t('Error loading metrics')}: {error.message}</Typography>
            </Box>
        );
    }

    return (
        <ThemeProvider theme={theme}>
            <Box padding={3}>
                <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                        <Select
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value)}
                            aria-label={t('Time Range')}
                        >
                            <MenuItem value="lastHour">{t('Last Hour')}</MenuItem>
                            <MenuItem value="lastDay">{t('Last Day')}</MenuItem>
                            <MenuItem value="lastWeek">{t('Last Week')}</MenuItem>
                        </Select>
                        <Select
                            value={audienceSegment}
                            onChange={(e) => setAudienceSegment(e.target.value)}
                            aria-label={t('Audience Segment')}
                        >
                            <MenuItem value="all">{t('All')}</MenuItem>
                            <MenuItem value="segment1">{t('Segment 1')}</MenuItem>
                            <MenuItem value="segment2">{t('Segment 2')}</MenuItem>
                        </Select>
                        <Button onClick={toggleAR}>{isARActive ? t('Disable AR View') : t('Enable AR View')}</Button>
                        <Button onClick={() => exportMetrics('csv')}>{t('Export as CSV')}</Button>
                        <Button onClick={() => exportMetrics('pdf')}>{t('Export as PDF')}</Button>
                        <Button onClick={() => exportMetrics('excel')}>{t('Export as Excel')}</Button>
                        <Button onClick={toggleTheme}>{t('Toggle Theme')}</Button>
                    </Grid>
                    <Grid item xs={12} md={6}>
                        {selectedWidgets.includes('lineChart') && <Line data={lineChartData} />}
                        {selectedWidgets.includes('pieChart') && <Pie data={pieChartData} />}
                    </Grid>
                </Grid>
                <ProgressBar value={metrics.ctr} label={t('CTR')} />
                <ProgressBar value={metrics.conversionRate} label={t('Conversion Rate')} />
                <NotificationBar message={metrics.ctr > 0.05 ? t('CTR exceeded threshold!') : t('CTR within limits.')} />
                {metrics.recommendations.length > 0 && (
                    <Box marginTop={2}>
                        <Typography variant="h6">{t('AI Recommendations')}</Typography>
                        {metrics.recommendations.map((rec, idx) => (
                            <Typography key={`rec-${idx}`}>{rec}</Typography>
                        ))}
                    </Box>
                )}
                {isARActive && (
                    <Suspense fallback={<CircularProgress />}>
                        <ARCanvas>
                            <ambientLight />
                            <mesh>
                                <sphereGeometry args={[1, 32, 32]} />
                                <meshStandardMaterial color="green" />
                            </mesh>
                        </ARCanvas>
                    </Suspense>
                )}
            </Box>
        </ThemeProvider>
    );
};

ProgressBar.propTypes = {
    value: PropTypes.number.isRequired,
    label: PropTypes.string.isRequired,
};

NotificationBar.propTypes = {
    message: PropTypes.string.isRequired,
};

export default LiveMetrics;

// Integrate machine learning models for predictive analytics
const fetchPredictiveAnalytics = useCallback(async () => {
    try {
        const response = await axios.get('/api/predictive-analytics', { params: { timeRange, audienceSegment } });
        setMetrics((prevMetrics) => ({ ...prevMetrics, predictive: response.data }));
    } catch (err) {
        setError(err);
        logError(err);
    }
}, [timeRange, audienceSegment]);

useEffect(() => {
    fetchPredictiveAnalytics();
}, [fetchPredictiveAnalytics]);

// Use AI to provide actionable recommendations
const fetchAIRecommendations = useCallback(async () => {
    try {
        const response = await axios.get('/api/ai-recommendations', { params: { timeRange, audienceSegment } });
        setMetrics((prevMetrics) => ({ ...prevMetrics, recommendations: response.data }));
    } catch (err) {
        setError(err);
        logError(err);
    }
}, [timeRange, audienceSegment]);

useEffect(() => {
    fetchAIRecommendations();
}, [fetchAIRecommendations]);

// Personalized User Experience
const [userPreferences, setUserPreferences] = useLocalStorage('userPreferences', { role: 'analyst', widgets: ['lineChart', 'pieChart'] });

useEffect(() => {
    setSelectedWidgets(userPreferences.widgets);
}, [userPreferences.widgets]);

// Real-Time Collaboration
const [comments, setComments] = useState([]);
const fetchComments = useCallback(async () => {
    try {
        const response = await axios.get('/api/comments');
        setComments(response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
}, []);

useEffect(() => {
    fetchComments();
}, [fetchComments]);

const addComment = async (comment) => {
    try {
        await axios.post('/api/comments', { comment });
        fetchComments();
    } catch (err) {
        setError(err);
        logError(err);
    }
};

// Gamification and Interactive Metrics
const [leaderboard, setLeaderboard] = useState([]);
const fetchLeaderboard = useCallback(async () => {
    try {
        const response = await axios.get('/api/leaderboard');
        setLeaderboard(response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
}, []);

useEffect(() => {
    fetchLeaderboard();
}, [fetchLeaderboard]);

// Augmented Reality (AR) Integration
const renderARHeatmap = () => {
    // Placeholder function to render AR heatmap
};

// Blockchain-Based Metrics Validation
const validateMetricsWithBlockchain = async () => {
    try {
        const response = await axios.post('/api/validate-metrics', { metrics });
        console.log('Metrics validated:', response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
};

useEffect(() => {
    validateMetricsWithBlockchain();
}, [metrics]);

// Multi-Tenancy and Custom Branding
const [branding, setBranding] = useState({ logo: '', theme: 'light' });
const fetchBranding = useCallback(async () => {
    try {
        const response = await axios.get('/api/branding');
        setBranding(response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
}, []);

useEffect(() => {
    fetchBranding();
}, [fetchBranding]);

// Global Scalability with Real-Time Performance
const [globalMetrics, setGlobalMetrics] = useState([]);
const fetchGlobalMetrics = useCallback(async () => {
    try {
        const response = await axios.get('/api/global-metrics');
        setGlobalMetrics(response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
}, []);

useEffect(() => {
    fetchGlobalMetrics();
}, [fetchGlobalMetrics]);

// Multi-Platform Integration
const fetchExternalMetrics = useCallback(async () => {
    try {
        const response = await axios.get('/api/external-metrics');
        setMetrics((prevMetrics) => ({ ...prevMetrics, external: response.data }));
    } catch (err) {
        setError(err);
        logError(err);
    }
}, []);

useEffect(() => {
    fetchExternalMetrics();
}, [fetchExternalMetrics]);

// Interactive Storytelling with Data
const createInteractiveReport = async () => {
    try {
        const response = await axios.post('/api/create-report', { metrics });
        console.log('Report created:', response.data);
    } catch (err) {
        setError(err);
        logError(err);
    }
};