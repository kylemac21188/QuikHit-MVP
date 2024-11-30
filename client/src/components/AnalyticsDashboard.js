import React, { useEffect, useState } from 'react';
import { Bar, Line, Pie } from 'react-chartjs-2';
import { Grid, Button, MenuItem, Select, Typography, CircularProgress, TextField, InputLabel, FormControl } from '@mui/material';
import { io } from 'socket.io-client';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import jsPDF from 'jspdf';
import { Parser } from 'json2csv';
import { createContext, useContext, useReducer } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const initialState = {
    data: {},
    insights: [],
    personalizedInsights: [],
    filter: 'all',
    loading: false,
    error: null,
};

const AnalyticsContext = createContext(initialState);

const analyticsReducer = (state, action) => {
    switch (action.type) {
        case 'SET_DATA':
            return { ...state, data: action.payload };
        case 'SET_INSIGHTS':
            return { ...state, insights: action.payload };
        case 'SET_PERSONALIZED_INSIGHTS':
            return { ...state, personalizedInsights: action.payload };
        case 'SET_FILTER':
            return { ...state, filter: action.payload };
        case 'SET_LOADING':
            return { ...state, loading: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        default:
            return state;
    }
};

export const AnalyticsProvider = ({ children }) => {
    const [state, dispatch] = useReducer(analyticsReducer, initialState);

    return (
        <AnalyticsContext.Provider value={{ state, dispatch }}>
            {children}
        </AnalyticsContext.Provider>
    );
};

export const useAnalytics = () => useContext(AnalyticsContext);

const AnalyticsDashboard = () => {
    const { state, dispatch } = useAnalytics();
    const { data, insights, personalizedInsights, filter, loading, error } = state;
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [selectedMetrics, setSelectedMetrics] = useState([]);
    const [chartType, setChartType] = useState('bar');
    const socket = io('http://localhost:4000');

    useEffect(() => {
        fetchData();
        fetchInsights();
        fetchPersonalizedInsights();

        socket.on('newData', (newData) => {
            dispatch({ type: 'SET_DATA', payload: newData });
            toast('New data received!', { type: 'info' });
        });

        return () => {
            socket.disconnect();
        };
    }, [filter, startDate, endDate, selectedMetrics]);

    const fetchData = async () => {
        dispatch({ type: 'SET_LOADING', payload: true });
        dispatch({ type: 'SET_ERROR', payload: null });
        try {
            const response = await fetch('/api/analytics');
            if (!response.ok) throw new Error('Failed to fetch data');
            const result = await response.json();
            validateData(result);
            dispatch({ type: 'SET_DATA', payload: result });
        } catch (err) {
            dispatch({ type: 'SET_ERROR', payload: err.message });
            toast.error('Error fetching data: ' + err.message);
        } finally {
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    };

    const fetchInsights = async () => {
        dispatch({ type: 'SET_LOADING', payload: true });
        dispatch({ type: 'SET_ERROR', payload: null });
        try {
            const response = await fetch('/api/analytics/insights');
            if (!response.ok) throw new Error('Failed to fetch insights');
            const result = await response.json();
            dispatch({ type: 'SET_INSIGHTS', payload: result });
        } catch (err) {
            dispatch({ type: 'SET_ERROR', payload: err.message });
            toast.error('Error fetching insights: ' + err.message);
        } finally {
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    };

    const fetchPersonalizedInsights = async () => {
        dispatch({ type: 'SET_LOADING', payload: true });
        dispatch({ type: 'SET_ERROR', payload: null });
        try {
            const response = await fetch('/api/analytics/personalized-insights');
            if (!response.ok) throw new Error('Failed to fetch personalized insights');
            const result = await response.json();
            dispatch({ type: 'SET_PERSONALIZED_INSIGHTS', payload: result });
        } catch (err) {
            dispatch({ type: 'SET_ERROR', payload: err.message });
            toast.error('Error fetching personalized insights: ' + err.message);
        } finally {
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    };

    const validateData = (data) => {
        if (!data.barChartData || !data.lineChartData) {
            throw new Error('Invalid data format');
        }
    };

    const handleFilterChange = (event) => {
        dispatch({ type: 'SET_FILTER', payload: event.target.value });
        fetchData();
    };

    const handleExport = (format) => {
        if (format === 'pdf') {
            const doc = new jsPDF();
            doc.text('Analytics Report', 10, 10);
            doc.save('report.pdf');
        } else if (format === 'csv') {
            const parser = new Parser();
            const csv = parser.parse(data);
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', 'report.csv');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    const renderChart = () => {
        switch (chartType) {
            case 'bar':
                return <Bar data={data.barChartData} aria-label="Bar chart showing key metrics" />;
            case 'line':
                return <Line data={data.lineChartData} aria-label="Line chart showing key metrics" />;
            case 'pie':
                return data.pieChartData ? (
                    <Pie data={data.pieChartData} aria-label="Pie chart showing key metrics" />
                ) : (
                    <Typography>No Pie Chart Data</Typography>
                );
            default:
                return <Typography>No Chart Data Available</Typography>;
        }
    };

    return (
        <div>
            <ToastContainer />
            <Typography variant="h4" gutterBottom>
                Analytics Dashboard
            </Typography>
            {loading && <CircularProgress aria-label="Loading" />}
            {error && <Typography color="error" role="alert">{error}</Typography>}
            <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                        <InputLabel htmlFor="filter-select">Filter by</InputLabel>
                        <Select
                            value={filter}
                            onChange={handleFilterChange}
                            aria-label="Filter by"
                            id="filter-select"
                        >
                            <MenuItem value="all">All</MenuItem>
                            <MenuItem value="date">By Date</MenuItem>
                            <MenuItem value="campaign">By Campaign</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <Button
                        variant="contained"
                        onClick={() => fetchData()}
                        aria-label="Refresh data"
                    >
                        Refresh
                    </Button>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <Typography variant="h6">Select Date Range</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <DatePicker
                                selected={startDate}
                                onChange={(date) => setStartDate(date)}
                                placeholderText="Start Date"
                                aria-label="Select Start Date"
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <DatePicker
                                selected={endDate}
                                onChange={(date) => setEndDate(date)}
                                placeholderText="End Date"
                                aria-label="Select End Date"
                            />
                        </Grid>
                    </Grid>
                </Grid>
                <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                        <InputLabel htmlFor="chart-type-select">Chart Type</InputLabel>
                        <Select
                            value={chartType}
                            onChange={(e) => setChartType(e.target.value)}
                            id="chart-type-select"
                            aria-label="Chart Type"
                        >
                            <MenuItem value="bar">Bar Chart</MenuItem>
                            <MenuItem value="line">Line Chart</MenuItem>
                            <MenuItem value="pie">Pie Chart</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                    {renderChart()}
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="h6">AI Insights</Typography>
                    <ul>
                        {insights.map((insight, index) => (
                            <li key={index}>{insight}</li>
                        ))}
                    </ul>
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="h6">Personalized AI Insights</Typography>
                    <ul>
                        {personalizedInsights.map((insight, index) => (
                            <li key={index}>{insight}</li>
                        ))}
                    </ul>
                </Grid>
                <Grid item xs={12}>
                    <Button
                        variant="contained"
                        onClick={() => handleExport('pdf')}
                        aria-label="Export as PDF"
                    >
                        Export as PDF
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => handleExport('csv')}
                        aria-label="Export as CSV"
                    >
                        Export as CSV
                    </Button>
                </Grid>
            </Grid>
        </div>
    );
};

export default AnalyticsDashboard;