import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchUserRoles, logUserInteraction, useWebSocket } from '../api';
import { getRecommendations } from '../utils/ai';
import styles from './Sidebar.module.css';

const Sidebar = ({ isCollapsed, onToggle, additionalItems }) => {
    const [menuItems, setMenuItems] = useState([]);
    const [notifications, setNotifications] = useState({});
    const [recommendations, setRecommendations] = useState([]);
    const darkMode = useSelector(state => state.ui.darkMode);
    const location = useLocation();
    const { t } = useTranslation();
    const dispatch = useDispatch();

    useEffect(() => {
        const fetchRoles = async () => {
            try {
                const roles = await fetchUserRoles();
                setMenuItems(generateMenuItems(roles));
            } catch (error) {
                console.error('Error fetching roles:', error);
                setMenuItems(generateMenuItems([])); // Fallback to a default menu
            }
        };

        const fetchRecommendations = async () => {
            try {
                const recs = await getRecommendations();
                setRecommendations(recs);
            } catch (error) {
                console.error('Error fetching recommendations:', error);
                setRecommendations([]); // Fallback to no recommendations
            }
        };

        fetchRoles();
        fetchRecommendations();
    }, []);

    useEffect(() => {
        const fetchDynamicRecommendations = async () => {
            try {
                const userActivity = JSON.parse(localStorage.getItem('userActivity')) || [];
                const recommendations = await getRecommendations(userActivity);
                setRecommendations(recommendations);
            } catch (error) {
                console.error('Error fetching dynamic recommendations:', error);
                setRecommendations([]); // Fallback to no recommendations
            }
        };
        fetchDynamicRecommendations();
    }, []);

    useEffect(() => {
        const cachedNotifications = JSON.parse(localStorage.getItem('notifications')) || {};
        setNotifications(cachedNotifications);
    }, []);

    useWebSocket('ws://notifications', (message) => {
        if (typeof message === 'object' && message !== null) {
            setNotifications(prev => {
                const updatedNotifications = { ...prev, ...message };
                localStorage.setItem('notifications', JSON.stringify(updatedNotifications));
                return updatedNotifications;
            });
        }
    });

    const generateMenuItems = (roles) => {
        const items = [
            { name: 'Dashboard', path: '/dashboard' },
            { name: 'Campaigns', path: '/campaigns' },
            { name: 'Analytics', path: '/analytics' },
        ];

        if (roles.includes('admin')) {
            items.push({ name: 'Admin Panel', path: '/admin' });
        }

        return items;
    };

    const handleItemClick = (path) => {
        logUserInteraction(path);
        // Navigate to the path
    };

    return (
        <div className={`${styles.sidebar} ${darkMode ? styles.dark : ''} ${isCollapsed ? styles.collapsed : ''}`}>
            <button onClick={onToggle} aria-label={t('toggleSidebar')}>
                {isCollapsed ? '>' : '<'}
            </button>
            <ul role="menu">
                {menuItems.map(item => (
                    <li key={item.path} role="menuitem" className={location.pathname === item.path ? styles.active : ''}>
                        <a href={item.path} onClick={() => handleItemClick(item.path)}>
                            {t(item.name)}
                            {notifications[item.path] && <span className={styles.badge}>{notifications[item.path]}</span>}
                        </a>
                    </li>
                ))}
                {recommendations.map(rec => (
                    <li key={rec.path} role="menuitem">
                        <a href={rec.path} onClick={() => handleItemClick(rec.path)}>
                            {t(rec.name)}
                        </a>
                    </li>
                ))}
                {additionalItems && additionalItems.map(item => (
                    <li key={item.path} role="menuitem">
                        <a href={item.path} onClick={() => handleItemClick(item.path)}>
                            {t(item.name)}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
};

Sidebar.propTypes = {
    isCollapsed: PropTypes.bool,
    onToggle: PropTypes.func.isRequired,
    additionalItems: PropTypes.arrayOf(PropTypes.shape({
        name: PropTypes.string.isRequired,
        path: PropTypes.string.isRequired,
    })),
};

export default Sidebar;