import { ContractAutoFinalizeSchedulerService, CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE } from "application/services/contract-auto-finalize-scheduler.service";
import type { ReviewStageContract } from "domain/repositories/eformsign-doc.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";

function contract(overrides: Partial<ReviewStageContract> = {}): ReviewStageContract {
    return {
        documentId: "doc-1",
        branchId: "branch-1",
        customerName: "송가연",
        // Yesterday in KST: due at every midnight run regardless of when the test runs.
        contractEndDate: isoDateInKorea(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        autoFinalizeAttempts: 0,
        autoFinalizeLastAttemptAt: null,
        autoFinalizeLastError: null,
        ...overrides,
    };
}

describe("ContractAutoFinalizeSchedulerService", () => {
    const sinceDate = "2020-01-01";
    let configValues: Record<string, string | undefined>;
    let repository: {
        findReviewStageContracts: jest.Mock;
        recordAutoFinalizeFailure: jest.Mock;
    };
    let finalizeUsecase: { execute: jest.Mock };
    let notificationService: { sendToBranchUsers: jest.Mock };
    let service: ContractAutoFinalizeSchedulerService;

    beforeEach(() => {
        configValues = {
            CONTRACT_AUTO_FINALIZE_ENABLED: "true",
            CONTRACT_AUTO_FINALIZE_SINCE: sinceDate,
        };
        repository = {
            findReviewStageContracts: jest.fn().mockResolvedValue([]),
            recordAutoFinalizeFailure: jest.fn().mockResolvedValue(1),
        };
        finalizeUsecase = {
            execute: jest.fn().mockResolvedValue({ ok: true, completed: true, durationMs: 900 }),
        };
        notificationService = { sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) };
        service = new ContractAutoFinalizeSchedulerService(
            { get: (key: string) => configValues[key] } as never,
            repository as never,
            finalizeUsecase as never,
            notificationService as never,
        );
    });

    it("does nothing while the kill-switch is off", async () => {
        configValues["CONTRACT_AUTO_FINALIZE_ENABLED"] = undefined;
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
    });

    it("refuses to run without a valid activation date (the backlog fence)", async () => {
        configValues["CONTRACT_AUTO_FINALIZE_SINCE"] = undefined;
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();

        configValues["CONTRACT_AUTO_FINALIZE_SINCE"] = "08/08/2026";
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
    });

    it("finalizes a due contract with its stored end date prefilled", async () => {
        const due = contract();
        repository.findReviewStageContracts.mockResolvedValue([due]);

        await service.autoFinalizeDueContracts();

        expect(finalizeUsecase.execute).toHaveBeenCalledWith({
            documentId: "doc-1",
            prefillEndDate: due.contractEndDate,
        });
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
    });

    it("skips ineligible contracts: future end date, missing end date, exhausted retries", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "future", contractEndDate: isoDateInKorea() }),
            contract({ documentId: "no-date", contractEndDate: null }),
            contract({ documentId: "exhausted", autoFinalizeAttempts: 3 }),
        ]);

        await service.autoFinalizeDueContracts();

        expect(finalizeUsecase.execute).not.toHaveBeenCalled();
    });

    it("records a failed attempt and keeps processing the rest of the batch", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "fails" }),
            contract({ documentId: "succeeds" }),
        ]);
        finalizeUsecase.execute
            .mockResolvedValueOnce({ ok: false, reason: "gate timeout", fallbackHint: "iframe", durationMs: 31_000 })
            .mockResolvedValueOnce({ ok: true, completed: true, durationMs: 900 });

        await service.autoFinalizeDueContracts();

        expect(repository.recordAutoFinalizeFailure).toHaveBeenCalledWith("fails", "gate timeout");
        expect(finalizeUsecase.execute).toHaveBeenCalledTimes(2);
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("continues an advanced provider step before recording final success", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "multi-step" }),
        ]);
        finalizeUsecase.execute
            .mockResolvedValueOnce({ ok: true, completed: false, durationMs: 700 })
            .mockResolvedValueOnce({ ok: true, completed: true, durationMs: 900 });

        await service.autoFinalizeDueContracts();

        expect(finalizeUsecase.execute).toHaveBeenCalledTimes(2);
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
    });

    it("notifies the branch exactly when the retry budget is exhausted", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "doc-1", autoFinalizeAttempts: 2 }),
        ]);
        finalizeUsecase.execute.mockResolvedValue({ ok: false, reason: "vendor 500", fallbackHint: "manual_check", durationMs: 5_000 });
        repository.recordAutoFinalizeFailure.mockResolvedValue(3);

        await service.autoFinalizeDueContracts();

        expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        const [branchId, , , data, options] = notificationService.sendToBranchUsers.mock.calls[0];
        expect(branchId).toBe("branch-1");
        expect(data).toMatchObject({
            type: CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE,
            documentId: "doc-1",
            url: "/contracts?documentId=doc-1",
        });
        expect(options).toEqual({
            dedupe: { type: CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE, documentId: "doc-1" },
        });
    });

    it("treats a thrown finalize like a failed attempt", async () => {
        repository.findReviewStageContracts.mockResolvedValue([contract()]);
        finalizeUsecase.execute.mockRejectedValue(new Error("browser crashed"));

        await service.autoFinalizeDueContracts();

        expect(repository.recordAutoFinalizeFailure).toHaveBeenCalledWith("doc-1", "browser crashed");
    });

    it("cannot notify without a branch and says so instead of throwing", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ branchId: null, autoFinalizeAttempts: 2 }),
        ]);
        finalizeUsecase.execute.mockResolvedValue({ ok: false, reason: "gate timeout", fallbackHint: "iframe", durationMs: 1_000 });
        repository.recordAutoFinalizeFailure.mockResolvedValue(3);

        await service.autoFinalizeDueContracts();

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });
});
