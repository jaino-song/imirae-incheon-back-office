import axios from "axios";
import type { AxiosError, AxiosRequestConfig } from "axios";
import { resetAuthorityState } from "@/lib/auth/authority-state";

type AxiosMockInternals = {
    requestInterceptorUse: jest.Mock;
    responseInterceptorUse: jest.Mock;
    apiPost: jest.Mock;
    barePost: jest.Mock;
};
type AxiosFunctionMock = jest.Mock & {
    create: jest.Mock;
    post: jest.Mock;
    __mockApi: AxiosMockInternals;
};

jest.mock("axios", () => {
    const requestInterceptorUse = jest.fn();
    const responseInterceptorUse = jest.fn();
    const apiPost = jest.fn();
    const barePost = jest.fn();
    const mockAxios = jest.fn() as AxiosFunctionMock;
    mockAxios.post = barePost;
    mockAxios.create = jest.fn(() => ({
        interceptors: {
            request: { use: requestInterceptorUse },
            response: { use: responseInterceptorUse },
        },
        post: apiPost,
    }));
    mockAxios.__mockApi = {
        requestInterceptorUse,
        responseInterceptorUse,
        apiPost,
        barePost,
    };

    return {
        __esModule: true,
        default: mockAxios,
    };
});

jest.mock("@/lib/auth/authority-state", () => ({
    resetAuthorityState: jest.fn(),
}));

import "../client";

type RetryableRequestConfig = AxiosRequestConfig & {
    _retry?: boolean;
    _appAuthRetry?: boolean;
};
const mockAxios = axios as unknown as AxiosFunctionMock;
const mockResetAuthorityState = jest.mocked(resetAuthorityState);

function getResponseRejectedHandler(): (err: AxiosError) => Promise<unknown> {
    const rejectedHandler = mockAxios.__mockApi.responseInterceptorUse.mock.calls[0]?.[1];
    if (!rejectedHandler) {
        throw new Error("Response interceptor was not registered");
    }
    return rejectedHandler as (err: AxiosError) => Promise<unknown>;
}

function createNetworkError(config: RetryableRequestConfig): AxiosError {
    return {
        name: "AxiosError",
        message: "Network Error",
        config,
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

function createUnauthorizedError(config: RetryableRequestConfig): AxiosError {
    return {
        name: "AxiosError",
        message: "Request failed with status code 401",
        config,
        response: {
            status: 401,
            data: { error: "Unauthorized" },
        },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

function createUnauthorizedErrorWithMessage(
    config: RetryableRequestConfig,
    errorMessage: string,
): AxiosError {
    return {
        name: "AxiosError",
        message: "Request failed with status code 401",
        config,
        response: {
            status: 401,
            data: { error: errorMessage },
        },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

function createResponseError(
    config: RetryableRequestConfig,
    status: number,
): AxiosError {
    return {
        name: "AxiosError",
        message: `Request failed with status code ${status}`,
        config,
        response: {
            status,
            data: { error: `Upstream returned ${status}` },
        },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

describe("api client network retry", () => {
    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset();
        window.history.replaceState({}, "", "/login");
    });

    it("should retry GET network errors exactly once", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/clients",
        };

        await getResponseRejectedHandler()(createNetworkError(originalRequest));

        expect(originalRequest._retry).toBe(true);
        expect(mockAxios).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("should not retry POST network errors", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/message-trigger-rules",
        };
        const error = createNetworkError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(originalRequest._retry).toBeUndefined();
        expect(mockAxios).not.toHaveBeenCalled();
    });

    it("should not retry PATCH network errors", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "PATCH",
            url: "/message-trigger-rules/rule-1",
        };
        const error = createNetworkError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(originalRequest._retry).toBeUndefined();
        expect(mockAxios).not.toHaveBeenCalled();
    });
});

describe("api client app-session refresh", () => {
    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset();
        mockResetAuthorityState.mockReset();
        window.history.replaceState({}, "", "/login");
    });

    it("refreshes once and retries the original non-eformsign request", async () => {
        mockAxios.__mockApi.barePost.mockResolvedValue({ data: { success: true } });
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/message-logs",
        };

        await getResponseRejectedHandler()(createUnauthorizedError(originalRequest));

        expect(originalRequest._appAuthRetry).toBe(true);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledWith(
            "/api/auth/refresh",
            undefined,
            { withCredentials: true },
        );
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("shares one refresh across concurrent 401 responses and retries both originals", async () => {
        let resolveRefresh: (() => void) | undefined;
        mockAxios.__mockApi.barePost.mockImplementation(
            () => new Promise((resolve) => {
                resolveRefresh = () => resolve({ data: { success: true } });
            }),
        );
        const firstRequest: RetryableRequestConfig = { method: "GET", url: "/clients" };
        const secondRequest: RetryableRequestConfig = { method: "GET", url: "/message-logs" };

        const first = getResponseRejectedHandler()(createUnauthorizedError(firstRequest));
        const second = getResponseRejectedHandler()(createUnauthorizedError(secondRequest));
        resolveRefresh?.();
        await Promise.all([first, second]);

        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledTimes(2);
        expect(mockAxios).toHaveBeenCalledWith(firstRequest);
        expect(mockAxios).toHaveBeenCalledWith(secondRequest);
    });

    it("does not start another refresh after the retried request returns 401", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/message-logs",
            _appAuthRetry: true,
        };
        const error = createUnauthorizedError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(mockAxios.__mockApi.barePost).not.toHaveBeenCalled();
        expect(mockAxios).not.toHaveBeenCalled();
    });

    it("settles the initiating 401 while redirect reset skips its own cancellation", async () => {
        let resolveReset: (() => void) | undefined;
        mockResetAuthorityState.mockImplementation((_client, options) => {
            if (options?.waitForCancellation === false) {
                return new Promise<void>((resolve) => {
                    resolveReset = resolve;
                });
            }
            return new Promise<void>(() => undefined);
        });
        const refreshError = createUnauthorizedError({
            method: "POST",
            url: "/api/auth/refresh",
        });
        mockAxios.__mockApi.barePost.mockRejectedValue(refreshError);
        window.history.replaceState({}, "", "/dashboard");

        const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
        const location = { pathname: "/dashboard", href: "http://localhost/dashboard" };
        Object.defineProperty(window, "location", {
            configurable: true,
            value: location,
        });

        try {
            const originalRequest: RetryableRequestConfig = {
                method: "GET",
                url: "/clients",
            };
            const request = getResponseRejectedHandler()(createUnauthorizedError(originalRequest));
            const pendingOutcome = await Promise.race([
                request.then(() => "resolved", () => "rejected"),
                new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 100)),
            ]);

            expect(pendingOutcome).toBe("timed out");
            expect(mockResetAuthorityState).toHaveBeenCalledWith(
                undefined,
                { waitForCancellation: false },
            );
            expect(location.href).toBe("http://localhost/dashboard");

            resolveReset?.();
            await expect(request).rejects.toBe(refreshError);
            expect(location.href).toBe("/login");
        } finally {
            resolveReset?.();
            if (originalLocation) {
                Object.defineProperty(window, "location", originalLocation);
            }
        }
    });
});

describe("api client eformsign refresh failure classification", () => {
    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.apiPost.mockReset();
        mockAxios.__mockApi.barePost.mockReset();
        window.history.replaceState({}, "", "/login");
    });

    it("rejects a vendor-flavored refresh failure without starting an app-session refresh", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/refresh-access-token",
        };
        const error = createUnauthorizedErrorWithMessage(
            originalRequest,
            "Failed to refresh token: 401 - Authentication required by upstream gateway",
        );

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(mockAxios.__mockApi.barePost).not.toHaveBeenCalled();
        expect(mockAxios).not.toHaveBeenCalled();
    });

    it("falls back to app-session refresh when the app's own auth check rejects the refresh request", async () => {
        mockAxios.__mockApi.barePost.mockResolvedValue({ data: { success: true } });
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/refresh-access-token",
        };
        const error = createUnauthorizedErrorWithMessage(
            originalRequest,
            "Authentication required. Please log in.",
        );

        await getResponseRejectedHandler()(error);

        expect(originalRequest._appAuthRetry).toBe(true);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("authenticates from configured credentials and retries once when provider refresh returns 400", async () => {
        const refreshError = createResponseError(
            { method: "POST", url: "/refresh-access-token" },
            400,
        );
        mockAxios.__mockApi.apiPost
            .mockRejectedValueOnce(refreshError)
            .mockResolvedValueOnce({ data: { success: true } });
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/eformsign/documents/document-1/re-request",
        };

        await getResponseRejectedHandler()(createUnauthorizedError(originalRequest));

        expect(mockAxios.__mockApi.apiPost).toHaveBeenCalledTimes(2);
        expect(mockAxios.__mockApi.apiPost.mock.calls[0]?.[0]).toBe("/refresh-access-token");
        expect(mockAxios.__mockApi.apiPost.mock.calls[1]?.[0]).toBe("/access-token");
        expect(mockAxios).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("does not replay the original request when provider refresh and credential authentication both fail", async () => {
        const refreshError = createResponseError(
            { method: "POST", url: "/refresh-access-token" },
            400,
        );
        const authenticationError = createResponseError(
            { method: "POST", url: "/access-token" },
            503,
        );
        mockAxios.__mockApi.apiPost
            .mockRejectedValueOnce(refreshError)
            .mockRejectedValueOnce(authenticationError);
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/eformsign/documents/document-1/re-request",
        };

        await expect(
            getResponseRejectedHandler()(createUnauthorizedError(originalRequest)),
        ).rejects.toBe(authenticationError);

        expect(mockAxios.__mockApi.apiPost).toHaveBeenCalledTimes(2);
        expect(mockAxios).not.toHaveBeenCalled();
    });

    it("shares one credential authentication across concurrent eformsign 401 responses", async () => {
        const refreshError = createResponseError(
            { method: "POST", url: "/refresh-access-token" },
            400,
        );
        let rejectRefresh: ((reason: AxiosError) => void) | undefined;
        mockAxios.__mockApi.apiPost
            .mockImplementationOnce(
                () => new Promise((_, reject) => {
                    rejectRefresh = reject;
                }),
            )
            .mockResolvedValueOnce({ data: { success: true } });
        const firstRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/eformsign/documents/document-1/re-request",
        };
        const secondRequest: RetryableRequestConfig = {
            method: "DELETE",
            url: "/eformsign/documents/document-2",
        };

        const first = getResponseRejectedHandler()(createUnauthorizedError(firstRequest));
        const second = getResponseRejectedHandler()(createUnauthorizedError(secondRequest));
        rejectRefresh?.(refreshError);
        await Promise.all([first, second]);

        expect(mockAxios.__mockApi.apiPost).toHaveBeenCalledTimes(2);
        expect(mockAxios.__mockApi.apiPost.mock.calls[1]?.[0]).toBe("/access-token");
        expect(mockAxios).toHaveBeenCalledTimes(2);
        expect(mockAxios).toHaveBeenCalledWith(firstRequest);
        expect(mockAxios).toHaveBeenCalledWith(secondRequest);
    });
});
