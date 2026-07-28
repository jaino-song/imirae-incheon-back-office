import axios from "axios";

import {
    type BackendUrlEnv,
    EnvValidationError,
    getServerRuntimeConfig,
    resolveServerBackendBaseUrl,
} from "@/lib/env";
import { captureAndFlushServiceRecordError } from "@/lib/observability/capture-service-record-error";

export class BackendBaseUrlConfigError extends Error {
    constructor(message = "Backend API base URL is not configured") {
        super(message);
        this.name = "BackendBaseUrlConfigError";
    }
}

export function resolveBackendBaseUrl(env: BackendUrlEnv = getServerRuntimeConfig().env): string {
    try {
        return resolveServerBackendBaseUrl(env);
    } catch (error) {
        if (error instanceof EnvValidationError) {
            throw new BackendBaseUrlConfigError(error.message);
        }

        throw error;
    }
}

export const BACKEND_BASE_URL = resolveBackendBaseUrl();

export function requireBackendBaseUrl(): string {
    return BACKEND_BASE_URL;
}

export const serverAPIClient = axios.create({
    baseURL: BACKEND_BASE_URL,
    timeout: 60000,
    validateStatus: (status) => status < 400,
    headers: {
        "Content-Type": "application/json",
    },
});

serverAPIClient.interceptors.request.use((config) => {
    config.baseURL = requireBackendBaseUrl();
    return config;
});

serverAPIClient.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
        await captureAndFlushServiceRecordError(error);
        return Promise.reject(error);
    },
);
