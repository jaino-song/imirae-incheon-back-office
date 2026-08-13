import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";

function job(overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity {
    return new EformsignDocumentJobEntity({
        id: "00000000-0000-0000-0000-000000000001",
        branchId: "00000000-0000-0000-0000-000000000010",
        clientId: 7,
        documentId: null,
        jobType: "create_document",
        source: "staff",
        status: "reconciling",
        requestKey: "request-1",
        activeKey: "create:branch:7",
        payload: { clientId: 7, contractData: {} },
        payloadFingerprint: "a".repeat(64),
        progressStep: "creating",
        attempts: 1,
        nextAttemptAt: new Date(),
        heartbeatAt: new Date(),
        startedAt: new Date("2026-08-13T00:00:00Z"),
        completedAt: null,
        lastErrorCode: null,
        createdByUserId: null,
        createdAt: new Date("2026-08-13T00:00:00Z"),
        updatedAt: new Date(),
        ...overrides,
    });
}

describe("EformsignDocumentJobReconciliationService", () => {
    it("adopts the unique provider creation and completes the job", async () => {
        const repository = {
            markCompleted: jest.fn().mockResolvedValue(null),
            markRequiresAttention: jest.fn(),
        };
        const adoption = { execute: jest.fn().mockResolvedValue(undefined) };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            {
                execute: jest.fn().mockResolvedValue([{
                    id: "doc-1",
                    created_date: Date.now(),
                }]),
            } as never,
            { execute: jest.fn() } as never,
            adoption as never,
        );

        await expect(service.reconcile(job())).resolves.toEqual({
            status: "completed",
            documentId: "doc-1",
        });
        expect(adoption.execute).toHaveBeenCalledWith(
            "00000000-0000-0000-0000-000000000010",
            { documentId: "doc-1", clientId: 7 },
        );
        expect(repository.markCompleted).toHaveBeenCalledWith(job().id, "doc-1");
    });

    it("requires attention when provider creation state is ambiguous", async () => {
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(null),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            {
                execute: jest.fn().mockResolvedValue([
                    { id: "doc-1", created_date: Date.now() },
                    { id: "doc-2", created_date: Date.now() },
                ]),
            } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
        );

        await expect(service.reconcile(job())).resolves.toEqual({
            status: "requires_attention",
            reason: "AMBIGUOUS_PROVIDER_STATE",
        });
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            job().id,
            "AMBIGUOUS_PROVIDER_STATE",
        );
    });

    it("requires attention when provider creation lookup fails", async () => {
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(null),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn().mockRejectedValue(new Error("provider unavailable")) } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
        );

        await expect(service.reconcile(job())).resolves.toEqual({
            status: "requires_attention",
            reason: "PROVIDER_STATE_UNAVAILABLE",
        });
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            job().id,
            "PROVIDER_STATE_UNAVAILABLE",
        );
    });

    it("completes finalization only after a completed provider status and mirror sync", async () => {
        const repository = {
            markCompleted: jest.fn().mockResolvedValue(null),
            markRequiresAttention: jest.fn(),
        };
        const mirror = { syncDocument: jest.fn().mockResolvedValue({ status: "synced" }) };
        const finalizationJob = job({
            jobType: "finalize_document",
            documentId: "doc-finalize",
            payload: { documentId: "doc-finalize" },
        });
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn() } as never,
            {
                execute: jest.fn().mockResolvedValue({ current_status: { status_type: "003" } }),
            } as never,
            { execute: jest.fn() } as never,
            mirror as never,
        );

        await expect(service.reconcile(finalizationJob)).resolves.toEqual({
            status: "completed",
            documentId: "doc-finalize",
        });
        expect(mirror.syncDocument).toHaveBeenCalledWith(
            "doc-finalize",
            expect.objectContaining({ strictCompletionReconciliation: true }),
        );
        expect(repository.markCompleted).toHaveBeenCalledWith(finalizationJob.id, "doc-finalize");
    });
});
