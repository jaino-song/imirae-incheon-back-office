import { ConflictException } from "@nestjs/common";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";

const baseRow = (overrides: Record<string, unknown> = {}) => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    return {
        id: "11111111-1111-4111-8111-111111111111",
        branchId: "22222222-2222-4222-8222-222222222222",
        clientId: 7,
        localDocumentId: 11,
        assignmentId: 13,
        providerDocumentId: null,
        templateId: "template-1",
        action: "finalize",
        generation: "generation-1",
        businessKey: "a".repeat(64),
        fingerprint: "b".repeat(64),
        status: "prepared",
        attemptCount: 0,
        startedAt: null,
        providerAcceptedAt: null,
        uncertainAt: null,
        uncertainReason: null,
        providerReceipt: null,
        reconciledAt: null,
        reconciledOutcome: null,
        reconciledByUserId: null,
        reconciliationReason: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
};

const prepareInput = {
    branchId: "22222222-2222-4222-8222-222222222222",
    clientId: 7,
    localDocumentId: 11,
    assignmentId: 13,
    templateId: "template-1",
    action: "finalize" as const,
    generation: "generation-1",
    businessKey: "a".repeat(64),
    fingerprint: "b".repeat(64),
};

describe("SbEformsignDispatchIntentRepository", () => {
    it("treats immutable identity drift as a conflict even when the business key matches", async () => {
        const prisma = {
            eformsign_dispatch_intent: {
                findUnique: jest.fn().mockResolvedValue(baseRow({ assignmentId: 99 })),
            },
        };
        const repository = new SbEformsignDispatchIntentRepository(prisma as never);

        await expect(repository.prepare(prepareInput)).rejects.toBeInstanceOf(ConflictException);
    });

    it("uses a branch-scoped CAS claim and reports a concurrent claimant without replaying", async () => {
        const started = baseRow({
            status: "started",
            attemptCount: 1,
            startedAt: new Date("2026-08-29T00:01:00.000Z"),
        });
        const updateMany = jest.fn().mockResolvedValue({ count: 0 });
        const findFirst = jest.fn().mockResolvedValue(started);
        const prisma = { eformsign_dispatch_intent: { updateMany, findFirst } };
        const repository = new SbEformsignDispatchIntentRepository(prisma as never);

        const result = await repository.claim(started.id, started.branchId);

        expect(result).toEqual(expect.objectContaining({ claimed: false }));
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: started.id,
                branchId: started.branchId,
                status: { in: ["prepared", "reconciled_not_delivered"] },
            }),
        }));
    });

    it("does not overwrite a terminal provider receipt from a late response", async () => {
        const accepted = baseRow({
            status: "accepted",
            providerDocumentId: "provider-1",
            providerAcceptedAt: new Date("2026-08-29T00:02:00.000Z"),
        });
        const updateMany = jest.fn();
        const prisma = {
            eformsign_dispatch_intent: {
                findFirst: jest.fn().mockResolvedValue(accepted),
                updateMany,
            },
        };
        const repository = new SbEformsignDispatchIntentRepository(prisma as never);

        const result = await repository.markAccepted(accepted.id, accepted.branchId, "provider-1", {
            late: true,
        });

        expect(result).toMatchObject({ status: "accepted", providerDocumentId: "provider-1" });
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("rejects a not-delivered reconciliation after an accepted receipt", async () => {
        const accepted = baseRow({
            status: "accepted",
            providerDocumentId: "provider-1",
            providerAcceptedAt: new Date("2026-08-29T00:02:00.000Z"),
        });
        const prisma = {
            eformsign_dispatch_intent: {
                findFirst: jest.fn().mockResolvedValue(accepted),
            },
        };
        const repository = new SbEformsignDispatchIntentRepository(prisma as never);

        await expect(repository.reconcile({
            branchId: accepted.branchId,
            intentId: accepted.id,
            outcome: "not_delivered",
            actorUserId: "33333333-3333-4333-8333-333333333333",
            reason: "provider receipt confirms delivery",
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it("clears a stale create receipt when an operator confirms non-delivery", async () => {
        const uncertain = baseRow({
            action: "create",
            status: "uncertain",
            providerDocumentId: "orphan-provider-1",
            uncertainAt: new Date("2026-08-29T00:02:00.000Z"),
        });
        const reconciled = baseRow({
            action: "create",
            status: "reconciled_not_delivered",
            providerDocumentId: null,
            reconciledAt: new Date("2026-08-29T00:03:00.000Z"),
            reconciledOutcome: "not_delivered",
            reconciledByUserId: "33333333-3333-4333-8333-333333333333",
            reconciliationReason: "provider receipt confirms no delivery",
        });
        const updateMany = jest.fn().mockResolvedValue({ count: 1 });
        const findFirst = jest.fn()
            .mockResolvedValueOnce(uncertain)
            .mockResolvedValueOnce(reconciled);
        const prisma = { eformsign_dispatch_intent: { findFirst, updateMany } };
        const repository = new SbEformsignDispatchIntentRepository(prisma as never);

        const result = await repository.reconcile({
            branchId: uncertain.branchId,
            intentId: uncertain.id,
            outcome: "not_delivered",
            actorUserId: "33333333-3333-4333-8333-333333333333",
            reason: "provider receipt confirms no delivery",
            providerDocumentId: "orphan-provider-1",
        });

        expect(result).toMatchObject({
            status: "reconciled_not_delivered",
            providerDocumentId: null,
        });
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ providerDocumentId: null }),
        }));
    });
});
