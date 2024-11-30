import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useWebSocketManager } from '../hooks/useWebSocketManager';
import { useTwitchIntegration } from '../hooks/useTwitchIntegration';
import { useTwitchChatCommands } from '../hooks/useTwitchChatCommands';
import { usePrometheusMetrics } from '../hooks/usePrometheusMetrics';
import { useRateLimiting } from '../hooks/useRateLimiting';
import { useCsrf } from '../hooks/useCsrf';
import { usePredictiveInsights } from '../hooks/usePredictiveInsights';
import { HeatMap } from '../components/HeatMap';
import { SnackbarProvider, useSnackbar } from 'notistack';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import {
    AppBar,
    Toolbar,
    IconButton,
    Badge,
    Menu,
    MenuItem,
    ListItemIcon,
    ListItemText,
    Typography,
    Switch,
    CircularProgress,
    Tooltip,
    Divider,
} from '@material-ui/core';
import NotificationsIcon from '@material-ui/icons/Notifications';
import CheckIcon from '@material-ui/icons/Check';
import ClearAllIcon from '@material-ui/icons/ClearAll';
import PriorityHighIcon from '@material-ui/icons/PriorityHigh';
import { NotificationsContext } from '../context/NotificationsContext';
import { fetchNotifications, markAsRead, clearNotifications } from '../api/notifications';
import * as Sentry from '@sentry/react';

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
    },
    title: {
        flexGrow: 1,
    },
    notificationMenu: {
        width: 400,
        maxHeight: 500,
        overflow: 'auto',
    },
    notificationItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing(1),
    },
    notificationText: {
        flexGrow: 1,
        maxWidth: '75%',
    },
    notificationIcon: {
        marginRight: theme.spacing(2),
    },
    notificationContainer: {
        display: 'flex',
        alignItems: 'center',
    },
    menuLoading: {
        textAlign: 'center',
        padding: theme.spacing(2),
    },
    highPriorityNotification: {
        backgroundColor: theme.palette.error.light,
        color: theme.palette.error.contrastText,
    },
    darkModeSwitch: {
        marginRight: theme.spacing(2),
    },
}));

const NotificationBar = () => {
    const classes = useStyles();
    const theme = useTheme();
    const { enqueueSnackbar } = useSnackbar();
    const { notifications, setNotifications } = useContext(NotificationsContext);
    const [anchorEl, setAnchorEl] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [darkMode, setDarkMode] = useState(() => JSON.parse(localStorage.getItem('darkMode')) || false);
    const { recordMetric } = usePrometheusMetrics();
    const { predictNotificationPriority } = usePredictiveInsights();
    const { enforceCsrfProtection } = useCsrf();
    const { limitRate } = useRateLimiting();

    // WebSocket Integration for Real-Time Updates
    useWebSocketManager((notification) => {
        const enrichedNotification = {
            ...notification,
            priority: predictNotificationPriority(notification), // AI-driven priority prediction
        };
        setNotifications((prev) => [...prev, enrichedNotification]);
        enqueueSnackbar(enrichedNotification.message, {
            variant: enrichedNotification.priority,
            preventDuplicate: true,
        });
        recordMetric('notification_received', 1);
    });

    // Twitch Integration
    useTwitchIntegration((twitchData) => {
        const twitchNotification = {
            message: `Twitch update: ${twitchData.message}`,
            type: 'twitch',
            priority: 'info',
            timestamp: new Date().toISOString(),
        };
        setNotifications((prev) => [...prev, twitchNotification]);
    });

    // Twitch Chat Commands Integration
    useTwitchChatCommands((command, args) => {
        const chatNotification = {
            message: `Twitch Command: ${command} with args: ${args}`,
            type: 'twitchChat',
            priority: 'low',
            timestamp: new Date().toISOString(),
        };
        setNotifications((prev) => [...prev, chatNotification]);
        enqueueSnackbar(chatNotification.message, { variant: 'info' });
    });

    // Fetch Notifications on Load
    useEffect(() => {
        setLoading(true);
        fetchNotifications()
            .then((data) => {
                const enrichedNotifications = data.map((notification) => ({
                    ...notification,
                    priority: predictNotificationPriority(notification), // AI-driven priority prediction
                }));
                setNotifications(enrichedNotifications);
                setUnreadCount(enrichedNotifications.filter((n) => !n.read).length);
                setLoading(false);
            })
            .catch((error) => {
                enqueueSnackbar('Failed to load notifications', { variant: 'error' });
                Sentry.captureException(error);
                setLoading(false);
            });
    }, [enqueueSnackbar, predictNotificationPriority, setNotifications]);

    // Handle Dark Mode Toggle
    const handleDarkModeToggle = () => {
        const newDarkMode = !darkMode;
        setDarkMode(newDarkMode);
        localStorage.setItem('darkMode', JSON.stringify(newDarkMode));
    };

    // Menu Actions
    const handleMenuOpen = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleMarkAsRead = useCallback((id) => {
        limitRate(() => {
            markAsRead(id).then(() => {
                setNotifications((prev) =>
                    prev.map((n) => (n.id === id ? { ...n, read: true } : n))
                );
                setUnreadCount((prev) => prev - 1);
                recordMetric('notification_mark_as_read', 1);
            }).catch((error) => {
                enqueueSnackbar('Failed to mark as read', { variant: 'error' });
                Sentry.captureException(error);
            });
        });
    }, [limitRate, enqueueSnackbar, setNotifications, recordMetric]);

    const handleClearNotifications = () => {
        enforceCsrfProtection(() => {
            clearNotifications().then(() => {
                setNotifications([]);
                setUnreadCount(0);
                recordMetric('notifications_cleared', 1);
            }).catch((error) => {
                enqueueSnackbar('Failed to clear notifications', { variant: 'error' });
                Sentry.captureException(error);
            });
        });
    };

    // Real-Time Visualization: Heatmap of Notification Types
    const notificationHeatmap = useMemo(() => {
        const data = notifications.map((n) => n.priority);
        const heatmapData = data.reduce((acc, curr) => {
            acc[curr] = (acc[curr] || 0) + 1;
            return acc;
        }, {});
        return <HeatMap data={Object.entries(heatmapData)} />;
    }, [notifications]);

    return (
        <div className={classes.root}>
            <AppBar position="static">
                <Toolbar>
                    <Typography variant="h6" className={classes.title}>
                        QuikHit Notifications
                    </Typography>
                    <Tooltip title="Notifications">
                        <IconButton color="inherit" onClick={handleMenuOpen}>
                            <Badge badgeContent={unreadCount} color="secondary">
                                <NotificationsIcon />
                            </Badge>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Dark Mode">
                        <Switch
                            checked={darkMode}
                            onChange={handleDarkModeToggle}
                            className={classes.darkModeSwitch}
                        />
                    </Tooltip>
                    <Menu
                        anchorEl={anchorEl}
                        keepMounted
                        open={Boolean(anchorEl)}
                        onClose={handleMenuClose}
                        className={classes.notificationMenu}
                    >
                        {loading ? (
                            <div className={classes.menuLoading}>
                                <CircularProgress />
                            </div>
                        ) : notifications.length > 0 ? (
                            notifications.map((notification) => (
                                <MenuItem
                                    key={notification.id}
                                    className={`${classes.notificationItem} ${
                                        notification.priority === 'high' ? classes.highPriorityNotification : ''
                                    }`}
                                >
                                    <div className={classes.notificationContainer}>
                                        <ListItemIcon className={classes.notificationIcon}>
                                            {notification.priority === 'high' ? <PriorityHighIcon /> : <NotificationsIcon />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={notification.message}
                                            secondary={new Date(notification.timestamp).toLocaleString()}
                                            className={classes.notificationText}
                                        />
                                    </div>
                                    <Tooltip title="Mark as Read">
                                        <IconButton onClick={() => handleMarkAsRead(notification.id)}>
                                            <CheckIcon />
                                        </IconButton>
                                    </Tooltip>
                                </MenuItem>
                            ))
                        ) : (
                            <MenuItem>No notifications</MenuItem>
                        )}
                        <Divider />
                        <MenuItem onClick={handleClearNotifications}>
                            <ListItemIcon>
                                <ClearAllIcon />
                            </ListItemIcon>
                            <ListItemText primary="Clear All" />
                        </MenuItem>
                    </Menu>
                </Toolbar>
            </AppBar>
            <div style={{ padding: '1rem' }}>
                <Typography variant="h6">Notification Heatmap</Typography>
                {notificationHeatmap}
            </div>
        </div>
    );
};

const NotificationBarWithProviders = () => (
    <SnackbarProvider maxSnack={3}>
        <NotificationBar />
    </SnackbarProvider>
);

export default NotificationBarWithProviders;