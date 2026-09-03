import { EformsignWebhookService } from "../../application/services/eformsign-webhook.service";
import { EformsignWebhookTrace } from "../../application/services/eformsign-webhook-trace";
import { EformsignWebhookPayloadDto } from "../../interface/dto/eformsign-webhook.dto";

/**
 * These tests call the private handlers directly, so they have to supply the
 * ledger trace the real caller builds. Nothing here asserts on it — an empty
 * payload is enough to satisfy the parameter.
 */
const trace = () => new EformsignWebhookTrace({} as EformsignWebhookPayloadDto);

/**
 * BJJ-247 contract-isolation guarantee: completing a SERVICE_RECORD snapshot document must NOT run
 * the contract-completion side effects (link eDocId / sync endDate), which
 * all funnel through handleCompletedDocument(). The gate keys on the document's template_id.
 */
const SERVICE_RECORD_TPL = "tpl_service_record_123";
const SERVICE_RECORD_TPL_10 = "tpl_service_record_10";
const SERVICE_RECORD_TPL_15 = "tpl_service_record_15";
const SERVICE_RECORD_TPL_20 = "tpl_service_record_20";
const CONTRACT_TPL = "tpl_contract_999";

function makeService() {
    const eformsignDocRepository = {
        claimCompletionStatus: jest.fn().mockResolvedValue("claimed"),
        findByDocumentId: jest.fn(),
    };
    const deps = {
        updateStatusUsecase: { execute: jest.fn() },
        linkDocumentUsecase: { execute: jest.fn() },
        syncClientEndDateUsecase: { execute: jest.fn() },
        eventBus: { emit: jest.fn() },
        notificationService: {},
        eformsignApiClient: { getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: "x" } }) },
        credentialBoundary: {
            withCredentials: jest.fn((
                _principal: unknown,
                _capability: unknown,
                operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
            ) => operation({ accessToken: "x", refreshToken: "r" })),
        },
        clientRepository: {},
        eformsignDocRepository,
        employeeScheduleRepository: {},
        employeeRepository: {},
        mirrorUnassignedDocUsecase: { execute: jest.fn() },
    };
    const service = new EformsignWebhookService(
        deps.updateStatusUsecase as any,
        deps.linkDocumentUsecase as any,
        deps.syncClientEndDateUsecase as any,
        deps.eventBus as any,
        deps.notificationService as any,
        deps.eformsignApiClient as any,
        deps.credentialBoundary as any,
        deps.clientRepository as any,
        deps.eformsignDocRepository as any,
        deps.employeeScheduleRepository as any,
        deps.employeeRepository as any,
        deps.mirrorUnassignedDocUsecase as any,
    );
    // Isolate the units downstream of the gate so the test targets the gate decision only.
    const handleCompleted = jest.spyOn(service as any, "handleCompletedDocument").mockResolvedValue(undefined);
    jest.spyOn(service as any, "notifyReviewRequiredIfNeeded").mockResolvedValue(undefined);
    return { service, handleCompleted };
}

const docEvent = (template_id: string) => ({
    id: "doc1", status: "doc_complete", document_title: "기록지", template_id, workflow_seq: 1, workflow_name: "wf",
});
const pdfEvent = (template_id: string) => ({
    document_id: "doc1", document_status: "doc_complete", template_id, workflow_seq: 1, workflow_name: "wf",
});

describe("EformsignWebhookService — service-record template_id gate", () => {
    // BJJ-multi-tier: the gate must match documents created on ANY configured tier's template.
    const TIER_ENV = {
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID: SERVICE_RECORD_TPL,
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_10: SERVICE_RECORD_TPL_10,
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_15: SERVICE_RECORD_TPL_15,
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_20: SERVICE_RECORD_TPL_20,
    } as const;
    const OLD: Record<string, string | undefined> = {};
    beforeAll(() => {
        for (const [key, value] of Object.entries(TIER_ENV)) {
            OLD[key] = process.env[key];
            process.env[key] = value;
        }
    });
    afterAll(() => {
        for (const key of Object.keys(TIER_ENV)) {
            if (OLD[key] === undefined) delete process.env[key];
            else process.env[key] = OLD[key];
        }
    });

    it("document event + contract template → runs contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleDocumentEvent("branch1", docEvent(CONTRACT_TPL), trace());
        expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it("document event + service-record template → SKIPS contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleDocumentEvent("branch1", docEvent(SERVICE_RECORD_TPL), trace());
        expect(handleCompleted).not.toHaveBeenCalled();
    });

    it("ready_document_pdf + contract template → runs contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleReadyDocumentPdfEvent("branch1", pdfEvent(CONTRACT_TPL), trace());
        expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it("ready_document_pdf + service-record template → SKIPS contract-completion side effects", async () => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleReadyDocumentPdfEvent("branch1", pdfEvent(SERVICE_RECORD_TPL), trace());
        expect(handleCompleted).not.toHaveBeenCalled();
    });

    it.each([
        ["10회", SERVICE_RECORD_TPL_10],
        ["15회", SERVICE_RECORD_TPL_15],
        ["20회", SERVICE_RECORD_TPL_20],
    ])("document event + %s tier template → SKIPS contract-completion side effects", async (_tier, templateId) => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleDocumentEvent("branch1", docEvent(templateId), trace());
        expect(handleCompleted).not.toHaveBeenCalled();
    });

    it.each([
        ["10회", SERVICE_RECORD_TPL_10],
        ["15회", SERVICE_RECORD_TPL_15],
        ["20회", SERVICE_RECORD_TPL_20],
    ])("ready_document_pdf + %s tier template → SKIPS contract-completion side effects", async (_tier, templateId) => {
        const { service, handleCompleted } = makeService();
        await (service as any).handleReadyDocumentPdfEvent("branch1", pdfEvent(templateId), trace());
        expect(handleCompleted).not.toHaveBeenCalled();
    });
});
