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
    captureBackendError,
    capturePrismaError,
    captureServiceRecordError,
    filterAndSanitizeSentryEvent,
    getSentryOptions,
    sanitizeSentryUrl,
} from "./service-record-sentry";
import { ServiceRecordSentryExceptionFilter } from "./service-record-sentry-exception.filter";

const rawDatabaseSecret = "postgresql://user:password@db.example.test:5432/app?secret=value";

describe("service-record backend Sentry contract", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keeps actionable 5xx failures and drops expected 4xx failures", () => {
        const serviceRecordEvent: ErrorEvent = {
            type: undefined,
            tags: { feature: "service-records", operation: "context" },
            request: { url: "/service-record/context?token=secret" },
        };

        expect(filterAndSanitizeSentryEvent(
            serviceRecordEvent,
            { originalException: new ServiceUnavailableException() },
        )).toMatchObject({
            tags: { feature: "service-records", operation: "context" },
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
            {
                type: undefined,
                message: "backend failure email=person@example.com password=secret",
                tags: {
                    feature: "clients",
                    operation: "list",
                    email: "person@example.com",
                },
                user: { id: "client-1", email: "person@example.com" },
                request: {
                    url: "/clients?email=person@example.com&token=secret",
                    data: { password: "secret", body: "raw request body" },
                    query_string: "email=person@example.com&token=secret",
                    cookies: { session: "secret" },
                    env: { DATABASE_URL: rawDatabaseSecret },
                    headers: {
                        authorization: "Bearer secret",
                        "user-agent": "test",
                    },
                },
                contexts: {
                    request: { phone: "01012345678", detail: "raw detail" },
                },
                extra: { databaseUrl: rawDatabaseSecret },
            },
            { originalException: new ServiceUnavailableException() },
        )).toMatchObject({
            message: "Backend failure",
            tags: { feature: "backend", operation: "list" },
            user: undefined,
            request: {
                url: "/clients",
                data: undefined,
                query_string: undefined,
                cookies: undefined,
                env: undefined,
                headers: {
                    authorization: "[Filtered]",
                    "user-agent": "test",
                },
            },
        });

        const genericResult = filterAndSanitizeSentryEvent(
            {
                type: undefined,
                message: "backend failure email=person@example.com password=secret",
                request: { url: "/clients?email=person@example.com&token=secret" },
            },
            { originalException: new ServiceUnavailableException() },
        );
        expect(JSON.stringify(genericResult)).not.toContain("person@example.com");
        expect(JSON.stringify(genericResult)).not.toContain("password=secret");
        expect(JSON.stringify(genericResult)).not.toContain("db.example.test");
    });

    it("redacts generic exception details while retaining safe stack metadata", () => {
        const result = filterAndSanitizeSentryEvent(
            {
                type: undefined,
                exception: {
                    values: [{
                        type: "Error",
                        value: "password=secret email=person@example.com",
                        stacktrace: {
                            frames: [{
                                filename: "/app/backend/clients.controller.ts",
                                function: "listClients",
                                lineno: 42,
                                vars: { password: "secret", body: "private" },
                            }],
                        },
                    }],
                },
                request: { url: "/clients/77" },
            },
            { originalException: new ServiceUnavailableException() },
        );

        expect(result).not.toBeNull();
        expect(result?.exception?.values?.[0]).toMatchObject({
            value: "Backend failure",
            stacktrace: {
                frames: [{
                    filename: "/app/backend/clients.controller.ts",
                    function: "listClients",
                    lineno: 42,
                    vars: undefined,
                }],
            },
        });
        expect(JSON.stringify(result)).not.toContain("person@example.com");
        expect(JSON.stringify(result)).not.toContain("password=secret");
        expect(JSON.stringify(result)).not.toContain("private");
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

    it("keeps database failover events on unrelated API paths without retaining secrets", () => {
        const rawMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";
        const result = filterAndSanitizeSentryEvent(
            {
                type: undefined,
                message: rawMessage,
                tags: {
                    feature: "database-failover",
                    environment: "production",
                    "db.route": "shared",
                    "db.failover_eligible": "true",
                    "prisma.code": "P1001",
                    "database.host": "db.example.test",
                    "database.message": rawMessage,
                },
                request: {
                    url: "https://db.example.test/api/clients?password=secret",
                    data: { databaseUrl: rawMessage },
                },
                contexts: { database: { host: "db.example.test" } },
                extra: { databaseMessage: rawMessage },
            },
            { originalException: new BadRequestException() },
        );

        expect(result).toMatchObject({
            message: "Database connectivity failure",
            request: undefined,
            contexts: undefined,
            extra: undefined,
        });
        expect(result?.tags).toEqual({
            feature: "database-failover",
            environment: "production",
            "db.route": "shared",
            "db.failover_eligible": "true",
            "prisma.code": "P1001",
        });
        expect(JSON.stringify(result)).not.toContain(rawMessage);
        expect(JSON.stringify(result)).not.toContain("db.example.test");
    });

    it("does not weaken service-record status filtering when event signals overlap", () => {
        expect(filterAndSanitizeSentryEvent(
            {
                type: undefined,
                tags: {
                    feature: "database-failover",
                    "db.failover_eligible": "false",
                    "db.route": "shared",
                    "prisma.code": "P2024",
                },
                request: { url: "/service-record/context" },
            },
            { originalException: new BadRequestException() },
        )).toBeNull();
    });

    it("normalizes database taxonomy tags before retaining a database event", () => {
        const result = filterAndSanitizeSentryEvent({
            type: undefined,
            tags: {
                feature: "database-failover",
                environment: rawDatabaseSecret,
                "db.route": rawDatabaseSecret,
                "db.failover_eligible": "true",
                "prisma.code": rawDatabaseSecret,
            },
        });

        expect(result?.tags).toEqual({
            feature: "database-failover",
            "db.failover_eligible": "true",
            "prisma.code": "unknown",
        });
        expect(JSON.stringify(result)).not.toContain(rawDatabaseSecret);
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

    it("captures a non-service backend failure once with safe taxonomy", () => {
        const error = new Error("private backend details");
        captureBackendError(error, {
            operation: "http",
            handled: false,
            statusCode: 503,
        });
        captureBackendError(error, {
            operation: "different-operation",
            handled: true,
        });

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockScope.setTag).toHaveBeenCalledWith("feature", "backend");
        expect(mockScope.setTag).toHaveBeenCalledWith("operation", "http");
        expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
        expect(mockCaptureException.mock.calls[0]?.[0]).toMatchObject({
            message: "Backend failure",
        });
    });

    it("captures Prisma taxonomy with route and eligibility tags but no raw error details", () => {
        const error = new Error("postgresql://user:password@db.example.test:5432/app?secret=value");
        const previousEnvironment = process.env["SENTRY_ENVIRONMENT"];
        process.env["SENTRY_ENVIRONMENT"] = "dev";

        capturePrismaError(error, {
            code: "P1001",
            eligible: true,
            route: "shared",
        });
        capturePrismaError(error, {
            code: "P1001",
            eligible: true,
            route: "shared",
        });

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockScope.setTag).toHaveBeenCalledWith("environment", "dev");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.route", "shared");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "true");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", "P1001");
        expect(mockCaptureException.mock.calls[0]?.[0]).toMatchObject({
            message: "Database connectivity failure",
        });
        expect(JSON.stringify(mockScope.setTag.mock.calls)).not.toContain("db.example.test");

        if (previousEnvironment === undefined) delete process.env["SENTRY_ENVIRONMENT"];
        else process.env["SENTRY_ENVIRONMENT"] = previousEnvironment;
    });

    it("captures HTTP 5xx through the NestJS exception filter but not expected 4xx", () => {
        const reply = jest.fn();
        const filter = new ServiceRecordSentryExceptionFilter({
            httpAdapter: {
                reply,
                end: jest.fn(),
                isHeadersSent: jest.fn(() => false),
            },
        } as unknown as HttpAdapterHost);
        const serviceRecordHost = {
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

        const genericHost = {
            getType: () => "http",
            getArgByIndex: (index: number) => index === 0
                ? { originalUrl: "/clients", url: "/clients" }
                : {},
            switchToHttp: () => ({
                getRequest: () => ({
                    originalUrl: "/clients",
                    url: "/clients",
                }),
                getResponse: () => ({}),
            }),
        } as unknown as ArgumentsHost;

        filter.catch(new ServiceUnavailableException(), serviceRecordHost);
        filter.catch(new BadRequestException(), serviceRecordHost);
        filter.catch(new ServiceUnavailableException(), genericHost);
        filter.catch(new BadRequestException(), genericHost);

        expect(mockCaptureException).toHaveBeenCalledTimes(2);
        expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
        expect(reply).toHaveBeenCalledTimes(4);
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

        expect(options.tracesSampler?.({
            name: "GET /clients/:id",
            attributes: {},
            inheritOrSampleWith: (rate: number) => rate,
        })).toBe(0.1);

        expect(options.beforeSendTransaction?.({
            type: "transaction",
            transaction: "GET /clients/77?email=person@example.com",
            request: { url: "/clients/77?email=person@example.com" },
        }, {})).toMatchObject({
            transaction: "GET /clients/77",
            request: { url: "/clients/77" },
        });

        expect(options.beforeSendTransaction?.({
            type: "transaction",
            transaction: "GET /clients/77",
            contexts: { response: { status_code: 400 } },
        }, {})).toBeNull();

        if (previousEnvironment === undefined) delete process.env["SENTRY_ENVIRONMENT"];
        else process.env["SENTRY_ENVIRONMENT"] = previousEnvironment;
    });
});
