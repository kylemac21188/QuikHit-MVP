import React, { useState, useEffect, useCallback } from 'react';
import { w3cwebsocket as W3CWebSocket } from 'websocket';
import CryptoJS from 'crypto-js';
import * as tf from '@tensorflow/tfjs';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import * as Sentry from '@sentry/react';
import {
    Container,
    Card,
    CardContent,
    Typography,
    Button,
    TextField,
    CircularProgress,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
} from '@mui/material';

// Environment Variables
const wsBaseUrl = process.env.REACT_APP_WS_BASE_URL || 'wss://bidding-server.com/auctions/';
const blockchainNodeUrl = process.env.REACT_APP_BLOCKCHAIN_NODE_URL || 'https://blockchain-node-url.com';
const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS || 'contract-address';
const secretKey = process.env.REACT_APP_SECRET_KEY || 'default-secret-key'; // Ensure secretKey is set
const modelPath = process.env.REACT_APP_BID_MODEL_PATH || '/path/to/bid-prediction-model.json';
const maxRetries = 5;

const useRealTimeBidding = (auctionId) => {
    // State Variables
    const [auctionDetails, setAuctionDetails] = useState({});
    const [error, setError] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [autoBidEnabled, setAutoBidEnabled] = useState(false);
    const [predictedBid, setPredictedBid] = useState(null);
    const [bidHistory, setBidHistory] = useState([]);
    const [isAutoBidding, setIsAutoBidding] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [missedMessages, setMissedMessages] = useState([]);
    const client = new W3CWebSocket(`${wsBaseUrl}${auctionId}`);
    let model = null;

    // Error Handler
    const handleError = (type, message, error) => {
        setError({ type, message });
        Sentry.captureException(error || new Error(message));
        toast.error(message);
        console.error(`${type} Error: ${message}`, error);
    };

    // WebSocket Connection Management
    const connectWebSocket = useCallback(() => {
        let retryCount = 0;
        let totalElapsedTime = 0;

        const establishConnection = () => {
            if (client.readyState === W3CWebSocket.OPEN || client.readyState === W3CWebSocket.CONNECTING) {
                return;
            }

            client.onopen = () => {
                setIsConnected(true);
                toast.success('WebSocket Client Connected');
                Sentry.captureMessage('WebSocket Client Connected');

                // Resend missed messages
                missedMessages.forEach((msg) => client.send(msg));
                setMissedMessages([]);

                client.send(JSON.stringify({ type: 'ping' })); // Initial ping
                retryCount = 0; // Reset retries
                totalElapsedTime = 0; // Reset elapsed time
            };

            client.onclose = () => {
                setIsConnected(false);
                if (retryCount < maxRetries) {
                    const delay = Math.min(1000 * 2 ** retryCount + Math.random() * 1000, 30000); // Backoff with jitter
                    toast.warn(`Reconnecting in ${delay / 1000} seconds...`);
                    console.log(`WebSocket reconnect attempt #${retryCount + 1}, elapsed time: ${totalElapsedTime / 1000} seconds`);
                    setTimeout(establishConnection, delay);
                    retryCount++;
                    totalElapsedTime += delay;
                } else {
                    handleError('WebSocket', 'Max retries reached. Could not reconnect.');
                }
            };

            client.onmessage = (message) => {
                try {
                    const data = JSON.parse(message.data);
                    if (!data.currentBid || !data.minimumIncrement) {
                        throw new Error('Incomplete auction details received.');
                    }
                    setAuctionDetails(data);

                    setBidHistory((prev) => {
                        const newBids = (data.bids || []).filter(
                            (bid) => !prev.some((prevBid) => prevBid.id === bid.id)
                        );
                        return [...prev, ...newBids].slice(-100); // Limit to last 100 bids
                    });

                    if (data.type === 'outbid') {
                        toast.warn('You have been outbid!');
                    }
                } catch (err) {
                    handleError('WebSocket', 'Failed to parse message.', err);
                }
            };

            client.onerror = (err) => {
                handleError('WebSocket', 'WebSocket encountered an error.', err);
            };
        };

        establishConnection();
    }, [client, missedMessages]);

    // Predict Optimal Bid
    const predictOptimalBid = useCallback(async () => {
        try {
            if (!model) {
                model = await tf.loadLayersModel(modelPath);
            }
            const prediction = model.predict(tf.tensor2d([auctionDetails.currentBid || 0], [1, 1]));
            const optimalBid = (await prediction.data())[0];
            setPredictedBid(optimalBid);
            return optimalBid;
        } catch (error) {
            handleError('AI', 'Prediction failed.', error);
        }
    }, [auctionDetails.currentBid]);

    // Submit a Bid
    const submitBid = (bidAmount) => {
        if (!isConnected) {
            toast.error('Cannot submit a bid while disconnected.');
            return;
        }
        if (bidAmount < (auctionDetails.currentBid || 0) + (auctionDetails.minimumIncrement || 0)) {
            return handleError('Validation', 'Bid amount is below the minimum increment.');
        }

        const message = JSON.stringify({
            type: 'submitBid',
            data: CryptoJS.AES.encrypt(
                JSON.stringify({ bidAmount, userId: 'user123', timestamp: Date.now() }),
                secretKey
            ).toString(),
            hmac: CryptoJS.HmacSHA256(
                JSON.stringify({ bidAmount, userId: 'user123', timestamp: Date.now() }),
                secretKey
            ).toString(),
        });

        if (client.readyState === W3CWebSocket.OPEN) {
            client.send(message);
        } else {
            setMissedMessages((prev) => [...prev, message]);
        }

        toast.success('Bid submitted successfully.');
    };

    // Enable or Disable Auto-Bidding
    const setAutoBid = (enabled) => {
        setAutoBidEnabled(enabled);
        if (enabled) {
            toast.info('Auto-bidding enabled.');
            autoBid();
        }
    };

    const autoBid = useCallback(() => {
        if (!autoBidEnabled || isAutoBidding || !auctionDetails.currentBid) return;

        setIsAutoBidding(true);
        const optimalBid = Math.max(
            (auctionDetails.currentBid || 0) + (auctionDetails.minimumIncrement || 0),
            predictedBid || 0
        );
        submitBid(optimalBid);

        setTimeout(() => setIsAutoBidding(false), 2000); // Throttle auto-bid
    }, [autoBidEnabled, isAutoBidding, auctionDetails, predictedBid]);

    // Verify Winning Bid on Blockchain
    const verifyWinningBid = async (winningBid) => {
        setIsLoading(true);
        try {
            const provider = new ethers.providers.JsonRpcProvider(blockchainNodeUrl);
            const contract = new ethers.Contract(contractAddress, ['function verifyBid(bytes32 hash) view returns (bool)'], provider);
            const bidHash = ethers.utils.keccak256(JSON.stringify(winningBid));
            const isValid = await contract.verifyBid(bidHash);
            toast.success(isValid ? 'Winning bid verified.' : 'Bid verification failed.');
            return isValid;
        } catch (error) {
            handleError('Blockchain', 'Bid verification failed.', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Cleanup WebSocket and Model Resources
    useEffect(() => {
        connectWebSocket();
        return () => {
            client.close();
            model?.dispose();
        };
    }, [connectWebSocket]);

    return {
        auctionDetails,
        error,
        isConnected,
        submitBid,
        setAutoBid,
        predictOptimalBid,
        verifyWinningBid,
        predictedBid,
        bidHistory,
        isLoading,
    };
};

const AuctionComponent = ({ auctionId }) => {
    const {
        auctionDetails,
        error,
        isConnected,
        submitBid,
        setAutoBid,
        predictOptimalBid,
        verifyWinningBid,
        predictedBid,
        bidHistory,
        isLoading,
    } = useRealTimeBidding(auctionId);

    const [bidAmount, setBidAmount] = useState('');

    const handleBidChange = (e) => {
        setBidAmount(e.target.value);
    };

    const handleBidSubmit = () => {
        const amount = parseFloat(bidAmount);
        if (!isConnected) {
            toast.error('Cannot submit a bid while disconnected.');
            return;
        }
        if (isNaN(amount) || amount <= 0 || amount < auctionDetails.currentBid + auctionDetails.minimumIncrement) {
            toast.error('Please enter a valid bid amount that meets the minimum increment.');
            return;
        }
        submitBid(amount);
    };

    return (
        <Container>
            <Card>
                <CardContent>
                    <Typography variant="h5">Auction Details</Typography>
                    {error && <Alert severity="error">{error.message}</Alert>}
                    <Typography>Current Bid: {auctionDetails.currentBid}</Typography>
                    <Typography>Minimum Increment: {auctionDetails.minimumIncrement}</Typography>
                    <Typography>
                        Connection Status: 
                        {isConnected ? (
                            <span style={{ color: 'green' }}>🟢 Connected</span>
                        ) : (
                            <span style={{ color: 'red' }}>🔴 Disconnected</span>
                        )}
                    </Typography>
                    <TextField
                        label="Bid Amount"
                        value={bidAmount}
                        onChange={handleBidChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <Button variant="contained" color="primary" onClick={handleBidSubmit}>
                        Submit Bid
                    </Button>
                    <Button variant="contained" color="secondary" onClick={() => setAutoBid(!autoBidEnabled)}>
                        {autoBidEnabled ? 'Disable Auto-Bid' : 'Enable Auto-Bid'}
                    </Button>
                    <Button variant="contained" onClick={predictOptimalBid}>
                        Predict Optimal Bid
                    </Button>
                    <Button variant="contained" onClick={() => verifyWinningBid({ bidAmount: auctionDetails.currentBid })}>
                        Verify Winning Bid
                    </Button>
                    {isLoading && <CircularProgress />}
                    {predictedBid && (
                        <Typography variant="h6" color="primary">
                            Predicted Optimal Bid: {predictedBid}
                        </Typography>
                    )}
                    {autoBidEnabled && (
                        <Alert severity="info">Auto-bidding is active. Bids will be placed automatically.</Alert>
                    )}
                </CardContent>
            </Card>
            <Typography variant="h6" style={{ marginTop: '20px' }}>
                Bid History
            </Typography>
            {bidHistory.length === 0 ? (
                <Typography>No bids placed yet.</Typography>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Bid Amount</TableCell>
                                <TableCell>Timestamp</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {bidHistory.map((bid, index) => (
                                <TableRow key={index}>
                                    <TableCell>{bid.amount}</TableCell>
                                    <TableCell>{new Date(bid.timestamp).toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Container>
    );
};

export default AuctionComponent;