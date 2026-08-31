import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";

import {
    reportTenantIsolationViolation,
    resetTenantIsolationSentryDedup,
    resetTenantIsolationStats,
    type ReportViolationParams,
} from "./tenant-isolation.reporter";

jest.mock("@sentry/nestjs", () => ({
    withScope: (fn: (scope: unknown) => void) =>
        fn({
            setLevel: jest.fn(),
            setTag: jest.fn(),
            setContext: jest.fn(),
        }),
    captureMessage: jest.fn(),
}));

const captureMessage = Sentry.captureMessage as jest.Mock;

function violation(overrides: Partial<ReportViolationParams> = {}): ReportViolationParams {
    return {
        kind: "cross_branch_read",
        model: "message_log",
        action: "findMany",
        expectedBranchId: "b1",
        mode: "observe",
        ...overrides,
    };
}

beforeEach(() => {
    resetTenantIsolationStats();
    resetTenantIsolationSentryDedup();
    jest.clearAllMocks();
});

describe("reportTenantIsolationViolation — F1-f: Sentry de-dup window", () => {
    it("the first occurrence for a (kind, model, action) triple always reports to Sentry", () => {
        reportTenantIsolationViolation(violation());
        expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    it("a second occurrence of the SAME (kind, model, action) within the window is suppressed from Sentry", () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        reportTenantIsolationViolation(violation());
        jest.spyOn(Date, "now").mockReturnValue(1_000_000 + 60_000); // 1 minute later, inside 5-min window
        reportTenantIsolationViolation(violation());
        expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    it("logger.warn (structured log) still fires on EVERY occurrence, even while Sentry is deduped", () => {
        const loggerWarnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        try {
            jest.spyOn(Date, "now").mockReturnValue(2_000_000);
            reportTenantIsolationViolation(violation());
            jest.spyOn(Date, "now").mockReturnValue(2_000_000 + 1_000);
            reportTenantIsolationViolation(violation());
            expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
            expect(captureMessage).toHaveBeenCalledTimes(1);
        } finally {
            loggerWarnSpy.mockRestore();
        }
    });

    it("an occurrence AFTER the window elapses reports to Sentry again", () => {
        jest.spyOn(Date, "now").mockReturnValue(3_000_000);
        reportTenantIsolationViolation(violation());
        jest.spyOn(Date, "now").mockReturnValue(3_000_000 + 5 * 60 * 1000); // exactly 5 minutes later
        reportTenantIsolationViolation(violation());
        expect(captureMessage).toHaveBeenCalledTimes(2);
    });

    it("different (kind, model, action) triples get independent de-dup windows", () => {
        jest.spyOn(Date, "now").mockReturnValue(4_000_000);
        reportTenantIsolationViolation(violation({ kind: "cross_branch_read" }));
        reportTenantIsolationViolation(violation({ kind: "unpinned_write" }));
        reportTenantIsolationViolation(violation({ model: "message" }));
        reportTenantIsolationViolation(violation({ action: "updateMany" }));
        expect(captureMessage).toHaveBeenCalledTimes(4);
    });

    it("resetTenantIsolationSentryDedup() clears the window, so the very next call always reports", () => {
        jest.spyOn(Date, "now").mockReturnValue(5_000_000);
        reportTenantIsolationViolation(violation());
        resetTenantIsolationSentryDedup();
        jest.spyOn(Date, "now").mockReturnValue(5_000_001); // 1ms later — would be deduped without the reset
        reportTenantIsolationViolation(violation());
        expect(captureMessage).toHaveBeenCalledTimes(2);
    });
});
