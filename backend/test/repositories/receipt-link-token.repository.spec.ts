import { PrismaService } from "infrastructure/database/prisma.service";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";

jest.mock("infrastructure/tenant/run-system-scope", () => ({
    runSystemScope: jest.fn((fn: () => unknown) => fn()),
}));

const { runSystemScope } = require("infrastructure/tenant/run-system-scope") as {
    runSystemScope: jest.Mock;
};

// F2: attempt reservation must precede the birthday comparison, atomically — one statement,
// never a read-then-decide-then-write sequence a concurrent caller could race against.
describe("SbReceiptLinkTokenRepository.reserveVerificationAttempt", () => {
    const getSqlText = (value: unknown): string => {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) return strings.join("");
        }
        return String(value);
    };

    let queryRaw: jest.Mock;
    let repository: SbReceiptLinkTokenRepository;

    beforeEach(() => {
        queryRaw = jest.fn();
        const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
        repository = new SbReceiptLinkTokenRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const NOW = new Date("2026-09-03T09:00:00+09:00");
    const LOCK_MS = 30 * 60 * 1000;
    const MAX_ATTEMPTS = 5;

    it("runs the reservation inside runSystemScope, as ONE raw statement (not a separate read + write)", async () => {
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);

        await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        expect(runSystemScope).toHaveBeenCalledTimes(1);
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("the raw statement covers every CASE branch by name: locked-in-window (values unchanged), elapsed-window reset, plain increment, and the threshold lock — plus FOR UPDATE and the wasLocked RETURNING", async () => {
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);

        await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        const sql = getSqlText(queryRaw.mock.calls[0]![0]);
        expect(sql).toContain("FOR UPDATE");
        expect(sql).toContain("UPDATE receipt_link_token");

        // Branch 1 — locked-in-window predicate: a still-locked row must compare its lock start
        // against the caller's `now`, not just check `locked_at IS NOT NULL` (that alone cannot
        // distinguish "inside the window" from "locked forever until reset" — exactly the bug
        // this method fixes). getSqlText() joins Prisma.sql's literal fragments with "" (params
        // dropped), so an interpolation point collapses to nothing between adjacent literals.
        const lockedInWindowPredicate =
            "b\\.locked_at IS NOT NULL\\s+AND\\s+b\\.locked_at \\+ make_interval\\(secs => \\(::double precision / 1000\\)\\) > ::timestamptz";
        expect(sql).toMatch(new RegExp(lockedInWindowPredicate));
        // ...and that predicate must gate BOTH assignments to their pre-write values in the
        // SAME statement — failed_attempts stays b.failed_attempts, locked_at stays b.locked_at.
        expect(sql).toMatch(new RegExp(lockedInWindowPredicate + "\\s+THEN b\\.failed_attempts"));
        expect(sql).toMatch(new RegExp(lockedInWindowPredicate + "\\s+THEN b\\.locked_at\\b"));

        // Branch 2 — window elapsed while still marked locked: reset failed_attempts to 1 and
        // clear locked_at to NULL, in the same statement (not a follow-up write).
        expect(sql).toContain("WHEN b.locked_at IS NOT NULL THEN 1");
        expect(sql).toContain("WHEN b.locked_at IS NOT NULL THEN NULL");

        // Branch 3 — plain increment when not locked at all, and the threshold lock: reaching
        // maxAttempts sets locked_at to `now` in the SAME UPDATE (not a second write).
        expect(sql).toContain("ELSE b.failed_attempts + 1");
        expect(sql).toMatch(/b\.failed_attempts \+ 1 >= ::int THEN\s*::timestamptz/);

        // The pre-write snapshot from the locking CTE is what lets the caller distinguish "this
        // reservation actually wrote something" from "the row was already locked and untouched".
        expect(sql).toContain('AS "wasLocked"');
    });

    it("returns outcome: locked (with lockedUntil) without reinterpreting an untouched row as recorded", async () => {
        const lockedAt = new Date(NOW.getTime() - 1000);
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 5, lockedAt, expectedBirthdayHash: "hash", wasLocked: true },
        ]);

        const result = await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        expect(result).toEqual({ outcome: "locked", lockedUntil: new Date(lockedAt.getTime() + LOCK_MS) });
    });

    it("returns outcome: recorded with the post-write state when the row was not already locked", async () => {
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 3, lockedAt: null, expectedBirthdayHash: "expected-hash", wasLocked: false },
        ]);

        const result = await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        expect(result).toEqual({
            outcome: "recorded",
            failedAttempts: 3,
            lockedAt: null,
            expectedBirthdayHash: "expected-hash",
        });
    });

    it("returns outcome: unusable when the CTE's WHERE (id AND active AND expires_at > now) matches no row — missing, inactive, or expired", async () => {
        queryRaw.mockResolvedValueOnce([]);
        const result = await repository.reserveVerificationAttempt("missing", NOW, LOCK_MS, MAX_ATTEMPTS);
        expect(result).toEqual({ outcome: "unusable" });
    });

    it("the CTE's WHERE guards on active and expires_at > now, not id alone", async () => {
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);

        await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        const sql = getSqlText(queryRaw.mock.calls[0]![0]);
        expect(sql).toMatch(/WHERE id = ::uuid AND active AND expires_at > ::timestamptz/);
    });
});
