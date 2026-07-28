import axios from "axios";

import { captureAndFlushApiError } from "@/lib/observability/capture-api-error";
import { resolveServerApiUrl } from "@/lib/api/server-base-url";

const API_URL = resolveServerApiUrl();

export const serverAPIClient = axios.create({
    baseURL: API_URL,
    proxy: false,
    timeout: 60000,
    validateStatus: (status) => status < 400,
    headers: {
        "Content-Type": "application/json",
    },
});

serverAPIClient.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
        await captureAndFlushApiError(error);
        return Promise.reject(error);
    },
);
