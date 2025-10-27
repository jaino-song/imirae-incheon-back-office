import axios, { AxiosError, AxiosRequestConfig } from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
});

// Request Interceptor
// Runs before each request.
// Retrieves a JWT token from localStorage.
// If present, attaches it as an Authorization header.
// This ensures every request is authenticated automatically.
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (err: AxiosError) => {
        Promise.reject(err);
    }
);

// Response Interceptor
// Runs after each response
// If a network error occurs, it retries the same request once
// When the server returns a 401 (expired or invalid token), it redirects the user to the login page
api.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
        const originalRequest = err.config as AxiosRequestConfig & { _retry?: boolean };

        // Auto-retry on network errors
        if (err.message === 'Network Error' && !originalRequest._retry) {
            originalRequest._retry = true;
            return axios(originalRequest);
        }

        // Handle token expiration
        if (err.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            // Redirect to login page
            window.location.href = "/login";
        }
        return Promise.reject(err);
    }
);