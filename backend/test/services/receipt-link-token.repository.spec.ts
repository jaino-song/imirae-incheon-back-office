import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

jest.mock("infrastructure/tenant/run-system-scope", () => ({
    runSystemScope: jest.fn((fn: () => unknown) => fn()),
}));

const mockedRunSystemScope = runSystemScope as jest.Mock;

const BASE_ROW = {
    id: "tok-1",
    eformsignDocId: 1,
    accessTokenHash: null,
    expectedBirthdayHash: "hash",
    verifiedAt: null,
    failedAttempts: 0,
    lockedAt: null,
    expiresAt: new Date("2026-10-03T00:00:00.000Z"),
    active: true,
    storagePath: "receipts/b/1/a.png",
    branch: { name: "인천 아이미래로" },
    client: { name: "김산모" },
};

interface FakeTx {
    receipt_link_token: {
        findUnique: jest.Mock;
        update: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        updateMany: jest.Mock;
        deleteMany: jest.Mock;
    };
}

function makeFakePrisma() {
    const receipt_link_token = {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
    };
    const tx: FakeTx = { receipt_link_token };
    const $transaction = jest.fn(async (arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: FakeTx) => unknown)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
    const $queryRaw = jest.fn();
    return { receipt_link_token, $transaction, $queryRaw };
}

describe("SbReceiptLinkTokenRepository", () => {
    beforeEach(() => jest.clearAllMocks());

    // F2 audit fix: incrementFailedAttempts (a read-then-decide-then-write sequence prone to a
    // concurrent-guess race — see receipt-link-token.service.ts) was replaced by
    // reserveVerificationAttempt, one atomic raw statement. Covered in depth in
    // test/repositories/receipt-link-token.repository.spec.ts; this assertion just keeps this
    // file's "every cross-branch method wraps runSystemScope exactly once" survey accurate.
    it("wraps findByLinkTokenHash, update, and reserveVerificationAttempt in runSystemScope exactly once each", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);

        prisma.receipt_link_token.findUnique.mockResolvedValue(BASE_ROW);
        await repository.findByLinkTokenHash("hash");
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);

        mockedRunSystemScope.mockClear();
        prisma.receipt_link_token.update.mockResolvedValue(BASE_ROW);
        await repository.update("tok-1", { verifiedAt: new Date() });
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);

        mockedRunSystemScope.mockClear();
        prisma.$queryRaw.mockResolvedValue([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);
        await repository.reserveVerificationAttempt("tok-1", new Date(), 30 * 60 * 1000, 5);
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);
    });

    it("does NOT wrap createReplacingActive in runSystemScope, and branch-pins the revoke updateMany where", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.create.mockResolvedValue(BASE_ROW);

        const now = new Date();
        await repository.createReplacingActive(
            {
                branchId: "11111111-1111-1111-1111-111111111111",
                clientId: 7,
                eformsignDocId: 1,
                jobId: null,
                linkTokenHash: "h",
                expectedBirthdayHash: "h2",
                expiresAt: new Date(),
                storagePath: "receipts/b/1/a.png",
                contentSha256: "sha",
                byteSize: 10,
                source: "auto_trigger",
                createdBy: null,
                createdAt: now,
            },
            now,
        );

        expect(mockedRunSystemScope).not.toHaveBeenCalled();
        expect(prisma.receipt_link_token.updateMany).toHaveBeenCalledWith({
            where: { eformsignDocId: 1, active: true, branchId: "11111111-1111-1111-1111-111111111111" },
            data: { active: false, revokedAt: now },
        });
    });

    it("findActiveByJobId queries by jobId+active, ordered by createdAt desc", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findFirst.mockResolvedValue(null);

        await repository.findActiveByJobId("job-9");

        expect(mockedRunSystemScope).not.toHaveBeenCalled();
        expect(prisma.receipt_link_token.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { jobId: "job-9", active: true },
                orderBy: { createdAt: "desc" },
            }),
        );
    });
});
