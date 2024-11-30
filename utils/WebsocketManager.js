import { useEffect, useRef, useState } from 'react';
import { useSnackbar } from 'notistack';
import axios from 'axios';
import * as Sentry from '@sentry/react';
import { useTwitchIntegration } from '../hooks/useTwitchIntegration';
import { useAuthContext } from '../context/AuthContext';
import { usePrometheusMetrics } from '../hooks/usePrometheusMetrics';
import { useAIExponentialBackoff } from '../hooks/useAIExponentialBackoff';
import { useBlockchainEventLogger } from '../hooks/useBlockchainEventLogger';
import { useGlobalLatencyOptimization } from '../hooks/useGlobalLatencyOptimization';
import { useSelfHealingWebSocket } from '../hooks/useSelfHealingWebSocket';
import { useLoadBalancer } from '../hooks/useLoadBalancer';
import { useDataEnrichment } from '../hooks/useDataEnrichment';
import { useTwitchChatCommands } from '../hooks/useTwitchChatCommands';
import { useAuctionManager } from '../hooks/useAuctionManager';

const useWebSocketManager = (twitchChannelId) => {
    const [status, setStatus] = useState('disconnected');
    const [latency, setLatency] = useState(null);
    const { enqueueSnackbar } = useSnackbar();
    const { authToken } = useAuthContext();
    const socketRef = useRef(null);
    const { twitchToken } = useTwitchIntegration();
    const { recordMetric } = usePrometheusMetrics();
    const { getReconnectionDelay } = useAIExponentialBackoff();
    const { logWebSocketEvent } = useBlockchainEventLogger();
    const { getOptimalWebSocketEndpoint } = useGlobalLatencyOptimization();
    const { selfHealSocket } = useSelfHealingWebSocket();
    const { balanceLoad } = useLoadBalancer();
    const { enrichData } = useDataEnrichment();

    // Initialize WebSocket connection with advanced features
    const initSocket = () => {
        if (socketRef.current) return; // Avoid multiple connections

        const endpoint = getOptimalWebSocketEndpoint(process.env.REACT_APP_WS_URL);
        socketRef.current = new WebSocket(endpoint);

        socketRef.current.onopen = () => {
            setStatus('connected');
            enqueueSnackbar('WebSocket connected', { variant: 'success' });
            recordMetric('websocket_connection_status', 1);
            logWebSocketEvent('connected', twitchChannelId);
        };

        socketRef.current.onclose = () => {
            setStatus('disconnected');
            enqueueSnackbar('WebSocket disconnected', { variant: 'warning' });
            recordMetric('websocket_connection_status', 0);
            logWebSocketEvent('disconnected', twitchChannelId);
            const delay = getReconnectionDelay();
            setTimeout(initSocket, delay); // AI-driven backoff for reconnection
        };

        socketRef.current.onmessage = async (message) => {
            const parsedMessage = JSON.parse(message.data);
            const enrichedMessage = await enrichData(parsedMessage);
            handleSocketMessage(enrichedMessage);
            setLatency(enrichedMessage.latency); // Update latency based on server response
            recordMetric('websocket_latency', enrichedMessage.latency);
        };

        socketRef.current.onerror = (error) => {
            console.error('WebSocket error', error);
            enqueueSnackbar('WebSocket error occurred', { variant: 'error' });
            Sentry.captureException(error);
            logWebSocketEvent('error', twitchChannelId, error.message);
            selfHealSocket(initSocket);
        };
    };

    // Handle incoming socket messages
    const handleSocketMessage = (parsedMessage) => {
        switch (parsedMessage.type) {
            case 'auctionUpdate':
                // Process auction updates such as bids, new auctions, etc.
                break;
            case 'bidUpdate':
                // Process bid updates and notify relevant auction
                break;
            default:
                // Handle other message types
                break;
        }
    };

    // Fetch initial auction data
    const fetchAuctionData = async () => {
        try {
            const response = await axios.get(`/api/auctions/${twitchChannelId}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            // Update auction data
        } catch (error) {
            enqueueSnackbar('Failed to fetch auction data', { variant: 'error' });
            Sentry.captureException(error);
        }
    };

    // Fetch Twitch channel data
    const fetchTwitchData = async () => {
        if (!twitchToken) return;

        try {
            const response = await axios.get(`/api/twitch/${twitchChannelId}`, {
                headers: { Authorization: `Bearer ${twitchToken}` },
            });
            // Update Twitch metrics (viewers, chat activity)
        } catch (error) {
            enqueueSnackbar('Failed to fetch Twitch data', { variant: 'error' });
            Sentry.captureException(error);
        }
    };

    useEffect(() => {
        balanceLoad(); // Balance the load before starting connections
        initSocket();
        fetchAuctionData();
        fetchTwitchData();

        return () => {
            if (socketRef.current) {
                socketRef.current.close(); // Clean up WebSocket connection on unmount
            }
        };
    }, [twitchChannelId, twitchToken]);

    return {
        socket: socketRef.current,
        status,
        latency,
    };
};

export default useWebSocketManager;
const { handleChatCommand } = useTwitchChatCommands();
const { triggerAuction, placeBid } = useAuctionManager();

// Respond to specific Twitch chat commands
const handleTwitchChatCommand = (command, args) => {
    switch (command) {
        case '!startAuction':
            triggerAuction(args);
            break;
        case '!placeBid':
            placeBid(args);
            break;
        default:
            console.warn(`Unknown command: ${command}`);
            break;
    }
};

// Real-Time Audience Insights
const updateAuctionBasedOnTwitchMetrics = (metrics) => {
    // Adjust auction mechanisms based on metrics
    if (metrics.chatActivity > 100) {
        // Example: Increase bid increments
    }
    if (metrics.hypeTrain) {
        // Example: Promote specific auctions
    }
};

useEffect(() => {
    const unsubscribe = handleChatCommand(handleTwitchChatCommand);
    return () => unsubscribe();
}, [twitchChannelId]);

useEffect(() => {
    const interval = setInterval(async () => {
        const metrics = await fetchTwitchMetrics(twitchChannelId);
        updateAuctionBasedOnTwitchMetrics(metrics);
    }, 60000); // Fetch metrics every minute

    return () => clearInterval(interval);
}, [twitchChannelId]);

const fetchTwitchMetrics = async (channelId) => {
    try {
        const response = await axios.get(`/api/twitch/metrics/${channelId}`, {
            headers: { Authorization: `Bearer ${twitchToken}` },
        });
        return response.data;
    } catch (error) {
        enqueueSnackbar('Failed to fetch Twitch metrics', { variant: 'error' });
        Sentry.captureException(error);
        return {};
    }
};