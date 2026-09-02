import {
    CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS,
    evaluateAutoFinalize,
} from "application/services/contract-auto-finalize.policy";

describe("evaluateAutoFinalize", () => {
    const context = { sinceDate: "2026-08-08", todayKst: "2026-08-10" };

    function verdict(
        contractEndDate: string | null,
        attempts = 0,
        ctx: { sinceDate: string; todayKst: string; graceDays?: number; maxAttempts?: number } = context,
    ) {
        return evaluateAutoFinalize(
            { contractEndDate, autoFinalizeAttempts: attempts },
            ctx,
        );
    }

    it("is due on the end date for the 17:00 KST run", () => {
        expect(verdict("2026-08-10")).toEqual({ eligible: true });
    });

    it("catches up a contract whose end-date run was missed", () => {
        expect(verdict("2026-08-09")).toEqual({ eligible: true });
    });

    it("is not due for a future end date", () => {
        expect(verdict("2026-08-11")).toEqual({
            eligible: false,
            reason: "end-date-not-passed",
        });
    });

    it("fences out contracts that ended before the activation date", () => {
        expect(verdict("2026-08-07")).toEqual({
            eligible: false,
            reason: "before-activation",
        });
    });

    it("includes a contract ending exactly on the activation date", () => {
        expect(verdict("2026-08-08")).toEqual({ eligible: true });
    });

    it("skips contracts without a recoverable end date", () => {
        expect(verdict(null)).toEqual({ eligible: false, reason: "no-end-date" });
    });

    it("rejects a malformed end date rather than comparing it as a string", () => {
        expect(verdict("09/08/2026")).toEqual({ eligible: false, reason: "no-end-date" });
    });

    it("excludes contracts that exhausted their retry budget", () => {
        expect(verdict("2026-08-09", CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS)).toEqual({
            eligible: false,
            reason: "attempts-exhausted",
        });
    });

    it("keeps retrying below the budget", () => {
        expect(verdict("2026-08-09", CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS - 1)).toEqual({
            eligible: true,
        });
    });

    it("waits until the grace period has passed", () => {
        expect(verdict("2026-08-10", 0, { ...context, todayKst: "2026-08-11", graceDays: 2 })).toEqual({
            eligible: false,
            reason: "end-date-not-passed",
        });
        expect(verdict("2026-08-10", 0, { ...context, todayKst: "2026-08-12", graceDays: 2 })).toEqual({ eligible: true });
    });

    it("uses a branch-specific attempt budget", () => {
        expect(verdict("2026-08-09", 1, { ...context, maxAttempts: 1 })).toEqual({
            eligible: false,
            reason: "attempts-exhausted",
        });
    });
});
