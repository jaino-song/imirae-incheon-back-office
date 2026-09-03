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

    it("the raw statement is a locking UPDATE guarded by the lock window on locked_at", async () => {
        queryRaw.mockResolvedValueOnce([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);

        await repository.reserveVerificationAttempt("row-1", NOW, LOCK_MS, MAX_ATTEMPTS);

        const sql = getSqlText(queryRaw.mock.calls[0]![0]);
        expect(sql).toContain("FOR UPDATE");
        expect(sql).toContain("UPDATE receipt_link_token");
        expect(sql).toContain("locked_at");
        // The window guard: a still-locked row must compare its lock start against the caller's
        // `now`, not just check `locked_at IS NOT NULL` — that distinguishes "inside the window"
        // from "locked forever until reset", which is exactly the bug this method fixes.
        expect(sql).toMatch(/locked_at\s*\+\s*make_interval/);
        expect(sql).toContain("> ");
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

    it("throws when the token id does not exist", async () => {
        queryRaw.mockResolvedValueOnce([]);
        await expect(repository.reserveVerificationAttempt("missing", NOW, LOCK_MS, MAX_ATTEMPTS)).rejects.toThrow(/not found/);
    });
});
