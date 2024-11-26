import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import PropTypes from 'prop-types';
import { toggleDarkMode } from '../actions';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchUserRoles } from '../api';
import { logUserInteraction } from '../analytics';
import './Navbar.css';
import * as tf from '@tensorflow/tfjs';

const ProfileDropdown = lazy(() => import('./ProfileDropdown'));

const Navbar = () => {
    const { t, i18n } = useTranslation();
    const location = useLocation();
    const dispatch = useDispatch();
    const darkMode = useSelector(state => state.darkMode);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [menuOpen, setMenuOpen] = useState(false);
    const [language, setLanguage] = useState(localStorage.getItem('language') || 'en');
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [userRoles, setUserRoles] = useState([]);
    const [recommendedItems, setRecommendedItems] = useState([]);

    // WebSocket for notifications
    useWebSocket('wss://your-websocket-url', (message) => {
        const newNotification = JSON.parse(message.data);
        setNotifications(prev => [newNotification, ...prev]);
        setUnreadCount(prev => prev + 1);
    });

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        i18n.changeLanguage(language);
        localStorage.setItem('language', language);
    }, [language, i18n]);

    useEffect(() => {
        const fetchRoles = async () => {
            const roles = await fetchUserRoles();
            setUserRoles(roles);
        };
        fetchRoles();
    }, []);

    useEffect(() => {
        // AI Personalization logic (mock implementation)
        const recommendItems = () => {
            const items = userRoles.includes('admin') 
                ? [{ name: 'Admin Panel', link: '/admin' }] 
                : [];
            setRecommendedItems(items);
        };
        recommendItems();
    }, [userRoles]);

    const handleDarkModeToggle = () => {
        dispatch(toggleDarkMode());
        logUserInteraction('darkModeToggle');
    };

    const handleLanguageChange = (lang) => {
        setLanguage(lang);
        logUserInteraction('languageChange', lang);
    };

    const handleMenuToggle = () => {
        setMenuOpen(!menuOpen);
        logUserInteraction('menuToggle');
    };

    const handleMarkAllAsRead = () => {
        setUnreadCount(0);
        logUserInteraction('markAllAsRead');
    };

    return (
        <nav className={`navbar ${darkMode ? 'dark' : 'light'}`} role="navigation">
            <div className="navbar-brand">
                <Link to="/">Brand</Link>
            </div>
            <div className={`navbar-menu ${menuOpen ? 'is-active' : ''}`}>
                <ul className="navbar-links" role="menu">
                    {userRoles.includes('admin') && (
                        <li className={location.pathname === '/admin' ? 'active' : ''} role="menuitem">
                            <Link to="/admin">{t('Admin Panel')}</Link>
                        </li>
                    )}
                    <li className={location.pathname === '/dashboard' ? 'active' : ''} role="menuitem">
                        <Link to="/dashboard">{t('Dashboard')}</Link>
                    </li>
                    {recommendedItems.map((item, index) => (
                        <li key={index} role="menuitem">
                            <Link to={item.link}>{t(item.name)}</Link>
                        </li>
                    ))}
                </ul>
                <div className="navbar-actions">
                    <button onClick={handleDarkModeToggle}>
                        {darkMode ? t('Light Mode') : t('Dark Mode')}
                    </button>
                    <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
                        <option value="en">English</option>
                        <option value="es">Español</option>
                        <option value="fr">Français</option>
                    </select>
                    <div className="navbar-notifications">
                        <button aria-label="Notifications">
                            <span className="notification-bell"></span>
                            {unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
                        </button>
                        <div className="notifications-dropdown">
                            <button onClick={handleMarkAllAsRead}>{t('Mark all as read')}</button>
                            <ul>
                                {notifications.map((notification, index) => (
                                    <li key={index}>{notification.message}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="navbar-profile">
                        <img src="/path/to/profile.jpg" alt="Profile" />
                        <Suspense fallback={<div>{t('Loading...')}</div>}>
                            <ProfileDropdown />
                        </Suspense>
                    </div>
                </div>
            </div>
            {isMobile && (
                <button className="navbar-burger" onClick={handleMenuToggle}>
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
            )}
        </nav>
    );
};

Navbar.propTypes = {
    darkMode: PropTypes.bool,
    toggleDarkMode: PropTypes.func,
};

export default Navbar;
// AI Recommendation Integration
useEffect(() => {
    const recommendItemsAI = async () => {
        try {
            const model = await tf.loadLayersModel('/path/to/recommendation-model.json');
            const inputData = tf.tensor2d([/* User activity data */]); // Replace with dynamic user activity
            const recommendations = model.predict(inputData).arraySync();
            const items = recommendations.map((rec) => ({
                name: rec.name,
                link: rec.link,
                priority: rec.priority,
            })).sort((a, b) => b.priority - a.priority); // Sort by priority
            setRecommendedItems(items);
        } catch (error) {
            console.error('AI recommendation error:', error);
        }
    };
    recommendItemsAI();
}, [userRoles]);
// Activity Tracking Mechanism
const trackUserActivity = (activity) => {
    // Example activity: { type: 'click', page: '/dashboard', duration: 120 }
    const activityData = JSON.parse(localStorage.getItem('userActivity')) || [];
    activityData.push(activity);
    localStorage.setItem('userActivity', JSON.stringify(activityData));
};

// Example usage: trackUserActivity({ type: 'click', page: location.pathname, duration: 120 });
useEffect(() => {
    const handleUserActivity = (event) => {
        trackUserActivity({ type: event.type, page: location.pathname, timestamp: Date.now() });
    };

    window.addEventListener('click', handleUserActivity);
    window.addEventListener('mousemove', handleUserActivity);

    return () => {
        window.removeEventListener('click', handleUserActivity);
        window.removeEventListener('mousemove', handleUserActivity);
    };
}, [location.pathname]);

// Caching AI Recommendations
useEffect(() => {
    const recommendItemsAI = async () => {
        try {
            const cachedRecommendations = localStorage.getItem('aiRecommendations');
            if (cachedRecommendations) {
                setRecommendedItems(JSON.parse(cachedRecommendations));
                return;
            }

            const model = await tf.loadLayersModel('/path/to/recommendation-model.json');
            const activityData = JSON.parse(localStorage.getItem('userActivity')) || [];
            const inputData = tf.tensor2d(activityData.map(a => [a.type, a.page, a.timestamp]));
            const recommendations = model.predict(inputData).arraySync();
            const items = recommendations.map((rec) => ({
                name: rec.name,
                link: rec.link,
                priority: rec.priority,
            })).sort((a, b) => b.priority - a.priority);

            setRecommendedItems(items);
            localStorage.setItem('aiRecommendations', JSON.stringify(items));
        } catch (error) {
            console.error('AI recommendation error:', error);
        }
    };
    recommendItemsAI();
}, [userRoles]);

// PWA Features: Service Worker Registration
useEffect(() => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }
}, []);

// Gamification for Engagement
const [badges, setBadges] = useState([]);
useEffect(() => {
    const userActivity = JSON.parse(localStorage.getItem('userActivity')) || [];
    const newBadges = [];

    if (userActivity.length > 10) {
        newBadges.push('Active User');
    }
    if (userActivity.some(activity => activity.page === '/dashboard')) {
        newBadges.push('Dashboard Explorer');
    }

    setBadges(newBadges);
}, [location.pathname]);

// Analytics-Driven Insights
useEffect(() => {
    const logInteraction = (interaction) => {
        logUserInteraction(interaction.type, interaction.details);
    };

    window.addEventListener('click', (event) => logInteraction({ type: 'click', details: event.target }));
    window.addEventListener('mousemove', (event) => logInteraction({ type: 'mousemove', details: event.target }));

    return () => {
        window.removeEventListener('click', (event) => logInteraction({ type: 'click', details: event.target }));
        window.removeEventListener('mousemove', (event) => logInteraction({ type: 'mousemove', details: event.target }));
    };
}, []);

// Voice Navigation
useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
        const recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            const command = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
            if (command.includes('dashboard')) {
                window.location.href = '/dashboard';
            } else if (command.includes('admin')) {
                window.location.href = '/admin';
            }
        };

        recognition.start();
    }
}, []);