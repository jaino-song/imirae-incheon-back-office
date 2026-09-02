import {
    ContractAutoFinalizeSchedulerService,
    CONTRACT_AUTO_FINALIZE_CRON,
    CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE,
    CONTRACT_AUTO_FINALIZE_TIME_ZONE,
} from "application/services/contract-auto-finalize-scheduler.service";
import type { ReviewStageContract } from "domain/repositories/eformsign-doc.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

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
    let documentJobService: { enqueueFinalizeDocument: jest.Mock };
    let notificationService: { sendToBranchUsers: jest.Mock };
    let systemSettingService: { getContractAutoFinalizeConfig: jest.Mock };
    let service: ContractAutoFinalizeSchedulerService;

    beforeEach(() => {
        configValues = {
            CONTRACT_AUTO_FINALIZE_ENABLED: "true",
            CONTRACT_AUTO_FINALIZE_SINCE: sinceDate,
            EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED: "true",
        };
        repository = {
            findReviewStageContracts: jest.fn().mockResolvedValue([]),
            recordAutoFinalizeFailure: jest.fn().mockResolvedValue(1),
        };
        documentJobService = {
            enqueueFinalizeDocument: jest.fn().mockResolvedValue({
                job: { id: "job-1", status: "queued" },
                existing: false,
            }),
        };
        notificationService = { sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) };
        systemSettingService = {
            getContractAutoFinalizeConfig: jest.fn().mockResolvedValue({ enabled: true, graceDays: 0, maxAttempts: 3 }),
        };
        service = new ContractAutoFinalizeSchedulerService(
            { get: (key: string) => configValues[key] } as never,
            repository as never,
            documentJobService as never,
            notificationService as never,
            createSchedulerLeaseMock(),
            systemSettingService as never,
        );
    });

    it("runs every day at 17:00 KST", () => {
        expect(CONTRACT_AUTO_FINALIZE_CRON).toBe("0 17 * * *");
        expect(CONTRACT_AUTO_FINALIZE_TIME_ZONE).toBe("Asia/Seoul");
    });

    it("does nothing while the kill-switch is off", async () => {
        configValues["CONTRACT_AUTO_FINALIZE_ENABLED"] = undefined;
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
    });

    it("does not produce jobs while the accepting flag is off", async () => {
        configValues["EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED"] = "false";
        repository.findReviewStageContracts.mockResolvedValue([contract()]);

        await service.autoFinalizeDueContracts();

        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
        expect(documentJobService.enqueueFinalizeDocument).not.toHaveBeenCalled();
    });

    it("refuses to run without a valid activation date (the backlog fence)", async () => {
        configValues["CONTRACT_AUTO_FINALIZE_SINCE"] = undefined;
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();

        configValues["CONTRACT_AUTO_FINALIZE_SINCE"] = "08/08/2026";
        await service.autoFinalizeDueContracts();
        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
    });

    it("enqueues a due contract with its stored end date prefilled", async () => {
        const due = contract({ contractEndDate: isoDateInKorea() });
        repository.findReviewStageContracts.mockResolvedValue([due]);

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledTimes(1);
        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledWith({
            branchId: "branch-1",
            requestKey: `auto_finalize:doc-1:${isoDateInKorea()}`,
            documentId: "doc-1",
            prefillEndDate: due.contractEndDate,
            source: "auto_finalize",
            createdByUserId: null,
        });
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
    });

    it("enqueues exactly once per eligible document without calling the browser finalizer", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "doc-1" }),
            contract({ documentId: "doc-2" }),
        ]);

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledTimes(2);
        expect(documentJobService.enqueueFinalizeDocument.mock.calls.map(([input]) => input.documentId))
            .toEqual(["doc-1", "doc-2"]);
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
    });

    it("skips ineligible contracts: future end date, missing end date, exhausted retries", async () => {
        const tomorrowKst = isoDateInKorea(new Date(Date.now() + 24 * 60 * 60 * 1000));
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "future", contractEndDate: tomorrowKst }),
            contract({ documentId: "no-date", contractEndDate: null }),
            contract({ documentId: "exhausted", autoFinalizeAttempts: 3 }),
        ]);

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).not.toHaveBeenCalled();
    });

    it("keeps processing the rest of the batch when queue production fails", async () => {
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "fails" }),
            contract({ documentId: "succeeds" }),
        ]);
        documentJobService.enqueueFinalizeDocument
            .mockRejectedValueOnce(new Error("queue unavailable"))
            .mockResolvedValueOnce({ job: { id: "job-2", status: "queued" }, existing: false });

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledTimes(2);
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("does not increment attempts when an active staff or auto job already exists", async () => {
        const due = contract({ documentId: "already-active" });
        repository.findReviewStageContracts.mockResolvedValue([due]);
        documentJobService.enqueueFinalizeDocument.mockResolvedValue({
            job: { id: "staff-job", status: "processing" },
            existing: true,
        });

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledWith({
            branchId: "branch-1",
            requestKey: `auto_finalize:already-active:${isoDateInKorea()}`,
            documentId: "already-active",
            prefillEndDate: due.contractEndDate,
            source: "auto_finalize",
            createdByUserId: null,
        });
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("keeps the existing branch exhaustion notification callable for terminal worker handling", async () => {
        const notifyExhausted = (service as unknown as {
            notifyExhausted: (contract: ReviewStageContract, reason: string) => Promise<void>;
        }).notifyExhausted;
        await notifyExhausted.call(service, contract({ documentId: "doc-1" }), "vendor 500");

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

    it("increments the provider failure budget once and notifies on exhaustion", async () => {
        repository.findReviewStageContracts.mockResolvedValue([contract({ documentId: "doc-1" })]);

        await service.recordTerminalFailure("doc-1", "PRE_SEND_RETRY_EXHAUSTED", 3);

        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
    });

    it("fails closed when an eligible document has no authoritative branch", async () => {
        repository.findReviewStageContracts.mockResolvedValue([contract({ branchId: null })]);

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).not.toHaveBeenCalled();
        expect(repository.recordAutoFinalizeFailure).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("skips the run when the scheduler lease is not held", async () => {
        service = new ContractAutoFinalizeSchedulerService(
            { get: (key: string) => configValues[key] } as never,
            repository as never,
            documentJobService as never,
            notificationService as never,
            createSchedulerLeaseMock(false),
        );

        await service.autoFinalizeDueContracts();

        expect(repository.findReviewStageContracts).not.toHaveBeenCalled();
    });

    it("stops when the lease is lost mid-run", async () => {
        const schedulerLease = createSchedulerLeaseMock(false);
        schedulerLease.holdsLease.mockReturnValueOnce(true).mockReturnValueOnce(true);
        service = new ContractAutoFinalizeSchedulerService(
            { get: (key: string) => configValues[key] } as never,
            repository as never,
            documentJobService as never,
            notificationService as never,
            schedulerLease,
        );
        repository.findReviewStageContracts.mockResolvedValue([
            contract({ documentId: "doc-1" }),
            contract({ documentId: "doc-2" }),
        ]);

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledTimes(1);
        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledWith(
            expect.objectContaining({ documentId: "doc-1" }),
        );
    it("skips disabled branches while enqueuing enabled branches", async () => {
        const disabled = contract({ documentId: "disabled", branchId: "branch-disabled" });
        const enabled = contract({ documentId: "enabled", branchId: "branch-enabled" });
        repository.findReviewStageContracts.mockResolvedValue([disabled, enabled]);
        systemSettingService.getContractAutoFinalizeConfig.mockImplementation(async (branchId: string) => ({
            enabled: branchId !== "branch-disabled",
            graceDays: 0,
            maxAttempts: 3,
        }));

        await service.autoFinalizeDueContracts();

        expect(documentJobService.enqueueFinalizeDocument.mock.calls.map(([input]) => input.documentId)).toEqual(["enabled"]);
        expect(systemSettingService.getContractAutoFinalizeConfig).toHaveBeenCalledTimes(2);
    });

    it("uses a branch max-attempts budget for terminal notifications", async () => {
        systemSettingService.getContractAutoFinalizeConfig.mockResolvedValue({ enabled: true, graceDays: 0, maxAttempts: 1 });
        repository.findReviewStageContracts.mockResolvedValue([contract({ documentId: "doc-1", autoFinalizeAttempts: 1 })]);

        await service.recordTerminalFailure("doc-1", "vendor 500", 1);

        expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        expect(notificationService.sendToBranchUsers.mock.calls[0][2]).toContain("1회");
    });
});
