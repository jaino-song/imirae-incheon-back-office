import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { parse } from "cookie";

import { isPublicAuthPath } from "@/lib/auth/routes";
import { captureApiError } from "@/lib/observability/capture-api-error";
import { safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

const API_BASE_URL = typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DEVELOPMENT_API_BASE_URL)
    : '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    withCredentials: true,
});

// Keep eformsign token refresh and application-session refresh single-flight independently.
let isRefreshing = false;
let isRedirectingToLogin = false;
let appAuthRefreshPromise: Promise<void> | null = null;
let failedQueue: Array<{
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}> = [];

const EFORMSIGN_REFRESH_PATHS = [
    "/access-token",
    "/refresh-access-token",
] as const;

const EFORMSIGN_REQUEST_PATHS = [
    "/eformsign/",
    "/api/eformsign/",
    "/generate-document",
    "/api/generate-document",
    "/generate-staff-document",
    "/api/generate-staff-document",
    "/generate-signature",
    "/api/generate-signature",
] as const;

const APP_AUTH_NON_RETRY_PATHS = [
    "/auth/login",
    "/auth/token",
    "/auth/refresh",
    "/auth/logout",
] as const;

const processQueue = (error: AxiosError | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve();
        }
    });
    failedQueue = [];
};

function getRequestPath(config: AxiosRequestConfig | undefined): string {
    const url = config?.url ?? "";
    if (!url) return "";

    try {
        return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname;
    } catch {
        return url;
    }
}

function isEformsignRefreshPath(pathname: string): boolean {
    return EFORMSIGN_REFRESH_PATHS.some((path) => pathname === path || pathname.endsWith(path));
}

function isEformsignRequestPath(pathname: string): boolean {
    return EFORMSIGN_REQUEST_PATHS.some((path) => pathname === path || pathname.startsWith(path));
}

function isAppAuthNonRetryPath(pathname: string): boolean {
    return APP_AUTH_NON_RETRY_PATHS.some((path) => pathname === path || pathname.endsWith(path));
}

export function refreshAppAuthSession(): Promise<void> {
    if (!appAuthRefreshPromise) {
        appAuthRefreshPromise = axios
            .post("/api/auth/refresh", undefined, { withCredentials: true })
            .then(() => undefined)
            .finally(() => {
                appAuthRefreshPromise = null;
            });
    }
    return appAuthRefreshPromise;
}

function isAppAuthRequiredError(error: AxiosError): boolean {
    const data = error.response?.data;
    if (!data || typeof data !== "object") return false;
    const message = (data as { error?: unknown; message?: unknown }).error
        ?? (data as { error?: unknown; message?: unknown }).message;
    return typeof message === "string" && message.startsWith("Authentication required.");
}

function redirectToLoginOnce() {
    if (typeof window === "undefined" || isRedirectingToLogin) return;
    const currentPath = window.location.pathname;
    const isAuthPage = isPublicAuthPath(currentPath);
    if (isAuthPage) return;

    isRedirectingToLogin = true;
    window.location.href = "/login";
}

api.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        // If the request is made from the server, get the token from the headers
        if (typeof document === "undefined" && config.headers?.cookie) {
            const cookieMap = parse(config.headers.cookie as string);
            const token = cookieMap.auth_token;
            if (token) {
                config.headers = config.headers ?? {};
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (err: AxiosError) => {
        captureApiError(err);
        return Promise.reject(err);
    },
);

api.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
        const originalRequest = err.config as AxiosRequestConfig & {
            _retry?: boolean;
            _appAuthRetry?: boolean;
        };
        const originalRequestMethod = (originalRequest?.method ?? "get").toLowerCase();

        // Network error - single retry
        if (
            err.message === "Network Error" &&
            originalRequest &&
            !originalRequest._retry &&
            (originalRequestMethod === "get" || originalRequestMethod === "head")
        ) {
            originalRequest._retry = true;
            try {
                return await axios(originalRequest);
            } catch (retryError) {
                captureApiError(retryError);
                return Promise.reject(retryError);
            }
        }

        // 401 Unauthorized - refresh the relevant session once, then replay the request.
        if (err.response?.status === 401 && originalRequest && !originalRequest._retry) {
            const requestPath = getRequestPath(originalRequest);
            const isEformsignEndpoint = isEformsignRequestPath(requestPath);
            const isAppAuthFailure = isAppAuthRequiredError(err);
            
            // Don't retry an eformsign refresh failure unless the actual failure
            // is the application's expired login session.
            if (isEformsignRefreshPath(requestPath) && !isAppAuthFailure) {
                return Promise.reject(err);
            }

            // For eformsign endpoints, try token refresh
            if (isEformsignEndpoint && !isAppAuthFailure) {
                if (isRefreshing) {
                    return new Promise((resolve, reject) => {
                        failedQueue.push({ resolve, reject });
                    }).then(() => axios(originalRequest));
                }

                originalRequest._retry = true;
                isRefreshing = true;

                try {
                    const executionTime = Date.now();
                    await api.post('/refresh-access-token', { executionTime });
                    
                    if (typeof window !== 'undefined') {
                        safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
                    }

                    processQueue();
                    return axios(originalRequest);
                } catch (refreshError) {
                    processQueue(refreshError as AxiosError);
                    captureApiError(refreshError);
                    if (typeof window !== 'undefined') {
                        safeStorageRemoveItem("session", "eformsign_auth_time");
                    }
                    // Don't redirect to login for eformsign auth failures
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            }

            if (originalRequest._appAuthRetry || isAppAuthNonRetryPath(requestPath)) {
                redirectToLoginOnce();
                return Promise.reject(err);
            }

            originalRequest._appAuthRetry = true;
            try {
                await refreshAppAuthSession();
                return axios(originalRequest);
            } catch (refreshError) {
                captureApiError(refreshError);
                if ((refreshError as AxiosError | undefined)?.response?.status === 401) {
                    redirectToLoginOnce();
                }
                return Promise.reject(refreshError);
            }
        }

        captureApiError(err);
        return Promise.reject(err);
    }
);
