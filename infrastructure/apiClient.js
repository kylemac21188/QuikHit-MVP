import axios from 'axios';
import { enqueueSnackbar } from 'notistack';

// Create an axios instance
const apiClient = axios.create({
    baseURL: process.env.API_BASE_URL || 'http://localhost:3000/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
    async (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        // Handle 401 Unauthorized
        if (error.response.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            // Refresh token logic here
            const newToken = await refreshAuthToken();
            localStorage.setItem('authToken', newToken);
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
            return apiClient(originalRequest);
        }

        // Handle other errors
        if (!error.response) {
            // Network error
            console.error('Network error - make sure API is running!');
        } else {
            // API-specific errors
            console.error(`API error: ${error.response.status} - ${error.response.data.message}`);
        }

        return Promise.reject(error);
    }
);

// Function to refresh auth token
async function refreshAuthToken() {
    // Implement token refresh logic here
    // Example:
    const response = await axios.post('/auth/refresh-token', {
        token: localStorage.getItem('refreshToken'),
    });
    return response.data.token;
}

// Retry logic for transient failures
// Removed duplicate retryRequest function

export default apiClient;
// Environment configuration
const getBaseUrl = () => {
    switch (process.env.NODE_ENV) {
        case 'production':
            return 'https://api.production.com';
        case 'staging':
            return 'https://api.staging.com';
        default:
            return 'http://localhost:3000/api';
    }
};

apiClient.defaults.baseURL = getBaseUrl();

// Centralized error notification
const notifyError = (message) => {
    enqueueSnackbar(message, { variant: 'error' });
};

// Enhanced retry logic with exponential backoff
const exponentialBackoff = (retryCount) => {
    return new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
};

const retryRequest = async (error) => {
    const { config } = error;
    if (!config || !config.retry) return Promise.reject(error);

    config.retry -= 1;
    await exponentialBackoff(config.retryCount || 1);
    config.retryCount = (config.retryCount || 1) + 1;
    return apiClient(config);
};

apiClient.interceptors.response.use(null, retryRequest);

// Global logging
apiClient.interceptors.request.use((config) => {
    console.log('Request:', config);
    return config;
});

apiClient.interceptors.response.use(
    (response) => {
        console.log('Response:', response);
        return response;
    },
    (error) => {
        console.error('Error:', error);
        notifyError(error.message);
        return Promise.reject(error);
    }
);

// Rate limiting
const rateLimit = (maxRequests, perMilliseconds) => {
    let requests = 0;
    let start = Date.now();

    return (config) => {
        if (Date.now() - start > perMilliseconds) {
            start = Date.now();
            requests = 0;
        }

        if (requests >= maxRequests) {
            return new Promise((resolve) => {
                setTimeout(() => resolve(rateLimit(maxRequests, perMilliseconds)(config)), perMilliseconds - (Date.now() - start));
            });
        }

        requests += 1;
        return config;
    };
};

apiClient.interceptors.request.use(rateLimit(5, 1000));

// Custom headers for advanced use cases
apiClient.interceptors.request.use((config) => {
    const customHeaders = JSON.parse(localStorage.getItem('customHeaders') || '{}');
    config.headers = { ...config.headers, ...customHeaders };
    return config;
});