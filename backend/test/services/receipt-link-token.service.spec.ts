import { createHash } from "node:crypto";
import {
    ReceiptLinkTokenService,
    RECEIPT_LINK_LOCK_MS,
    RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
    RECEIPT_LINK_TTL_MS,
    normalizeBirthdayInput,
} from "application/services/receipt-link-token.service";
import {
    CreateReceiptLinkTokenData,
    IReceiptLinkTokenRepository,
    ReceiptLinkTokenRecord,
    ReserveVerificationAttemptResult,
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

/** The fake's internal row shape carries a couple of fields the public record never exposes
 * (linkTokenHash is a lookup key, revokedAt is write-only from the service's point of view) so
 * the tests can still assert on them directly, mirroring the previous FakePrisma's `rows`. */
interface FakeRow extends ReceiptLinkTokenRecord {
    linkTokenHash: string;
    revokedAt: Date | null;
    jobId: string | null;
}

class FakeReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    rows: FakeRow[] = [];
    private nextId = 1;

    async findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null> {
        const row = this.rows.find((r) => r.linkTokenHash === linkTokenHash);
        return row ? { ...row } : null;
    }

    async createReplacingActive(data: CreateReceiptLinkTokenData, now: Date): Promise<ReceiptLinkTokenRecord> {
        const hits = this.rows.filter((r) => r.eformsignDocId === data.eformsignDocId && r.active === true);
        hits.forEach((r) => {
            r.active = false;
            r.revokedAt = now;
        });

        const row: FakeRow = {
            id: `row-${this.nextId++}`,
            eformsignDocId: data.eformsignDocId,
            accessTokenHash: null,
            expectedBirthdayHash: data.expectedBirthdayHash,
            verifiedAt: null,
            failedAttempts: 0,
            lockedAt: null,
            expiresAt: data.expiresAt,
            active: true,
            storagePath: data.storagePath,
            branchName: "인천 아이미래로",
            clientName: "김산모",
            linkTokenHash: data.linkTokenHash,
            revokedAt: null,
            jobId: data.jobId,
        };
        this.rows.push(row);
        return { ...row };
    }

    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        const row = this.rows.find((r) => r.id === id)!;
        Object.assign(row, data);
        return { ...row };
    }

    // Deliberately synchronous end-to-end (no `await` anywhere in the body): this is what makes
    // the fake a faithful stand-in for the real repository's single atomic UPDATE — under
    // Node's single-threaded event loop, a body with no internal await point can never be
    // interleaved with another concurrent call, exactly like a real DB row-level lock serializes
    // concurrent writers on the same row. That is the property the concurrency tests below rely
    // on to catch a regression back to the old read-then-write race.
    async reserveVerificationAttempt(
        id: string,
        now: Date,
        lockWindowMs: number,
        maxAttempts: number,
    ): Promise<ReserveVerificationAttemptResult> {
        const row = this.rows.find((r) => r.id === id);

        // Mirrors the real repository's CTE guard: a missing, inactive, or expired-as-of-`now`
        // row never gets a counter write — the caller re-reads to report the real terminal
        // reason instead of a bare "not found".
        if (!row || !row.active || row.expiresAt.getTime() <= now.getTime()) {
            return { outcome: "unusable" };
        }

        if (row.lockedAt && row.lockedAt.getTime() + lockWindowMs > now.getTime()) {
            return { outcome: "locked", lockedUntil: new Date(row.lockedAt.getTime() + lockWindowMs) };
        }

        if (row.lockedAt) {
            // Lock window elapsed: restart the counter at 1 rather than continuing the increment.
            row.failedAttempts = 1;
            row.lockedAt = null;
        } else {
            row.failedAttempts += 1;
            if (row.failedAttempts >= maxAttempts) {
                row.lockedAt = now;
            }
        }

        return {
            outcome: "recorded",
            failedAttempts: row.failedAttempts,
            lockedAt: row.lockedAt,
            expectedBirthdayHash: row.expectedBirthdayHash,
        };
    }

    async findExpired(cutoff: Date) {
        return this.rows
            .filter((r) => r.expiresAt < cutoff)
            .map((r) => ({ id: r.id, storagePath: r.storagePath, eformsignDocId: r.eformsignDocId }));
    }

    async deleteByIds(ids: string[]): Promise<number> {
        const before = this.rows.length;
        const idSet = new Set(ids);
        this.rows = this.rows.filter((r) => !idSet.has(r.id));
        return before - this.rows.length;
    }

    async existsByStoragePath(storagePath: string): Promise<boolean> {
        return this.rows.some((r) => r.storagePath === storagePath);
    }

    async findStoragePathsInUse(storagePaths: string[], cutoff: Date): Promise<string[]> {
        const pathSet = new Set(storagePaths);
        const inUse = new Set(
            this.rows
                .filter((r) => pathSet.has(r.storagePath) && r.expiresAt >= cutoff)
                .map((r) => r.storagePath),
        );
        return Array.from(inUse);
    }

    async findActiveByJobId(jobId: string): Promise<ReceiptLinkTokenRecord | null> {
        const row = this.rows.find((r) => r.jobId === jobId && r.active === true);
        return row ? { ...row } : null;
    }
}

const config = { get: (key: string, fallback?: string) => (key === "RECEIPT_LINK_HASH_SALT" ? "test-salt" : fallback) };
const NOW = new Date("2026-09-03T09:00:00+09:00");

function makeService() {
    const repository = new FakeReceiptLinkTokenRepository();
    const service = new ReceiptLinkTokenService(repository, config as never);
    return { repository, service };
}

async function issue(service: ReceiptLinkTokenService, overrides: Partial<Parameters<ReceiptLinkTokenService["issue"]>[0]> = {}) {
    return service.issue({
        branchId: "11111111-1111-1111-1111-111111111111",
        clientId: 7,
        eformsignDocId: 42,
        jobId: "job-1",
        birthday: "940315",
        storagePath: "receipts/b/42/abc.png",
        contentSha256: "a".repeat(64),
        byteSize: 1000,
        source: "auto_trigger",
        now: NOW,
        ...overrides,
    });
}

describe("normalizeBirthdayInput", () => {
    it("accepts 6 digits, takes the last 6 of 8 digits, rejects anything else", () => {
        expect(normalizeBirthdayInput("940315")).toBe("940315");
        expect(normalizeBirthdayInput("1994-03-15")).toBe("940315");
        expect(normalizeBirthdayInput("19940315")).toBe("940315");
        expect(normalizeBirthdayInput("9403")).toBeNull();
        expect(normalizeBirthdayInput("")).toBeNull();
    });
});

describe("ReceiptLinkTokenService", () => {
    it("issues an efr_ token, stores only hashes, expires in 30 days, and revokes older tokens for the same document", async () => {
        const { repository, service } = makeService();
        const first = await issue(service);
        const second = await issue(service, { jobId: "job-2" });

        expect(first.linkToken).toMatch(/^efr_[A-Za-z0-9_-]{43}$/);
        expect(first.expiresAt.getTime()).toBe(NOW.getTime() + RECEIPT_LINK_TTL_MS);
        expect(repository.rows.map((r) => r.active)).toEqual([false, true]);
        expect(repository.rows[0]!.revokedAt).toEqual(NOW);
        expect(repository.rows[1]!.linkTokenHash).toBe(createHash("sha256").update(second.linkToken).digest("hex"));
        expect(repository.rows[1]!.expectedBirthdayHash).toBe(createHash("sha256").update("test-salt:940315").digest("hex"));
        expect(JSON.stringify(repository.rows)).not.toContain(second.linkToken);
    });

    it("rejects issue() when the birthday does not normalize to 6 digits", async () => {
        const { service } = makeService();
        await expect(issue(service, { birthday: "" })).rejects.toThrow(/YYMMDD/);
        await expect(issue(service, { birthday: "94" })).rejects.toThrow(/YYMMDD/);
    });

    it("normalizes the birthday before hashing, so an 8-digit issue matches a 6-digit verify", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service, { birthday: "19940315" });
        expect(await service.verifyBirthday(linkToken, "940315", NOW)).toMatchObject({ ok: true });
    });

    it("fails closed when RECEIPT_LINK_HASH_SALT is not configured", async () => {
        const repository = new FakeReceiptLinkTokenRepository();
        const saltedService = new ReceiptLinkTokenService(repository, config as never);
        const { linkToken } = await issue(saltedService);

        const noSaltConfig = { get: (key: string, fallback?: string) => (key === "RECEIPT_LINK_HASH_SALT" ? "" : fallback) };
        const unsaltedService = new ReceiptLinkTokenService(repository, noSaltConfig as never);

        await expect(issue(unsaltedService)).rejects.toThrow(/RECEIPT_LINK_HASH_SALT/);
        await expect(unsaltedService.verifyBirthday(linkToken, "940315", NOW)).rejects.toThrow(/RECEIPT_LINK_HASH_SALT/);
    });

    it("reports status without exposing the client name", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        const status = await service.getStatus(linkToken, NOW);
        expect(status).toEqual({
            ok: true,
            state: "pending",
            branchName: "인천 아이미래로",
            expiresAt: new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS).toISOString(),
            remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
            lockedUntil: null,
        });
        expect(await service.getStatus("efr_nope", NOW)).toEqual({ ok: false, reason: "not_found" });
        expect(await service.getStatus(linkToken, new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS + 1))).toEqual({ ok: false, reason: "expired" });
    });

    it("reports state: verified after a successful verification", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        await service.verifyBirthday(linkToken, "940315", NOW);
        expect(await service.getStatus(linkToken, NOW)).toMatchObject({ ok: true, state: "verified" });
    });

    it("verifies the birthday, returns an access token and the client name", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        const result = await service.verifyBirthday(linkToken, "19940315", NOW);
        expect(result).toMatchObject({ ok: true, clientName: "김산모" });
        const accessToken = (result as { accessToken: string }).accessToken;
        expect(accessToken).toMatch(/^efra_[A-Za-z0-9_-]{43}$/);
        expect(repository.rows[0]!.accessTokenHash).toBe(createHash("sha256").update(accessToken).digest("hex"));
        expect(repository.rows[0]!.verifiedAt).toEqual(NOW);

        const access = await service.resolveAccess(linkToken, accessToken, NOW);
        expect(access).toEqual({ id: "row-1", storagePath: "receipts/b/42/abc.png", clientName: "김산모", expiresAt: new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS) });
        expect(await service.resolveAccess(linkToken, "efra_wrong", NOW)).toBeNull();
    });

    it("falls back to the default client name when the client is unset", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        repository.rows[0]!.clientName = null;

        const result = await service.verifyBirthday(linkToken, "940315", NOW);
        expect(result).toMatchObject({ ok: true, clientName: "산모" });
        const accessToken = (result as { accessToken: string }).accessToken;

        const access = await service.resolveAccess(linkToken, accessToken, NOW);
        expect(access).toMatchObject({ clientName: "산모" });
    });

    it("resolveAccess returns null once the token has expired", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        const result = await service.verifyBirthday(linkToken, "940315", NOW);
        const accessToken = (result as { accessToken: string }).accessToken;

        const afterExpiry = new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS + 1);
        expect(await service.resolveAccess(linkToken, accessToken, afterExpiry)).toBeNull();
    });

    it("treats a revoked token as unusable everywhere", async () => {
        const { service } = makeService();
        const { linkToken: revokedToken } = await issue(service);
        // Issuing a second token for the same document revokes the first.
        await issue(service, { jobId: "job-2" });

        expect(await service.getStatus(revokedToken, NOW)).toEqual({ ok: false, reason: "revoked" });
        expect(await service.verifyBirthday(revokedToken, "940315", NOW)).toEqual({ ok: false, reason: "revoked" });
        expect(await service.resolveAccess(revokedToken, "efra_anything", NOW)).toBeNull();
    });

    it("counts failures, locks for 30 minutes after 5, and resets after the lock expires", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        for (let attempt = 1; attempt < RECEIPT_LINK_MAX_FAILED_ATTEMPTS; attempt += 1) {
            expect(await service.verifyBirthday(linkToken, "000000", NOW)).toEqual({
                ok: false,
                reason: "verification_failed",
                remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS - attempt,
            });
        }
        const lockedUntil = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS).toISOString();
        expect(await service.verifyBirthday(linkToken, "000000", NOW)).toEqual({ ok: false, reason: "locked", lockedUntil });
        expect(await service.verifyBirthday(linkToken, "940315", NOW)).toEqual({ ok: false, reason: "locked", lockedUntil });
        expect(await service.getStatus(linkToken, NOW)).toMatchObject({ remainingAttempts: 0, lockedUntil });

        const later = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS + 1);
        expect(await service.verifyBirthday(linkToken, "940315", later)).toMatchObject({ ok: true });
    });

    it("after the lock window elapses, a wrong attempt restarts the counter instead of re-locking immediately", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);
        for (let attempt = 0; attempt < RECEIPT_LINK_MAX_FAILED_ATTEMPTS; attempt += 1) {
            await service.verifyBirthday(linkToken, "000000", NOW);
        }
        // The token is now locked (the 5th wrong attempt just above triggered it).

        const later = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS + 1);
        expect(await service.verifyBirthday(linkToken, "000000", later)).toEqual({
            ok: false,
            reason: "verification_failed",
            remainingAttempts: RECEIPT_LINK_MAX_FAILED_ATTEMPTS - 1,
        });
    });

    // F2: attempt reservation must precede the birthday comparison, atomically. Before this fix,
    // verifyBirthday read the row, decided "not locked" from that snapshot, compared, and only
    // then incremented — so 200 concurrent guesses would all get compared, and after a lock
    // window elapsed, N concurrent wrong guesses would all take the reset branch and the counter
    // would end at 1 instead of reflecting every reservation.
    // I1/I2 fix-round-1 rename: this test's original title claimed "exactly maxAttempts are
    // ever compared" but only checked the RESPONSE distribution (verification_failed vs
    // locked counts), which a reservation-outcome bug could still satisfy by coincidence.
    // Now directly counts how many reservations actually reach "recorded" (the outcome that
    // gates the hash comparison in verifyBirthday) via a spy on reserveVerificationAttempt,
    // so the count in the title is what's actually asserted.
    it("50 concurrent wrong guesses: exactly maxAttempts reservations are ever recorded (reach the hash comparison), the rest are refused as locked pre-comparison", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);

        const originalReserve = repository.reserveVerificationAttempt.bind(repository);
        let recordedCount = 0;
        let lockedPreComparisonCount = 0;
        jest.spyOn(repository, "reserveVerificationAttempt").mockImplementation(async (...args: Parameters<typeof originalReserve>) => {
            const result = await originalReserve(...args);
            if (result.outcome === "recorded") recordedCount += 1;
            else lockedPreComparisonCount += 1;
            return result;
        });

        const results = await Promise.all(
            Array.from({ length: 50 }, () => service.verifyBirthday(linkToken, "000000", NOW)),
        );

        // verifyBirthday only ever compares the birthday hash after a "recorded" reservation
        // outcome (see receipt-link-token.service.ts) — so this is a direct count of how many
        // of the 50 concurrent guesses actually reached the comparison, not an inference from
        // response shape.
        expect(recordedCount).toBe(RECEIPT_LINK_MAX_FAILED_ATTEMPTS);
        expect(lockedPreComparisonCount).toBe(50 - RECEIPT_LINK_MAX_FAILED_ATTEMPTS);

        const compared = results.filter((r) => !r.ok && r.reason === "verification_failed");
        const locked = results.filter((r) => !r.ok && r.reason === "locked");
        // The first (maxAttempts - 1) reservations report verification_failed; the reservation
        // that tips the counter to maxAttempts reports locked directly (no remainingAttempts to
        // report), and every guess that arrives after that also reports locked without ever
        // reaching the hash comparison.
        expect(compared).toHaveLength(RECEIPT_LINK_MAX_FAILED_ATTEMPTS - 1);
        expect(locked).toHaveLength(50 - (RECEIPT_LINK_MAX_FAILED_ATTEMPTS - 1));
        expect(compared.length + locked.length).toBe(50);
    });

    // I2 fix-round-1: the discriminating regression test. Unlike the sequential case below
    // (which awaits the 5 wrong guesses to fully complete before issuing the correct one, so
    // it never actually races the correct guess's OWN row-read against the wrong guesses'
    // writes), this fires ALL 6 guesses — 5 wrong + 1 correct, correct LAST — in a single
    // Promise.all. Verified by hand-simulation (matching the real async/await shape of both
    // implementations) that the pre-F2 code returns { ok: true } here: its verifyBirthday read
    // the row (findRow) BEFORE any of the 6 concurrent calls had written anything, so the
    // correct guess's own stale "not locked yet" snapshot let it succeed even though by the
    // time all 6 settle, the wrong guesses should have already locked the token. The shipped
    // (F2) code reserves the attempt atomically against the row's live state before ever
    // comparing, so the same race correctly reports the correct guess as locked.
    it("a correct guess racing in the SAME batch as 5 concurrent wrong guesses (single Promise.all, correct last) is refused as locked", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);

        const guesses = [...Array.from({ length: RECEIPT_LINK_MAX_FAILED_ATTEMPTS }, () => "000000"), "940315"];
        const results = await Promise.all(guesses.map((guess) => service.verifyBirthday(linkToken, guess, NOW)));

        const correctGuessResult = results[results.length - 1]!;
        expect(correctGuessResult).toEqual({ ok: false, reason: "locked", lockedUntil: expect.any(String) });
    });

    // Retitled (fix round 1): this is the SEQUENTIAL case — the 5 wrong guesses are awaited to
    // completion before the correct one is even issued, so it never races the correct guess's
    // read against the wrong guesses' writes. Kept because it's still a valid regression test
    // for "locked stays locked for a correct guess", but the concurrent race is what the test
    // above actually exercises.
    it("(sequential) a correct guess arriving strictly after 5 completed wrong guesses is refused as locked", async () => {
        const { service } = makeService();
        const { linkToken } = await issue(service);

        await Promise.all(
            Array.from({ length: RECEIPT_LINK_MAX_FAILED_ATTEMPTS }, () => service.verifyBirthday(linkToken, "000000", NOW)),
        );

        const correct = await service.verifyBirthday(linkToken, "940315", NOW);
        expect(correct).toMatchObject({ ok: false, reason: "locked" });
    });

    it("lock window elapsed + 50 concurrent wrong guesses: the counter reflects the reservations, not a stuck 1", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        await Promise.all(
            Array.from({ length: RECEIPT_LINK_MAX_FAILED_ATTEMPTS }, () => service.verifyBirthday(linkToken, "000000", NOW)),
        );
        // The token is now locked from the batch above.

        const later = new Date(NOW.getTime() + RECEIPT_LINK_LOCK_MS + 1);
        await Promise.all(
            Array.from({ length: 50 }, () => service.verifyBirthday(linkToken, "000000", later)),
        );

        // Every one of the 50 calls reserved an attempt against the same row; the old bug (each
        // concurrent caller independently reading "locked, window elapsed" and unconditionally
        // writing failedAttempts=1) would leave this at 1 instead of a real reserved count.
        expect(repository.rows[0]!.failedAttempts).toBe(RECEIPT_LINK_MAX_FAILED_ATTEMPTS);
        expect(repository.rows[0]!.lockedAt).toEqual(later);
    });

    it("a correct guess still resets failedAttempts to 0 even after concurrent wrong guesses", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        await Promise.all(
            Array.from({ length: RECEIPT_LINK_MAX_FAILED_ATTEMPTS - 1 }, () => service.verifyBirthday(linkToken, "000000", NOW)),
        );
        expect(repository.rows[0]!.failedAttempts).toBe(RECEIPT_LINK_MAX_FAILED_ATTEMPTS - 1);

        const result = await service.verifyBirthday(linkToken, "940315", NOW);
        expect(result).toMatchObject({ ok: true });
        expect(repository.rows[0]!.failedAttempts).toBe(0);
        expect(repository.rows[0]!.lockedAt).toBeNull();
    });

    it("rejects malformed input without counting an attempt", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        expect(await service.verifyBirthday(linkToken, "94", NOW)).toEqual({ ok: false, reason: "invalid_format" });
        expect(repository.rows[0]!.failedAttempts).toBe(0);
    });

    // M5 fix-round-1: pins the existing precedence — normalize/validate the raw input BEFORE
    // ever calling reserveVerificationAttempt — for a LOCKED token specifically, not just a
    // plain pending one. A malformed guess against a locked token must still report
    // invalid_format (not "locked"), and must not touch the reservation at all.
    it("a LOCKED token given a malformed birthday returns invalid_format without consuming an attempt or reaching the reservation", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        for (let attempt = 0; attempt < RECEIPT_LINK_MAX_FAILED_ATTEMPTS; attempt += 1) {
            await service.verifyBirthday(linkToken, "000000", NOW);
        }
        expect(repository.rows[0]!.lockedAt).toEqual(NOW);

        const reserveSpy = jest.spyOn(repository, "reserveVerificationAttempt");
        expect(await service.verifyBirthday(linkToken, "94", NOW)).toEqual({ ok: false, reason: "invalid_format" });
        expect(reserveSpy).not.toHaveBeenCalled();
        expect(repository.rows[0]!.failedAttempts).toBe(RECEIPT_LINK_MAX_FAILED_ATTEMPTS);
    });

    // M1 fix-round-1: the reservation's own CTE guard (active AND expires_at > now) can find a
    // row no longer usable even though the EARLIER unusableReason(row, now) check (run before
    // the reservation, against a snapshot read moments before) still saw it as fine — e.g. the
    // token was revoked or expired in the gap between the two. verifyBirthday must re-read via
    // unusableReason and report the real terminal reason, not a generic error.
    it("when reserveVerificationAttempt reports outcome: unusable because the row was revoked in the gap, verifyBirthday re-reads and reports revoked", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);

        jest.spyOn(repository, "reserveVerificationAttempt").mockImplementationOnce(async () => {
            // Simulate a concurrent revoke landing in the gap between verifyBirthday's initial
            // unusableReason check and this reservation call.
            repository.rows[0]!.active = false;
            return { outcome: "unusable" };
        });

        expect(await service.verifyBirthday(linkToken, "940315", NOW)).toEqual({ ok: false, reason: "revoked" });
    });

    it("when reserveVerificationAttempt reports outcome: unusable because the row expired in the gap, verifyBirthday re-reads and reports expired", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);

        jest.spyOn(repository, "reserveVerificationAttempt").mockImplementationOnce(async () => {
            repository.rows[0]!.expiresAt = new Date(NOW.getTime() - 1);
            return { outcome: "unusable" };
        });

        expect(await service.verifyBirthday(linkToken, "940315", NOW)).toEqual({ ok: false, reason: "expired" });
    });

    // M1: exercises the fake's own guard directly (not via a mocked outcome) — reserving on an
    // inactive or already-expired row returns outcome: unusable rather than mutating the row.
    it("the fake's reserveVerificationAttempt returns outcome: unusable for an inactive row, and for an expired-as-of-now row, without writing to it", async () => {
        const { repository, service } = makeService();
        await issue(service);
        await issue(service, { jobId: "job-2" }); // revokes the first token
        const revokedResult = await repository.reserveVerificationAttempt(
            repository.rows[0]!.id,
            NOW,
            RECEIPT_LINK_LOCK_MS,
            RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
        );
        expect(revokedResult).toEqual({ outcome: "unusable" });
        expect(repository.rows[0]!.failedAttempts).toBe(0);

        await issue(service, { eformsignDocId: 99, jobId: "job-3" });
        const expiredRow = repository.rows.find((r) => r.eformsignDocId === 99)!;
        const wayPast = new Date(expiredRow.expiresAt.getTime() + 1);
        const expiredResult = await repository.reserveVerificationAttempt(
            expiredRow.id,
            wayPast,
            RECEIPT_LINK_LOCK_MS,
            RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
        );
        expect(expiredResult).toEqual({ outcome: "unusable" });
        expect(expiredRow.failedAttempts).toBe(0);
    });

    it("collects expired tokens and only the storage paths no live token still references", async () => {
        const { repository, service } = makeService();
        await issue(service, { eformsignDocId: 1, storagePath: "receipts/b/1/old.png", now: new Date("2026-07-01T00:00:00Z") });
        await issue(service, { eformsignDocId: 2, storagePath: "receipts/b/2/shared.png", now: new Date("2026-07-01T00:00:00Z") });
        await issue(service, { eformsignDocId: 3, storagePath: "receipts/b/2/shared.png", now: NOW });

        const cutoff = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
        const collected = await service.collectExpired(cutoff);
        expect(collected.ids).toEqual(["row-1", "row-2"]);
        expect(collected.orphanStoragePaths).toEqual(["receipts/b/1/old.png"]);

        // collectExpired is read-only: the expired rows must survive it (a crash between storage
        // cleanup and deleteByIds must leave them retryable).
        expect(repository.rows.map((r) => r.id)).toEqual(["row-1", "row-2", "row-3"]);

        await service.deleteByIds(collected.ids);
        expect(repository.rows.map((r) => r.id)).toEqual(["row-3"]);
    });
});
