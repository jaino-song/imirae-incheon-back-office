import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { ReceiptLinkSkipError } from "application/services/receipt-link-issue.service";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";

jest.mock("infrastructure/tenant/run-system-scope", () => ({
    runSystemScope: jest.fn((fn: () => unknown) => fn()),
}));

const { runSystemScope } = require("infrastructure/tenant/run-system-scope") as {
    runSystemScope: jest.Mock;
};

const BRANCH = "11111111-1111-1111-1111-111111111111";

function makeService(overrides: { doc?: Record<string, unknown> | null; preflight?: () => Promise<unknown> } = {}) {
    const docRepository = {
        findByDocumentId: jest
            .fn()
            .mockResolvedValue(overrides.doc === undefined ? { id: 42, documentId: "doc-ext-1", clientId: 7 } : overrides.doc),
    };
    const ruleRepository = { ensureSystemRule: jest.fn().mockResolvedValue(undefined) };
    const issueService = {
        preflight: jest.fn(overrides.preflight ?? (async () => ({ client: { id: 7, name: "김산모", phone: "010-1234-5678", birthday: "940315" }, doc: { id: 42, documentId: "doc-ext-1" }, pdf: Buffer.alloc(1) }))),
    };
    const jobRepository = { upsertPending: jest.fn(async (job: any) => Object.assign(job, { id: "job-1" })) };
    const scheduler = { dispatchDueJobs: jest.fn().mockResolvedValue(undefined) };
    const approval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
    const service = new ReceiptLinkManualSendService(
        docRepository as never,
        ruleRepository as never,
        issueService as never,
        jobRepository as never,
        scheduler as never,
        approval as never,
    );
    return { service, docRepository, ruleRepository, issueService, jobRepository, scheduler, approval };
}

describe("ReceiptLinkManualSendService", () => {
    beforeEach(() => {
        runSystemScope.mockClear();
        runSystemScope.mockImplementation((fn: () => unknown) => fn());
    });

    it("enqueues a SERVICE_END_NOTICE job for the document's client and nudges the scheduler", async () => {
        const { service, docRepository, ruleRepository, jobRepository, scheduler, approval } = makeService();
        const result = await service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: "user-1" });

        expect(approval.ensureApproved).toHaveBeenCalledWith(BRANCH);
        expect(docRepository.findByDocumentId).toHaveBeenCalledWith(BRANCH, "doc-ext-1");
        expect(ruleRepository.ensureSystemRule).toHaveBeenCalledWith(
            expect.objectContaining({
                id: SERVICE_END_NOTICE_RULE_ID,
                branchId: null,
                templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            }),
        );
        const job = jobRepository.upsertPending.mock.calls[0]![0] as any;
        expect(job.templateKey).toBe(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        expect(job.ruleId).toBe(SERVICE_END_NOTICE_RULE_ID);
        expect(job.clientId).toBe(7);
        expect(job.recipientType).toBe(MessageTriggerRecipientType.CLIENT);
        expect(job.recipientPhone).toBe("01012345678");
        expect(job.dedupeKey).toMatch(new RegExp(`^${SERVICE_END_NOTICE_RULE_ID}:client:7:manual:`));
        expect(job.payload).toMatchObject({ clientId: 7, clientName: "김산모", memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: { name: "김산모", clientName: "김산모", phone: "01012345678" } });
        expect(scheduler.dispatchDueJobs).toHaveBeenCalledTimes(1);
        expect(runSystemScope).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ jobId: "job-1", scheduledFor: expect.any(Date), clientName: "김산모" });
    });

    it("404s for an unknown document and 400s for a document without a client", async () => {
        await expect(makeService({ doc: null }).service.send({ branchId: BRANCH, documentId: "x", userId: null })).rejects.toBeInstanceOf(NotFoundException);
        await expect(makeService({ doc: { id: 1, documentId: "x", clientId: null } }).service.send({ branchId: BRANCH, documentId: "x", userId: null }))
            .rejects.toMatchObject({ response: { reason: "document_not_linked" } });
    });

    it("surfaces preflight skip reasons as 400 without enqueueing", async () => {
        const { service, jobRepository } = makeService({ preflight: async () => { throw new ReceiptLinkSkipError("not_voucher_client"); } });
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).rejects.toMatchObject({ response: { reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" } });
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("400s when the client has no phone", async () => {
        const { service } = makeService({ preflight: async () => ({ client: { id: 7, name: "김산모", phone: null, birthday: "940315" }, doc: { id: 42, documentId: "d" }, pdf: Buffer.alloc(1) }) });
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).rejects.toMatchObject({ response: { reason: "missing_phone" } });
    });

    it("does not fail the request when the scheduler nudge throws", async () => {
        const { service, scheduler } = makeService();
        scheduler.dispatchDueJobs.mockRejectedValue(new Error("lease busy"));
        await expect(service.send({ branchId: BRANCH, documentId: "doc-ext-1", userId: null })).resolves.toMatchObject({ jobId: "job-1" });
    });
});
