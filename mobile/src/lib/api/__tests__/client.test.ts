import { AxiosError } from "axios";

import { captureServiceRecordError } from "@/lib/observability/capture-service-record-error";

import {
    api,
    isConcurrentAuthRefreshError,
    isEformsignTokenEndpoint,
} from "../client";

jest.mock("@/lib/observability/capture-service-record-error", () => ({
    captureServiceRecordError: jest.fn(),
}));

const mockCaptureServiceRecordError = jest.mocked(captureServiceRecordError);

describe("isEformsignTokenEndpoint", () => {
    it.each([
        "/eformsign/documents",
        "/eformsign/documents/doc-1",
        "/eformsign/documents/doc-1/re-request",
        "/eformsign-docs",
        "/eformsign-docs/client-names",
        "/eformsign-docs/dispatch-headless",
        "/eformsign-docs/finalize-headless",
        "/generate-document",
        "/generate-staff-document",
        "/generate-signature",
        "/access-token",
        "/refresh-access-token",
    ])("classifies %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(true);
    });

    it.each([
        "/auth/login",
        "/auth/refresh",
        "/employees",
        "/file-storage/files",
        "/document-categories",
        undefined,
    ])("does not classify %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(false);
    });
});

describe("isConcurrentAuthRefreshError", () => {
    it("recognizes the retryable BFF refresh response", () => {
        const error = new AxiosError(
            "refresh already in progress",
            "ERR_BAD_RESPONSE",
            {} as never,
            undefined,
            {
                status: 409,
                statusText: "Conflict",
                headers: {},
                config: {} as never,
                data: { code: "AUTH_REFRESH_REPLAY_CONCURRENT" },
            } as never,
        );

        expect(isConcurrentAuthRefreshError(error)).toBe(true);
    });
});

describe("service-record API error monitoring", () => {
    const originalAdapter = api.defaults.adapter;

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
        mockCaptureServiceRecordError.mockReset();
    });

    it("captures a service-record network failure once after the retry is exhausted", async () => {
        const adapter = jest.fn(async (config) => {
            throw new AxiosError("Network Error", "ERR_NETWORK", config);
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/admin/service-records/client/42")).rejects.toMatchObject({
            code: "ERR_NETWORK",
        });

        expect(adapter).toHaveBeenCalledTimes(2);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledTimes(1);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledWith(
            expect.objectContaining({
                code: "ERR_NETWORK",
                config: expect.objectContaining({
                    method: "get",
                    url: "/admin/service-records/client/42",
                }),
            }),
        );
    });

    it("captures a resolved service-record 5xx failure without retrying", async () => {
        const adapter = jest.fn(async (config) => {
            throw new AxiosError(
                "Request failed with status code 503",
                "ERR_BAD_RESPONSE",
                config,
                undefined,
                {
                    status: 503,
                    statusText: "Service Unavailable",
                    headers: {},
                    config,
                    data: {},
                },
            );
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/admin/service-records/client/42")).rejects.toMatchObject({
            response: expect.objectContaining({ status: 503 }),
        });

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledTimes(1);
    });
});
