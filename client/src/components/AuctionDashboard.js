import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import axios from 'axios';
import { Chart } from 'react-chartjs-2';
import {
    Button,
    TextField,
    List,
    ListItem,
    ListItemText,
    Typography,
    Container,
    Grid,
    Paper,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Switch,
    FormControlLabel,
    Badge,
} from '@material-ui/core';
import { useTheme } from '@material-ui/core/styles';
import { useSnackbar } from 'notistack';
import { useErrorBoundary } from 'react-error-boundary';
import Skeleton from '@mui/lab/Skeleton';
import { useWebSocket } from '../hooks/useWebSocket';
import { filterAndSortAuctions } from '../utils/filterAndSortAuctions';

const AuctionDashboard = ({ userId, userRole }) => {
    const [currentAuction, setCurrentAuction] = useState(null);
    const [bidAmount, setBidAmount] = useState('');
    const [notifications, setNotifications] = useState([]);
    const [topBid, setTopBid] = useState(null);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sortOption, setSortOption] = useState('');
    const [auctionTypeFilter, setAuctionTypeFilter] = useState('');
    const [darkMode, setDarkMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [offlineBids, setOfflineBids] = useState([]);
    const [predictedRange, setPredictedRange] = useState(null);
    const [auctions, setAuctions] = useState([]);

    const { enqueueSnackbar } = useSnackbar();
    const theme = useTheme();
    const { showBoundary } = useErrorBoundary();

    const chartRef = useRef(null);

    const [wsStatus, latency, sendMessage] = useWebSocket(process.env.REACT_APP_WS_URL, {
        onConnect: () => {
            console.log('Connected to WebSocket');
            // Send any queued bids
            offlineBids.forEach(bid => sendMessage(bid));
            setOfflineBids([]);
        },
        onDisconnect: () => console.log('Disconnected from WebSocket'),
        onMessage: (message) => {
            setNotifications((prev) => [...prev, message]);
            enqueueSnackbar(message, { variant: 'info' });
        },
    });

    useEffect(() => {
        const fetchAuctions = async () => {
            try {
                const response = await axios.get('/api/auctions');
                setAuctions(response.data);
                setLoading(false);
                localStorage.setItem('auctions', JSON.stringify(response.data));
            } catch (error) {
                enqueueSnackbar('Error fetching auctions.', { variant: 'error' });
                showBoundary(error);
            }
        };

        const savedAuctions = localStorage.getItem('auctions');
        if (savedAuctions) {
            setAuctions(JSON.parse(savedAuctions));
            setLoading(false);
        } else {
            fetchAuctions();
        }
    }, [enqueueSnackbar, showBoundary]);

    useEffect(() => {
        const fetchPredictedRange = async () => {
            if (currentAuction) {
                try {
                    const response = await axios.get(`/api/auctions/${currentAuction.id}/prediction`);
                    setPredictedRange(response.data);
                } catch (error) {
                    enqueueSnackbar('Error fetching predicted bid range.', { variant: 'error' });
                    showBoundary(error);
                }
            }
        };
        fetchPredictedRange();
    }, [currentAuction, showBoundary, enqueueSnackbar]);

    const handleBidSubmit = useCallback(async () => {
        if (!currentAuction || !bidAmount || isNaN(bidAmount) || bidAmount <= 0 || bidAmount <= topBid) {
            enqueueSnackbar('Please enter a valid bid amount greater than the current highest bid.', { variant: 'warning' });
            return;
        }

        const bid = {
            auctionId: currentAuction.id,
            bidAmount,
        };

        try {
            await axios.post('/api/auctions/bid', bid);
            enqueueSnackbar('Bid submitted successfully!', { variant: 'success' });
            setBidAmount('');
        } catch (error) {
            if (wsStatus === 'disconnected') {
                setOfflineBids((prev) => [...prev, bid]);
                enqueueSnackbar('Bid queued due to offline status.', { variant: 'info' });
            } else {
                enqueueSnackbar('Failed to submit bid.', { variant: 'error' });
                showBoundary(error);
            }
        }
    }, [currentAuction, bidAmount, topBid, wsStatus, enqueueSnackbar, showBoundary]);

    const renderAuctions = useCallback(() => {
        const filteredAuctions = filterAndSortAuctions(auctions, { categoryFilter, statusFilter, sortOption, auctionTypeFilter });

        return filteredAuctions.map((auction) => (
            <ListItem key={auction.id} button onClick={() => setCurrentAuction(auction)}>
                <ListItemText primary={auction.title} />
            </ListItem>
        ));
    }, [auctions, categoryFilter, statusFilter, sortOption, auctionTypeFilter]);

    const renderBidTrends = useMemo(() => {
        if (!currentAuction || !currentAuction.bids) return null;

        const highestBid = Math.max(...currentAuction.bids.map((bid) => bid.amount));
        const data = {
            labels: currentAuction.bids.map((bid) => new Date(bid.timestamp).toLocaleTimeString()),
            datasets: [
                {
                    label: 'Bid Amount',
                    data: currentAuction.bids.map((bid) => bid.amount),
                    fill: false,
                    borderColor: 'rgba(75,192,192,1)',
                },
            ],
        };

        const options = {
            plugins: {
                annotation: {
                    annotations: [
                        {
                            type: 'line',
                            yMin: highestBid,
                            yMax: highestBid,
                            borderColor: 'red',
                            borderWidth: 2,
                            label: {
                                content: `Highest Bid: ${highestBid}`,
                                enabled: true,
                                position: 'start',
                            },
                        },
                        predictedRange && {
                            type: 'box',
                            yMin: predictedRange.min,
                            yMax: predictedRange.max,
                            backgroundColor: 'rgba(0,255,0,0.1)',
                            label: {
                                content: `Predicted Range: ${predictedRange.min}-${predictedRange.max}`,
                                enabled: true,
                            },
                        },
                    ].filter(Boolean),
                },
            },
            tooltips: {
                callbacks: {
                    label: function (tooltipItem) {
                        const bid = currentAuction.bids[tooltipItem.index];
                        return `${bid.bidder}: $${tooltipItem.yLabel} at ${new Date(bid.timestamp).toLocaleTimeString()}`;
                    },
                },
            },
        };

        if (chartRef.current) {
            chartRef.current.data = data;
            chartRef.current.options = options;
            chartRef.current.update();
        }

        return <Chart ref={chartRef} type="line" data={data} options={options} />;
    }, [currentAuction, predictedRange]);

    const renderLeaderboard = useMemo(() => {
        if (!currentAuction || !currentAuction.bids) return null;

        const leaderboard = [...currentAuction.bids]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5)
            .map((bid, index) => (
                <li key={index}>
                    #{index + 1}: {bid.bidder} - ${bid.amount}
                </li>
            ));

        return (
            <div>
                <Typography variant="h6">Leaderboard</Typography>
                <ul>{leaderboard}</ul>
            </div>
        );
    }, [currentAuction]);

    const renderCountdown = (endTime) => {
        const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(endTime));

        useEffect(() => {
            const timer = setInterval(() => {
                setTimeLeft(calculateTimeLeft(endTime));
            }, 1000);

            return () => clearInterval(timer);
        }, [endTime]);

        return (
            <Typography variant="subtitle2">
                Time Left: {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
            </Typography>
        );
    };

    const calculateTimeLeft = (endTime) => {
        const difference = new Date(endTime) - new Date();
        let timeLeft = {};

        if (difference > 0) {
            timeLeft = {
                hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                minutes: Math.floor((difference / 1000 / 60) % 60),
                seconds: Math.floor((difference / 1000) % 60),
            };
        } else {
            timeLeft = { hours: 0, minutes: 0, seconds: 0 };
        }

        return timeLeft;
    };

    const renderWsStatus = () => (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="body2" style={{ marginRight: 8 }}>
                WebSocket Status:
            </Typography>
            <Badge
                color={wsStatus === 'connected' ? 'primary' : 'secondary'}
                variant="dot"
            />
            <Typography variant="body2" style={{ marginLeft: 8 }}>
                {wsStatus}
            </Typography>
            {latency !== null && (
                <Typography variant="body2" style={{ marginLeft: 16 }}>
                    Latency: {latency}ms
                </Typography>
            )}
        </div>
    );

    return (
        <Container style={{ background: darkMode ? '#121212' : '#fff', color: darkMode ? '#fff' : '#000' }}>
            <FormControlLabel
                control={<Switch checked={darkMode} onChange={() => setDarkMode(!darkMode)} />}
                label="Dark Mode"
            />
            {renderWsStatus()}
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <Paper style={{ padding: theme.spacing(2) }}>
                        <Typography variant="h6">Auctions</Typography>
                        {loading ? (
                            <Skeleton variant="rectangular" width="100%" height={400} />
                        ) : (
                            <>
                                <FormControl fullWidth style={{ marginTop: theme.spacing(2) }}>
                                    <InputLabel>Category</InputLabel>
                                    <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                                        <MenuItem value="">All</MenuItem>
                                        <MenuItem value="electronics">Electronics</MenuItem>
                                        <MenuItem value="fashion">Fashion</MenuItem>
                                        <MenuItem value="home">Home</MenuItem>
                                    </Select>
                                </FormControl>
                                <FormControl fullWidth style={{ marginTop: theme.spacing(2) }}>
                                    <InputLabel>Status</InputLabel>
                                    <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                        <MenuItem value="">All</MenuItem>
                                        <MenuItem value="active">Active</MenuItem>
                                        <MenuItem value="closed">Closed</MenuItem>
                                    </Select>
                                </FormControl>
                                <FormControl fullWidth style={{ marginTop: theme.spacing(2) }}>
                                    <InputLabel>Sort By</InputLabel>
                                    <Select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
                                        <MenuItem value="">None</MenuItem>
                                        <MenuItem value="highestBid">Highest Current Bid</MenuItem>
                                        <MenuItem value="endingSoon">Ending Soon</MenuItem>
                                    </Select>
                                </FormControl>
                                <FormControl fullWidth style={{ marginTop: theme.spacing(2) }}>
                                    <InputLabel>Auction Type</InputLabel>
                                    <Select value={auctionTypeFilter} onChange={(e) => setAuctionTypeFilter(e.target.value)}>
                                        <MenuItem value="">All</MenuItem>
                                        <MenuItem value="live">Live</MenuItem>
                                        <MenuItem value="timed">Timed</MenuItem>
                                    </Select>
                                </FormControl>
                                <List>{renderAuctions()}</List>
                            </>
                        )}
                    </Paper>
                </Grid>
                <Grid item xs={12} md={6}>
                    <Paper style={{ padding: theme.spacing(2) }}>
                        <Typography variant="h6">Bid Panel</Typography>
                        {currentAuction ? (
                            <div>
                                <Typography variant="subtitle1">{currentAuction.title}</Typography>
                                <Typography variant="subtitle2">
                                    Top Bid: {topBid !== null ? `$${topBid}` : 'No bids yet'}
                                </Typography>
                                {renderCountdown(currentAuction.endTime)}
                                <TextField
                                    label="Bid Amount"
                                    value={bidAmount}
                                    onChange={(e) => setBidAmount(e.target.value)}
                                    fullWidth
                                    style={{ marginTop: theme.spacing(2) }}
                                />
                                <Button
                                    variant="contained"
                                    color="primary"
                                    onClick={handleBidSubmit}
                                    style={{ marginTop: theme.spacing(2) }}
                                >
                                    Submit Bid
                                </Button>
                                {renderBidTrends}
                                {renderLeaderboard}
                            </div>
                        ) : (
                            <Typography variant="body1" style={{ marginTop: theme.spacing(2) }}>
                                Select an auction to view details and place a bid.
                            </Typography>
                        )}
                    </Paper>
                </Grid>
                <Grid item xs={12}>
                    <Paper style={{ padding: theme.spacing(2) }}>
                        <Typography variant="h6">Notifications</Typography>
                        <ul>
                            {notifications.map((notification, index) => (
                                <li key={index}>
                                    <Badge color="primary" badgeContent={index + 1}>
                                        {notification}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    </Paper>
                </Grid>
            </Grid>
        </Container>
    );
};

export default memo(AuctionDashboard);
