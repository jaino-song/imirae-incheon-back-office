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
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

/** The fake's internal row shape carries a couple of fields the public record never exposes
 * (linkTokenHash is a lookup key, revokedAt is write-only from the service's point of view) so
 * the tests can still assert on them directly, mirroring the previous FakePrisma's `rows`. */
interface FakeRow extends ReceiptLinkTokenRecord {
    linkTokenHash: string;
    revokedAt: Date | null;
}

class FakeReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    rows: FakeRow[] = [];
    private nextId = 1;

    async findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null> {
        const row = this.rows.find((r) => r.linkTokenHash === linkTokenHash);
        return row ? { ...row } : null;
    }

    async revokeActiveByDocument(eformsignDocId: number, data: { active: boolean; revokedAt: Date }): Promise<number> {
        const hits = this.rows.filter((r) => r.eformsignDocId === eformsignDocId && r.active === true);
        hits.forEach((r) => Object.assign(r, data));
        return hits.length;
    }

    async create(data: CreateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
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
        };
        this.rows.push(row);
        return { ...row };
    }

    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        const row = this.rows.find((r) => r.id === id)!;
        Object.assign(row, data);
        return { ...row };
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

    it("verifies the birthday, returns an access token and the client name", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        const result = await service.verifyBirthday(linkToken, "19940315", NOW);
        expect(result).toMatchObject({ ok: true, clientName: "김산모" });
        const accessToken = (result as { accessToken: string }).accessToken;
        expect(accessToken).toMatch(/^efra_/);
        expect(repository.rows[0]!.accessTokenHash).toBe(createHash("sha256").update(accessToken).digest("hex"));
        expect(repository.rows[0]!.verifiedAt).toEqual(NOW);

        const access = await service.resolveAccess(linkToken, accessToken, NOW);
        expect(access).toEqual({ id: "row-1", storagePath: "receipts/b/42/abc.png", clientName: "김산모", expiresAt: new Date(NOW.getTime() + RECEIPT_LINK_TTL_MS) });
        expect(await service.resolveAccess(linkToken, "efra_wrong", NOW)).toBeNull();
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

    it("rejects malformed input without counting an attempt", async () => {
        const { repository, service } = makeService();
        const { linkToken } = await issue(service);
        expect(await service.verifyBirthday(linkToken, "94", NOW)).toEqual({ ok: false, reason: "invalid_format" });
        expect(repository.rows[0]!.failedAttempts).toBe(0);
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
