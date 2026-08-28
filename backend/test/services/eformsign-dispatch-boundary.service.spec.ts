import { ConflictException, ForbiddenException } from "@nestjs/common";
import {
    buildEformsignDispatchBusinessKey,
    EformsignDispatchBoundaryService,
} from "application/services/eformsign-dispatch-boundary.service";
import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchIntentEntity,
} from "domain/entities/eformsign-dispatch-intent.entity";

const makeIntent = (
    overrides: Partial<ConstructorParameters<typeof EformsignDispatchIntentEntity>[0]> = {},
): EformsignDispatchIntentEntity => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    return new EformsignDispatchIntentEntity({
        id: "intent-1",
        branchId: "branch-1",
        clientId: 7,
        localDocumentId: 11,
        assignmentId: 13,
        providerDocumentId: "provider-1",
        templateId: "template-1",
        action: "finalize",
        generation: "generation-1",
        businessKey: "business-key",
        fingerprint: "fingerprint-1",
        status: EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED,
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
    });
};

const claimInput = {
    branchId: "branch-1",
    clientId: 7,
    localDocumentId: 11,
    assignmentId: 13,
    providerDocumentId: "provider-1",
    templateId: "template-1",
    action: "finalize" as const,
    generation: "generation-1",
    fingerprint: "fingerprint-1",
};

describe("EformsignDispatchBoundaryService", () => {
    it("derives a stable branch-scoped key from immutable dispatch identity", () => {
        const first = buildEformsignDispatchBusinessKey(claimInput);
        const repeat = buildEformsignDispatchBusinessKey({ ...claimInput });
        const otherBranch = buildEformsignDispatchBusinessKey({ ...claimInput, branchId: "branch-2" });

        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(repeat).toBe(first);
        expect(otherBranch).not.toBe(first);
    });

    it("lets only one concurrent caller cross the provider boundary", async () => {
        const prepared = makeIntent();
        const started = makeIntent({
            status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
            attemptCount: 1,
            startedAt: new Date(),
        });
        let claimCount = 0;
        const repository = {
            prepare: jest.fn().mockResolvedValue(prepared),
            claim: jest.fn().mockImplementation(async () => ({
                intent: started,
                claimed: claimCount++ === 0,
            })),
        };
        const service = new EformsignDispatchBoundaryService(repository as never);

        const [first, second] = await Promise.all([
            service.claim(claimInput),
            service.claim(claimInput),
        ]);

        expect(repository.claim).toHaveBeenCalledTimes(2);
        expect([first.disposition, second.disposition].sort()).toEqual(["claimed", "uncertain"]);
    });

    it("does not replay an uncertain attempt until explicit non-delivery reconciliation", async () => {
        let current = makeIntent();
        const repository = {
            prepare: jest.fn().mockImplementation(async () => current),
            claim: jest.fn().mockImplementation(async () => {
                current = makeIntent({
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                    attemptCount: current.attemptCount + 1,
                    startedAt: new Date(),
                });
                return { intent: current, claimed: true };
            }),
            markUncertain: jest.fn().mockImplementation(async () => {
                current = makeIntent({
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                    attemptCount: current.attemptCount,
                    startedAt: current.startedAt,
                    uncertainAt: new Date(),
                    uncertainReason: "crash-after-provider",
                });
                return current;
            }),
            reconcile: jest.fn().mockImplementation(async (input) => {
                current = makeIntent({
                    status: input.outcome === "delivered"
                        ? EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
                        : EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED,
                    attemptCount: current.attemptCount,
                    reconciledAt: new Date(),
                    reconciledOutcome: input.outcome,
                    reconciledByUserId: input.actorUserId,
                    reconciliationReason: input.reason,
                });
                return current;
            }),
        };
        const service = new EformsignDispatchBoundaryService(repository as never);

        const first = await service.claim(claimInput);
        await service.markUncertain(first.intent, "crash-after-provider");
        await expect(service.claim(claimInput)).resolves.toMatchObject({ disposition: "uncertain" });

        await service.reconcile({
            branchId: "branch-1",
            intentId: "intent-1",
            outcome: "not_delivered",
            actorUserId: "operator-1",
            reason: "provider receipt lookup confirms no delivery",
        });
        await expect(service.claim(claimInput)).resolves.toMatchObject({ disposition: "claimed" });
    });

    it("blocks a retry after delivered reconciliation", async () => {
        let current = makeIntent();
        const repository = {
            prepare: jest.fn().mockImplementation(async () => current),
            claim: jest.fn().mockImplementation(async () => {
                current = makeIntent({ status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED, attemptCount: 1 });
                return { intent: current, claimed: true };
            }),
            reconcile: jest.fn().mockImplementation(async (input) => {
                current = makeIntent({
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED,
                    attemptCount: current.attemptCount,
                    reconciledAt: new Date(),
                    reconciledOutcome: "delivered",
                    reconciledByUserId: input.actorUserId,
                    reconciliationReason: input.reason,
                });
                return current;
            }),
        };
        const service = new EformsignDispatchBoundaryService(repository as never);

        await service.claim(claimInput);
        await service.reconcile({
            branchId: "branch-1",
            intentId: "intent-1",
            outcome: "delivered",
            actorUserId: "operator-1",
            reason: "provider receipt verified",
        });

        await expect(service.claim(claimInput)).resolves.toMatchObject({ disposition: "already_accepted" });
        expect(repository.claim).toHaveBeenCalledTimes(1);
    });

    it("rejects a changed payload under the same logical identity", async () => {
        const repository = {
            prepare: jest.fn().mockResolvedValue(makeIntent()),
        };
        const service = new EformsignDispatchBoundaryService(repository as never);

        await expect(service.claim({ ...claimInput, fingerprint: "different" }))
            .rejects.toBeInstanceOf(ConflictException);
    });

    it("requires an authenticated actor and audit reason for reconciliation", async () => {
        const service = new EformsignDispatchBoundaryService({
            prepare: jest.fn(),
            reconcile: jest.fn(),
        } as never);

        await expect(service.reconcile({
            branchId: "branch-1",
            intentId: "intent-1",
            outcome: "not_delivered",
            actorUserId: "",
            reason: " ",
        })).rejects.toBeInstanceOf(ForbiddenException);
    });
});
