import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, Button, TextField, Switch, CircularProgress, Grid, Card, CardContent, List, ListItem, Badge } from '@material-ui/core';
import { Line } from 'react-chartjs-2';
import axios from 'axios';
import useWebSocket from 'react-use-websocket';
import { useSpring, animated } from 'react-spring';
import 'chartjs-plugin-zoom';
import ReactJoyride from 'react-joyride';

const UserDashboard = () => {
    const [metrics, setMetrics] = useState({ campaignsCount: 0, totalRevenue: 0 });
    const [revenueTrends, setRevenueTrends] = useState([]);
    const [realTimeUpdates, setRealTimeUpdates] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [darkMode, setDarkMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [exporting, setExporting] = useState(false);

    const { lastMessage } = useWebSocket('ws://your-websocket-url', {
        onMessage: (message) => {
            setRealTimeUpdates((prev) => [...prev, message.data]);
        },
    });

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const response = await axios.get('/api/user/metrics');
                setMetrics(response.data);
            } catch (err) {
                setError('Failed to fetch metrics');
            }
        };

        const fetchRevenueTrends = async () => {
            try {
                const response = await axios.get('/api/user/revenue-trends');
                setRevenueTrends(response.data);
            } catch (err) {
                setError('Failed to fetch revenue trends');
            }
        };

        fetchMetrics();
        fetchRevenueTrends();
        setLoading(false);
    }, []);

    const handleExport = async (format) => {
        setExporting(true);
        try {
            const response = await axios.get(`/api/user/export-${format}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `user_data.${format}`);
            document.body.appendChild(link);
            link.click();
            setExporting(false);
        } catch (err) {
            setError(`Failed to export data as ${format}`);
            setExporting(false);
        }
    };

    const chartData = useMemo(() => ({
        labels: revenueTrends.map((trend) => trend.date),
        datasets: [
            {
                label: 'Revenue',
                data: revenueTrends.map((trend) => trend.revenue),
                borderColor: 'rgba(75,192,192,1)',
                backgroundColor: 'rgba(75,192,192,0.2)',
                fill: true,
            },
        ],
    }), [revenueTrends]);

    const chartOptions = {
        responsive: true,
        plugins: {
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'xy',
                },
                zoom: {
                    enabled: true,
                    mode: 'xy',
                },
            },
        },
        tooltips: {
            callbacks: {
                label: (tooltipItem, data) => {
                    const revenue = data.datasets[0].data[tooltipItem.index];
                    const previousRevenue = data.datasets[0].data[tooltipItem.index - 1] || revenue;
                    const change = ((revenue - previousRevenue) / previousRevenue) * 100;
                    return `Revenue: $${revenue} (${change.toFixed(2)}%)`;
                },
            },
        },
    };

    const campaignsCountSpring = useSpring({ number: metrics.campaignsCount, from: { number: 0 } });
    const totalRevenueSpring = useSpring({ number: metrics.totalRevenue, from: { number: 0 } });

    if (loading) return <CircularProgress />;
    if (error) return <Typography color="error">{error}</Typography>;

    const steps = [
        {
            target: '.campaigns-count',
            content: 'This shows the total number of campaigns you have.',
        },
        {
            target: '.total-revenue',
            content: 'This displays your total revenue.',
        },
        {
            target: '.real-time-updates',
            content: 'Here you can see real-time updates and notifications.',
        },
        {
            target: '.revenue-trends',
            content: 'This chart shows your revenue trends over time.',
        },
        {
            target: '.filter-button',
            content: 'Use these filters to customize the data you see.',
        },
        {
            target: '.export-buttons',
            content: 'Export your data in various formats using these buttons.',
        },
    ];

    return (
        <Box p={3} bgcolor={darkMode ? 'grey.900' : 'grey.100'} style={{ transition: 'background-color 0.3s, color 0.3s' }}>
            <ReactJoyride steps={steps} continuous showProgress showSkipButton />
            <Typography variant="h4" gutterBottom>User Dashboard</Typography>
            <Switch checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <Card className="campaigns-count" style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.1)', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                        <CardContent>
                            <Typography variant="h6">Campaigns Count</Typography>
                            <animated.div>{campaignsCountSpring.number.to(n => n.toFixed(0))}</animated.div>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Card className="total-revenue" style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.1)', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                        <CardContent>
                            <Typography variant="h6">Total Revenue</Typography>
                            <animated.div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                                ${totalRevenueSpring.number.to(n => n.toFixed(2))}
                            </animated.div>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Card className="real-time-updates" style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.1)', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                        <CardContent>
                            <Typography variant="h6">Real-Time Updates</Typography>
                            <List>
                                {realTimeUpdates.map((update, index) => (
                                    <ListItem key={index}>
                                        <Badge color="primary" badgeContent="info">
                                            <Typography>{update}</Typography>
                                        </Badge>
                                    </ListItem>
                                ))}
                            </List>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12}>
                    <Card className="revenue-trends" style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.1)', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                        <CardContent>
                            <Typography variant="h6">Revenue Trends</Typography>
                            <Line data={chartData} options={chartOptions} />
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                    <TextField
                        label="Start Date"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                    />
                </Grid>
                <Grid item xs={12} md={6}>
                    <TextField
                        label="End Date"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                    />
                </Grid>
                <Grid item xs={12}>
                    <Button
                        className="filter-button"
                        variant="contained"
                        color="primary"
                        onClick={() => { /* Filter action */ }}
                        disabled={!startDate || !endDate || new Date(startDate) > new Date(endDate)}
                    >
                        Filter
                    </Button>
                    <Button variant="contained" onClick={() => { setStartDate(''); setEndDate(''); }}>
                        Reset Filters
                    </Button>
                </Grid>
                <Grid item xs={12} className="export-buttons">
                    <Button variant="contained" onClick={() => handleExport('csv')} disabled={exporting}>
                        {exporting ? <CircularProgress size={24} /> : 'Export CSV'}
                    </Button>
                    <Button variant="contained" onClick={() => handleExport('excel')} disabled={exporting}>
                        {exporting ? <CircularProgress size={24} /> : 'Export Excel'}
                    </Button>
                    <Button variant="contained" onClick={() => handleExport('pdf')} disabled={exporting}>
                        {exporting ? <CircularProgress size={24} /> : 'Export PDF'}
                    </Button>
                </Grid>
            </Grid>
        </Box>
    );
};

export default UserDashboard;
