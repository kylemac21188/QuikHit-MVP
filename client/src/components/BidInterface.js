import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { memo } from 'react';
import { useSnackbar } from 'notistack';
import {
    TextField,
    Button,
    CircularProgress,
    Typography,
    Box,
    LinearProgress,
    Tooltip,
    IconButton,
} from '@material-ui/core';
import { useTheme } from '@material-ui/core/styles';
import { formatDistanceToNow } from 'date-fns';
import useWebSocket from 'react-use-websocket';
import HelpIcon from '@material-ui/icons/Help';

const BidInterface = ({ currentAuction, userId }) => {
    const { enqueueSnackbar } = useSnackbar();
    const theme = useTheme();
    const [bidAmount, setBidAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [topBid, setTopBid] = useState(currentAuction?.highestBid || 0);
    const [suggestedBid, setSuggestedBid] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [auctionTimeLeft, setAuctionTimeLeft] = useState('');

    const { sendJsonMessage, lastJsonMessage } = useWebSocket('wss://your-websocket-url', {
        onOpen: () => setIsConnected(true),
        onClose: () => setIsConnected(false),
        shouldReconnect: () => true,
    });

    // Update top bid in real-time via WebSocket
    useEffect(() => {
        if (lastJsonMessage && lastJsonMessage.type === 'newBid' && lastJsonMessage.auctionId === currentAuction.id) {
            setTopBid(lastJsonMessage.bidAmount);
        }
    }, [lastJsonMessage, currentAuction]);

    // Fetch AI-predicted bid suggestion
    useEffect(() => {
        const fetchSuggestedBid = async () => {
            if (currentAuction) {
                try {
                    const response = await fetch(`/api/auctions/${currentAuction.id}/suggestedBid`);
                    const { suggestedBid } = await response.json();
                    setSuggestedBid(suggestedBid);
                } catch (error) {
                    enqueueSnackbar('Error fetching suggested bid.', { variant: 'warning' });
                }
            }
        };

        fetchSuggestedBid();
    }, [currentAuction, enqueueSnackbar]);

    // Calculate time left for auction
    useEffect(() => {
        const updateAuctionTimeLeft = () => {
            const timeLeft = formatDistanceToNow(new Date(currentAuction.endTime));
            setAuctionTimeLeft(timeLeft);
        };

        updateAuctionTimeLeft();
        const interval = setInterval(updateAuctionTimeLeft, 1000);
        return () => clearInterval(interval);
    }, [currentAuction]);

    const handleBidChange = (event) => {
        setBidAmount(event.target.value);
    };

    const handleBidSubmit = async () => {
        if (isNaN(bidAmount) || bidAmount <= topBid) {
            enqueueSnackbar(`Bid must be higher than $${topBid}`, { variant: 'error' });
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/auctions/bid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auctionId: currentAuction.id, userId, bidAmount }),
            });

            if (!response.ok) {
                throw new Error('Failed to submit bid');
            }

            const data = await response.json();
            enqueueSnackbar('Bid submitted successfully!', { variant: 'success' });
            setTopBid(data.highestBid);

            // Record bid on blockchain
            const blockchainResponse = await fetch('/api/blockchain/bid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auctionId: currentAuction.id, bidAmount }),
            });

            if (!blockchainResponse.ok) {
                throw new Error('Blockchain validation failed');
            }
        } catch (error) {
            enqueueSnackbar(error.message, { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const renderBidAnalytics = useMemo(() => {
        const totalBids = currentAuction?.bids?.length || 0;
        const averageBid = totalBids ? (currentAuction.bids.reduce((sum, bid) => sum + bid.amount, 0) / totalBids).toFixed(2) : 0;

        return (
            <Box>
                <Typography variant="subtitle2">Total Bids: {totalBids}</Typography>
                <Typography variant="subtitle2">Average Bid: ${averageBid}</Typography>
            </Box>
        );
    }, [currentAuction]);

    if (!currentAuction) {
        return <CircularProgress />;
    }

    return (
        <Box>
            {renderBidAnalytics}
            <Typography variant="h4">{currentAuction.title}</Typography>
            <Typography variant="body1">{currentAuction.description}</Typography>
            <Box display="flex" alignItems="center" mt={1} mb={2}>
                <Typography variant="h6">Current Highest Bid: ${topBid}</Typography>
                {suggestedBid && (
                    <Tooltip title="AI-suggested bid based on bidding patterns">
                        <IconButton size="small">
                            <HelpIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
            {suggestedBid && (
                <Typography variant="subtitle2" color="textSecondary">
                    Suggested Bid: ${suggestedBid}
                </Typography>
            )}
            <Typography variant="body2">
                Auction ends in: {auctionTimeLeft}
            </Typography>
            <LinearProgress
                variant="determinate"
                value={Math.max(
                    0,
                    Math.min(
                        100,
                        (1 - (new Date(currentAuction.endTime) - new Date()) / (new Date(currentAuction.endTime) - new Date(currentAuction.startTime))) * 100
                    )
                )}
                style={{ marginTop: theme.spacing(2), marginBottom: theme.spacing(2) }}
            />
            <TextField
                label="Your Bid"
                value={bidAmount}
                onChange={handleBidChange}
                error={isNaN(bidAmount) || bidAmount <= topBid}
                helperText={
                    isNaN(bidAmount) || bidAmount <= topBid
                        ? `Bid must be higher than $${topBid}`
                        : ''
                }
                fullWidth
                margin="normal"
            />
            <Button
                variant="contained"
                color="primary"
                onClick={handleBidSubmit}
                disabled={loading || !isConnected}
            >
                {loading ? <CircularProgress size={24} /> : 'Place Bid'}
            </Button>
            <Typography
                variant="caption"
                color={isConnected ? 'primary' : 'error'}
                style={{ marginTop: theme.spacing(2) }}
            >
                {isConnected ? 'Connected to WebSocket' : 'Not Connected - Offline Bids Queued'}
            </Typography>
        </Box>
    );
};

BidInterface.propTypes = {
    currentAuction: PropTypes.shape({
        id: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        description: PropTypes.string.isRequired,
        highestBid: PropTypes.number.isRequired,
        endTime: PropTypes.string.isRequired,
        startTime: PropTypes.string.isRequired,
        bids: PropTypes.arrayOf(PropTypes.shape({
            amount: PropTypes.number.isRequired,
        })),
    }),
    userId: PropTypes.string.isRequired,
};

export default memo(BidInterface);