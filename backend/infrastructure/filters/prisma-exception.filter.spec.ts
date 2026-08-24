import { Prisma } from "@prisma/client";
import type { ArgumentsHost } from "@nestjs/common";

const mockScope = {
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn((error: unknown) => {
    void error;
    return "event-id";
});

jest.mock("@sentry/nestjs", () => ({
    withScope: (callback: (scope: typeof mockScope) => unknown) => callback(mockScope),
    captureException: (error: unknown) => mockCaptureException(error),
}));

import { PrismaExceptionFilter } from "./prisma-exception.filter";

interface MockResponse {
    status: jest.Mock;
    json: jest.Mock;
}

function createHost(path = "/clients"): { host: ArgumentsHost; response: MockResponse } {
    const response: MockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
    };
    const request = { originalUrl: path, url: path };
    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => request,
        }),
    } as unknown as ArgumentsHost;

    return { host, response };
}

function knownError(code: string, message = "database failure"): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(message, {
        code,
        clientVersion: "6.19.1",
    });
}

describe("PrismaExceptionFilter database failover telemetry", () => {
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        process.env["DATABASE_CONNECTION_MODE"] = "shared";
        process.env["SENTRY_ENVIRONMENT"] = "production";
        jest.clearAllMocks();
        consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleError.mockRestore();
        delete process.env["DATABASE_CONNECTION_MODE"];
        delete process.env["SENTRY_ENVIRONMENT"];
    });

    it.each(["P1001", "P1017"])("captures %s as failover eligible on every API path", (code) => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/auth/login");
        const rawMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";

        filter.catch(knownError(code, rawMessage), host);

        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.json).toHaveBeenCalledWith({
            statusCode: 503,
            code,
            error: "Service Unavailable",
        });
        expect(mockScope.setTag).toHaveBeenCalledWith("environment", "production");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.route", "shared");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "true");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", code);
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException.mock.calls[0]?.[0]).toMatchObject({
            message: "Database connectivity failure",
        });
        expect(JSON.stringify(mockScope.setTag.mock.calls)).not.toContain(rawMessage);
        expect(consoleError).toHaveBeenCalledWith(`[PrismaException] Code: ${code}, Field: N/A`);
    });

    it.each(["P2024", "P2002"])("captures %s as explicitly ineligible without raw details", (code) => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/clients");
        const rawMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";

        filter.catch(knownError(code, rawMessage), host);

        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "false");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", code);
        expect(JSON.stringify(mockScope.setTag.mock.calls)).not.toContain(rawMessage);
        expect(response.json.mock.calls[0]?.[0]).not.toHaveProperty("message");
    });

    it("captures Prisma errors without a code as ineligible instead of treating them as failover signals", () => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost();
        const exception = new Prisma.PrismaClientValidationError(
            "Invalid query with database password",
            { clientVersion: "6.19.1" },
        );

        filter.catch(exception, host);

        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "false");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", "unknown");
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({
            statusCode: 500,
            code: null,
            error: "Internal Server Error",
        });
    });

    it("keeps existing service-record capture while adding database taxonomy", () => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/service-record/context");

        filter.catch(knownError("P1017"), host);

        expect(response.status).toHaveBeenCalledWith(503);
        expect(mockCaptureException).toHaveBeenCalledTimes(2);
        expect(mockScope.setTag).toHaveBeenCalledWith("feature", "database-failover");
        expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    });
});
