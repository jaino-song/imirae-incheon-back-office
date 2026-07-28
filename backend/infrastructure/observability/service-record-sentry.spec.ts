import {
    BadRequestException,
    ServiceUnavailableException,
    type ArgumentsHost,
} from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import type { ErrorEvent } from "@sentry/nestjs";

const mockScope = {
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn((error?: unknown) => {
    void error;
    return "event-id";
});

jest.mock("@sentry/nestjs", () => ({
    withScope: (callback: (scope: typeof mockScope) => unknown) => callback(mockScope),
    captureException: (error: unknown) => mockCaptureException(error),
}));

import {
    captureServiceRecordError,
    filterAndSanitizeSentryEvent,
    getSentryOptions,
    sanitizeSentryUrl,
} from "./service-record-sentry";
import { ServiceRecordSentryExceptionFilter } from "./service-record-sentry-exception.filter";

describe("service-record backend Sentry contract", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keeps service-record 5xx and drops 4xx or unrelated failures", () => {
        const serviceRecordEvent: ErrorEvent = {
            type: undefined,
            request: { url: "/service-record/context?token=secret" },
        };

        expect(filterAndSanitizeSentryEvent(
            serviceRecordEvent,
            { originalException: new ServiceUnavailableException() },
        )).toMatchObject({
            request: {
                url: "/service-record/context",
                data: undefined,
                query_string: undefined,
                cookies: undefined,
            },
        });
        expect(filterAndSanitizeSentryEvent(
            serviceRecordEvent,
            { originalException: new BadRequestException() },
        )).toBeNull();
        expect(filterAndSanitizeSentryEvent(
            { type: undefined, request: { url: "/clients" } },
            { originalException: new ServiceUnavailableException() },
        )).toBeNull();
    });

    it("removes request PII and access tokens from accepted events", () => {
        const result = filterAndSanitizeSentryEvent({
            type: undefined,
            tags: { feature: "service-records" },
            user: { id: "user-1", email: "person@example.com" },
            request: {
                url: "/service-record/link/secret-token/context?phone=01012345678",
                data: { signature: "data:image/png;base64,secret" },
                query_string: "phone=01012345678",
                cookies: { session: "secret" },
                headers: {
                    authorization: "Bearer secret",
                    "user-agent": "test",
                },
            },
        });

        expect(result).toMatchObject({
            user: undefined,
            request: {
                url: "/service-record/link/[Filtered]/context",
                data: undefined,
                query_string: undefined,
                cookies: undefined,
                headers: {
                    authorization: "[Filtered]",
                    "user-agent": "test",
                },
            },
        });
    });

    it("redacts UUID path segments from URLs", () => {
        expect(
            sanitizeSentryUrl(
                "/admin/service-records/client/123e4567-e89b-42d3-a456-426614174000",
            ),
        ).toBe("/admin/service-records/client/[Filtered]");
    });

    it("redacts service-record resource identifiers and transaction paths", () => {
        expect(sanitizeSentryUrl("/admin/service-records/client/77")).toBe(
            "/admin/service-records/client/[Filtered]",
        );
        expect(sanitizeSentryUrl("/admin/service-records/schedules/431/finalize")).toBe(
            "/admin/service-records/schedules/[Filtered]/finalize",
        );
        expect(
            sanitizeSentryUrl("/schedule-change-requests/schedules/431/preview"),
        ).toBe("/schedule-change-requests/schedules/[Filtered]/preview");
        expect(sanitizeSentryUrl("/service-record/link/efl_secret")).toBe(
            "/service-record/link/[Filtered]",
        );
        expect(sanitizeSentryUrl("/service-record/sessions/9/submit")).toBe(
            "/service-record/sessions/[Filtered]/submit",
        );

        expect(filterAndSanitizeSentryEvent({
            type: undefined,
            tags: { feature: "service-records" },
            transaction: "GET /admin/service-records/client/77?expand=schedules",
        })).toMatchObject({
            transaction: "GET /admin/service-records/client/[Filtered]",
        });
    });

    it("captures a handled background failure once with bounded tags and context", () => {
        const error = new Error("snapshot failed");
        captureServiceRecordError(error, {
            operation: "snapshot-create",
            handled: true,
            caseId: "case-1",
            retryCount: 2,
        });
        captureServiceRecordError(error, {
            operation: "auto-finalize",
            handled: true,
        });

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockScope.setTag).toHaveBeenCalledWith("app", "backend");
        expect(mockScope.setTag).toHaveBeenCalledWith("operation", "snapshot-create");
        expect(mockScope.setContext).toHaveBeenCalledWith("serviceRecord", {
            operation: "snapshot-create",
            caseId: "case-1",
            scheduleId: undefined,
            retryCount: 2,
        });
    });

    it("captures only service-record HTTP 5xx through the NestJS exception filter", () => {
        const reply = jest.fn();
        const filter = new ServiceRecordSentryExceptionFilter({
            httpAdapter: {
                reply,
                end: jest.fn(),
                isHeadersSent: jest.fn(() => false),
            },
        } as unknown as HttpAdapterHost);
        const host = {
            getType: () => "http",
            getArgByIndex: (index: number) => index === 0
                ? { originalUrl: "/service-record/context", url: "/service-record/context" }
                : {},
            switchToHttp: () => ({
                getRequest: () => ({
                    originalUrl: "/service-record/context",
                    url: "/service-record/context",
                }),
                getResponse: () => ({}),
            }),
        } as unknown as ArgumentsHost;

        filter.catch(new ServiceUnavailableException(), host);
        filter.catch(new BadRequestException(), host);

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
        expect(reply).toHaveBeenCalledTimes(2);
    });

    it("samples service-record performance at 10 percent in production", () => {
        const previousEnvironment = process.env["SENTRY_ENVIRONMENT"];
        process.env["SENTRY_ENVIRONMENT"] = "production";
        const options = getSentryOptions();

        expect(options.tracesSampler?.({
            name: "POST /service-record/finalize",
            attributes: {},
            inheritOrSampleWith: (rate: number) => rate,
        })).toBe(0.1);

        if (previousEnvironment === undefined) delete process.env["SENTRY_ENVIRONMENT"];
        else process.env["SENTRY_ENVIRONMENT"] = previousEnvironment;
    });
});
