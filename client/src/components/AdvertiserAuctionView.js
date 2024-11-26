import React, { useEffect, useState, useContext } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import { Grid, Card, CardContent, Typography, Button, TextField, Select, MenuItem, Snackbar, CircularProgress, CardMedia } from '@material-ui/core';
import MuiAlert from '@material-ui/lab/Alert';
import { apiClient } from '../apiClient';
import { WebSocketContext } from '../WebSocketContext';
import AuctionDashboard from '../AuctionDashboard';
import { useSpring, animated } from 'react-spring';

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        padding: theme.spacing(2),
    },
    card: {
        margin: theme.spacing(2),
    },
    filter: {
        margin: theme.spacing(2),
    },
    media: {
        height: 140,
    },
}));

function Alert(props) {
    return <MuiAlert elevation={6} variant="filled" {...props} />;
}

const AdvertiserAuctionView = () => {
    const classes = useStyles();
    const [auctions, setAuctions] = useState([]);
    const [filter, setFilter] = useState('');
    const [sort, setSort] = useState('');
    const [bidAmount, setBidAmount] = useState('');
    const [loading, setLoading] = useState(true);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: '' });
    const { socket } = useContext(WebSocketContext);

    useEffect(() => {
        fetchAuctions();
        socket.on('auctionUpdate', handleAuctionUpdate);
        return () => {
            socket.off('auctionUpdate', handleAuctionUpdate);
        };
    }, []);

    const fetchAuctions = async () => {
        try {
            const response = await apiClient.get('/auctions');
            setAuctions(response.data);
        } catch (error) {
            console.error('Error fetching auctions:', error);
            setSnackbar({ open: true, message: 'Error fetching auctions', severity: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleAuctionUpdate = (updatedAuction) => {
        setAuctions((prevAuctions) =>
            prevAuctions.map((auction) =>
                auction.id === updatedAuction.id ? updatedAuction : auction
            )
        );
    };

    const handleBid = async (auctionId) => {
        if (isNaN(bidAmount) || bidAmount <= 0) {
            setSnackbar({ open: true, message: 'Invalid bid amount', severity: 'error' });
            return;
        }

        const auction = auctions.find(a => a.id === auctionId);
        if (bidAmount <= auction.highestBid) {
            setSnackbar({ open: true, message: 'Bid must be higher than the current highest bid', severity: 'error' });
            return;
        }

        try {
            const response = await apiClient.post(`/auctions/${auctionId}/bid`, { bidAmount });
            if (response.status === 200) {
                fetchAuctions();
                setSnackbar({ open: true, message: 'Bid placed successfully', severity: 'success' });
            }
        } catch (error) {
            console.error('Error placing bid:', error);
            setSnackbar({ open: true, message: 'Error placing bid', severity: 'error' });
        }
    };

    const handleFilterChange = (event) => {
        setFilter(event.target.value);
    };

    const handleSortChange = (event) => {
        setSort(event.target.value);
    };

    const handleCloseSnackbar = () => {
        setSnackbar({ ...snackbar, open: false });
    };

    const filteredAuctions = auctions
        .filter((auction) => auction.category.includes(filter))
        .sort((a, b) => {
            if (sort === 'minBid') {
                return a.minBid - b.minBid;
            } else if (sort === 'highestBid') {
                return b.highestBid - a.highestBid;
            } else {
                return 0;
            }
        });

    return (
        <div className={classes.root}>
            <Grid container spacing={3}>
                <Grid item xs={12}>
                    <TextField
                        label="Filter by Category"
                        value={filter}
                        onChange={handleFilterChange}
                        className={classes.filter}
                        inputProps={{ 'aria-label': 'Filter by Category' }}
                    />
                    <Select
                        value={sort}
                        onChange={handleSortChange}
                        className={classes.filter}
                        inputProps={{ 'aria-label': 'Sort By' }}
                    >
                        <MenuItem value="">Sort By</MenuItem>
                        <MenuItem value="minBid">Minimum Bid</MenuItem>
                        <MenuItem value="highestBid">Highest Bid</MenuItem>
                    </Select>
                </Grid>
                {loading ? (
                    <CircularProgress />
                ) : (
                    filteredAuctions.map((auction) => (
                        <Grid item xs={12} sm={6} md={4} key={auction.id}>
                            <Card className={classes.card}>
                                <CardMedia
                                    className={classes.media}
                                    image={auction.thumbnailUrl}
                                    title={auction.streamerName}
                                />
                                <CardContent>
                                    <Typography variant="h5">{auction.streamerName}</Typography>
                                    <Typography variant="body1">Category: {auction.category}</Typography>
                                    <Typography variant="body1">Min Bid: ${auction.minBid}</Typography>
                                    <Typography variant="body1">Highest Bid: ${auction.highestBid}</Typography>
                                    <Typography variant="body1">Ends: {new Date(auction.endTime).toLocaleString()}</Typography>
                                    <TextField
                                        label="Your Bid"
                                        value={bidAmount}
                                        onChange={(e) => setBidAmount(e.target.value)}
                                        type="number"
                                        fullWidth
                                        inputProps={{ 'aria-label': 'Your Bid' }}
                                    />
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={() => handleBid(auction.id)}
                                        disabled={bidAmount <= auction.highestBid}
                                        aria-label="Place Bid"
                                    >
                                        Place Bid
                                    </Button>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))
                )}
            </Grid>
            <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar}>
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </div>
    );
};

export default AdvertiserAuctionView;

// Feature: Recommend Optimal Bid Amounts
const recommendBid = (auction) => {
    // Placeholder for AI prediction logic
    const optimalBid = auction.highestBid + (auction.highestBid * 0.1); // Example: 10% higher than current highest bid
    return optimalBid.toFixed(2);
};

// Real-Time Metrics
const [metrics, setMetrics] = useState({ totalBids: 0, avgBidAmount: 0, engagementRate: 0 });

useEffect(() => {
    socket.on('metricsUpdate', handleMetricsUpdate);
    return () => {
        socket.off('metricsUpdate', handleMetricsUpdate);
    };
}, []);

const handleMetricsUpdate = (updatedMetrics) => {
    setMetrics(updatedMetrics);
};

// Enhanced Error Handling
const handleRetry = async (auctionId) => {
    try {
        await handleBid(auctionId);
    } catch (error) {
        console.error('Retry failed:', error);
    }
};

// Gamification Elements
const [badges, setBadges] = useState([]);

useEffect(() => {
    fetchBadges();
}, []);

const fetchBadges = async () => {
    try {
        const response = await apiClient.get('/badges');
        setBadges(response.data);
    } catch (error) {
        console.error('Error fetching badges:', error);
    }
};

// Accessibility & UX
const renderTooltip = (title) => (
    <Tooltip title={title}>
        <InfoIcon />
    </Tooltip>
);

return (
    <div className={classes.root}>
        <Grid container spacing={3}>
            <Grid item xs={12}>
                <TextField
                    label="Filter by Category"
                    value={filter}
                    onChange={handleFilterChange}
                    className={classes.filter}
                    inputProps={{ 'aria-label': 'Filter by Category' }}
                />
                <Select
                    value={sort}
                    onChange={handleSortChange}
                    className={classes.filter}
                    inputProps={{ 'aria-label': 'Sort By' }}
                >
                    <MenuItem value="">Sort By</MenuItem>
                    <MenuItem value="minBid">Minimum Bid</MenuItem>
                    <MenuItem value="highestBid">Highest Bid</MenuItem>
                </Select>
            </Grid>
            <Grid item xs={12}>
                <Typography variant="h6">Real-Time Metrics</Typography>
                <Typography variant="body1">Total Bids: {metrics.totalBids}</Typography>
                <Typography variant="body1">Average Bid Amount: ${metrics.avgBidAmount}</Typography>
                <Typography variant="body1">Engagement Rate: {metrics.engagementRate}%</Typography>
            </Grid>
            {loading ? (
                <CircularProgress />
            ) : (
                filteredAuctions.map((auction) => (
                    <Grid item xs={12} sm={6} md={4} key={auction.id}>
                        <animated.div style={useSpring({ opacity: 1, from: { opacity: 0 } })}>
                            <Card className={classes.card}>
                                <CardMedia
                                    className={classes.media}
                                    image={auction.thumbnailUrl}
                                    title={auction.streamerName}
                                />
                                <CardContent>
                                    <Typography variant="h5">{auction.streamerName}</Typography>
                                    <Typography variant="body1">Category: {auction.category}</Typography>
                                    <Typography variant="body1">Min Bid: ${auction.minBid}</Typography>
                                    <Typography variant="body1">Highest Bid: ${auction.highestBid}</Typography>
                                    <Typography variant="body1">Ends: {new Date(auction.endTime).toLocaleString()}</Typography>
                                    <Typography variant="body1">Recommended Bid: ${recommendBid(auction)}</Typography>
                                    <TextField
                                        label="Your Bid"
                                        value={bidAmount}
                                        onChange={(e) => setBidAmount(e.target.value)}
                                        type="number"
                                        fullWidth
                                        inputProps={{ 'aria-label': 'Your Bid' }}
                                    />
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={() => handleBid(auction.id)}
                                        disabled={bidAmount <= auction.highestBid}
                                        aria-label="Place Bid"
                                    >
                                        Place Bid
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        color="secondary"
                                        onClick={() => handleRetry(auction.id)}
                                        aria-label="Retry Bid"
                                    >
                                        Retry
                                    </Button>
                                </CardContent>
                            </Card>
                        </animated.div>
                    </Grid>
                ))
            )}
        </Grid>
        <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar}>
            <Alert onClose={handleCloseSnackbar} severity={snackbar.severity}>
                {snackbar.message}
            </Alert>
        </Snackbar>
    </div>
);