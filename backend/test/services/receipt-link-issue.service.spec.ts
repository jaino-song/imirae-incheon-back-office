import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { ClientEntity } from "domain/entities/client.entity";
import { FileStoragePort } from "domain/ports/file-storage.port";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import {
    EformsignStoredDocumentFile,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import { IReceiptLinkTokenRepository } from "domain/repositories/receipt-link-token.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "application/services/sms-trigger-payload-enricher.registry";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "application/services/receipt-link-issue.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";
const PDF = Buffer.from("%PDF-1.4 fake");
const PNG = Buffer.from("png-bytes");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const ISSUED_TOKEN = { id: "tok-1", linkToken: "efr_abc", expiresAt: new Date("2026-10-03T00:00:00Z") };

interface ClientFixture {
    id: number;
    name: string;
    phone: string | null;
    voucherClient: boolean;
    birthday: string | null;
    eDocId: string | null;
}

interface DocFixture {
    id: number;
    documentId: string;
    documentKind?: string | null;
    createdDate?: Date;
    clientId?: number | null;
}

interface MakeServiceOverrides {
    client?: ClientFixture | null;
    doc?: DocFixture | null;
    docsByClient?: DocFixture[];
    file?: { content: Buffer } | null;
    activeTokenForJob?: { id: string; expiresAt: Date } | null;
    storedPath?: boolean;
    baseUrl?: string;
    serviceRecordBaseUrl?: string;
}

function makeService(overrides: MakeServiceOverrides = {}) {
    const client: ClientFixture | null =
        overrides.client === undefined
            ? { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: "doc-ext-1" }
            : overrides.client;
    const doc: DocFixture | null =
        overrides.doc === undefined
            ? { id: 42, documentId: "doc-ext-1", documentKind: "contract", createdDate: new Date("2026-01-01"), clientId: 7 }
            : overrides.doc;

    const clientRepository = {
        findById: jest.fn().mockResolvedValue(client as unknown as ClientEntity | null),
    } as unknown as IClientRepository;

    const eformsignDocRepository = {
        findByDocumentId: jest.fn().mockResolvedValue(doc as unknown as EformsignDocEntity | null),
        findByClientId: jest
            .fn()
            .mockResolvedValue((overrides.docsByClient ?? (doc ? [doc] : [])) as unknown as EformsignDocEntity[]),
    } as unknown as IEformsignDocRepository;

    const mirrorRepository = {
        findFile: jest
            .fn()
            .mockResolvedValue(
                (overrides.file === undefined ? { content: PDF } : overrides.file) as unknown as EformsignStoredDocumentFile | null,
            ),
    } as unknown as IEformsignDocumentMirrorRepository;

    const documentMirrorService = {
        syncDocument: jest.fn().mockResolvedValue({}),
    } as unknown as EformsignDocumentMirrorService;

    const receiptLinkTokenRepository = {
        existsByStoragePath: jest.fn().mockResolvedValue(!!overrides.storedPath),
        findActiveByJobId: jest.fn().mockResolvedValue(overrides.activeTokenForJob ?? null),
    } as unknown as IReceiptLinkTokenRepository;

    const config = {
        get: jest.fn((key: string) => {
            if (key === "MOBILE_RECEIPT_BASE_URL") return overrides.baseUrl ?? "https://m.admin.example/";
            if (key === "MOBILE_SERVICE_RECORD_BASE_URL") return overrides.serviceRecordBaseUrl;
            return undefined;
        }),
    } as unknown as ConfigService;

    const rasterizer = {
        renderPageToPng: jest.fn().mockResolvedValue(PNG),
    } as unknown as PdfPageRasterizerService;

    const tokenService = {
        issue: jest.fn().mockResolvedValue(ISSUED_TOKEN),
    } as unknown as ReceiptLinkTokenService;

    const storage: FileStoragePort = {
        upload: jest.fn().mockResolvedValue("receipts/x"),
        download: jest.fn(),
        delete: jest.fn(),
        createSignedUrl: jest.fn(),
        ensureBucketExists: jest.fn(),
    };

    const service = new ReceiptLinkIssueService(
        clientRepository,
        eformsignDocRepository,
        mirrorRepository,
        documentMirrorService,
        config,
        rasterizer,
        tokenService,
        storage,
        receiptLinkTokenRepository,
    );

    return {
        service,
        clientRepository,
        eformsignDocRepository,
        mirrorRepository,
        documentMirrorService,
        receiptLinkTokenRepository,
        config,
        rasterizer,
        tokenService,
        storage,
    };
}

describe("ReceiptLinkIssueService", () => {
    it("renders page 7, uploads under a content-addressed path, issues a token and builds the url", async () => {
        const { service, rasterizer, storage, tokenService, clientRepository } = makeService();
        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1" });

        expect(clientRepository.findById).toHaveBeenCalledWith(BRANCH, 7);
        // Literal 7 and literal { width: 1240 } on purpose: asserting against the
        // RECEIPT_PAGE_NUMBER/RECEIPT_IMAGE_WIDTH constants the implementation itself imports
        // would make this a tautology — a mutated constant would move both sides together.
        expect(rasterizer.renderPageToPng).toHaveBeenCalledWith(PDF, 7, { width: 1240 });
        expect(storage.upload).toHaveBeenCalledWith(PNG, `receipts/${BRANCH}/42/${PNG_SHA}.png`, "image/png");
        expect(tokenService.issue).toHaveBeenCalledWith(
            expect.objectContaining({
                branchId: BRANCH,
                clientId: 7,
                eformsignDocId: 42,
                jobId: "job-1",
                birthday: "940315",
                storagePath: `receipts/${BRANCH}/42/${PNG_SHA}.png`,
                contentSha256: PNG_SHA,
                byteSize: PNG.length,
                source: "auto_trigger",
            }),
        );
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it.each([
        ["not_voucher_client", { client: { id: 7, name: "김산모", phone: null, voucherClient: false, birthday: "940315", eDocId: null } }],
        ["missing_birthday", { client: { id: 7, name: "김산모", phone: null, voucherClient: true, birthday: null, eDocId: null } }],
        // 4 digits: normalizeBirthdayInput only accepts 6 (YYMMDD) or 8 (YYYYMMDD) digit input.
        ["missing_birthday", { client: { id: 7, name: "김산모", phone: null, voucherClient: true, birthday: "9403", eDocId: null } }],
        ["no_contract_document", { doc: null }],
        ["no_contract_document", { client: null }],
        // eDocId points at a real document, but it's the wrong kind (a service-record snapshot,
        // not a contract) and the findByClientId fallback finds nothing either.
        [
            "no_contract_document",
            {
                doc: { id: 42, documentId: "doc-ext-1", documentKind: "service_record_snapshot", clientId: 7 },
                docsByClient: [],
            },
        ],
        // eDocId points at a real contract, but it belongs to a different client (a stale/foreign
        // pointer), and the fallback finds nothing either.
        [
            "no_contract_document",
            {
                doc: { id: 42, documentId: "doc-ext-1", documentKind: "contract", clientId: 999 },
                docsByClient: [],
            },
        ],
    ] as const)("skips with %s", async (reason, overrides) => {
        const { service, rasterizer } = makeService(overrides as MakeServiceOverrides);
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: reason });
        expect(rasterizer.renderPageToPng).not.toHaveBeenCalled();
    });

    it("re-syncs the mirror once when the pdf is missing, then skips with pdf_unavailable if still missing", async () => {
        const { service, mirrorRepository, documentMirrorService } = makeService({ file: null });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).rejects.toMatchObject({ skipReason: "pdf_unavailable" });
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-ext-1",
            { branchId: BRANCH, source: "worker" },
            expect.objectContaining({ suppressOutboundAutomation: true }),
        );
        expect(mirrorRepository.findFile).toHaveBeenCalledTimes(2);
    });

    it("uses the pdf that the re-sync brought in", async () => {
        const { service, mirrorRepository } = makeService({ file: null });
        (mirrorRepository.findFile as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ content: PDF });
        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });
        expect(preflight.pdf.equals(PDF)).toBe(true);
    });

    it("skips with pdf_unavailable when the mirror re-sync itself throws", async () => {
        const { service, documentMirrorService } = makeService({ file: null });
        (documentMirrorService.syncDocument as jest.Mock).mockRejectedValue(
            new Error("vendor 500: Bearer abcd1234efgh5678"),
        );
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).rejects.toMatchObject({ skipReason: "pdf_unavailable" });
    });

    it("picks the latest contract document by createdDate when falling back to findByClientId", async () => {
        const client: ClientFixture = { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: null };
        const docs: DocFixture[] = [
            { id: 10, documentId: "old", documentKind: "contract", createdDate: new Date("2025-01-01"), clientId: 7 },
            { id: 20, documentId: "new", documentKind: "contract", createdDate: new Date("2026-06-01"), clientId: 7 },
            { id: 30, documentId: "snap", documentKind: "service_record_snapshot", createdDate: new Date("2026-08-01"), clientId: 7 },
        ];
        const { service } = makeService({ client, doc: null, docsByClient: docs });

        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });

        expect(preflight.doc).toEqual({ id: 20, documentId: "new" });
    });

    it("maps renderer and storage failures to skip reasons", async () => {
        const { service: renderFail, rasterizer } = makeService();
        (rasterizer.renderPageToPng as jest.Mock).mockRejectedValue(new Error("boom"));
        await expect(renderFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "render_failed" });

        const { service: uploadFail, storage } = makeService();
        (storage.upload as jest.Mock).mockRejectedValue(new Error("network"));
        await expect(uploadFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "upload_failed" });
    });

    it("skips the upload when the same image is already stored, and tolerates an already-exists error", async () => {
        const { service: stored, storage: storedStorage, tokenService: storedTokenService } = makeService({ storedPath: true });
        await stored.issue({ branchId: BRANCH, clientId: 7, source: "manual" });
        expect(storedStorage.upload).not.toHaveBeenCalled();
        expect(storedTokenService.issue).toHaveBeenCalledTimes(1);

        const { service, storage } = makeService();
        (storage.upload as jest.Mock).mockRejectedValue(new Error("The resource already exists"));
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).resolves.toMatchObject({ tokenId: "tok-1" });
    });

    it("falls back to MOBILE_SERVICE_RECORD_BASE_URL when MOBILE_RECEIPT_BASE_URL is unset", () => {
        const { service } = makeService({ baseUrl: "", serviceRecordBaseUrl: "https://legacy.example/" });
        expect(service.buildReceiptUrl("efr_t")).toBe("https://legacy.example/receipt/efr_t");
    });

    it("falls back to the production host when neither base url is configured", () => {
        const { service } = makeService({ baseUrl: "" });
        expect(service.buildReceiptUrl("efr_t")).toBe("https://m.admin.babyjamjam.com/receipt/efr_t");
    });

    it("is a ReceiptLinkSkipError with a Korean message", () => {
        const error = new ReceiptLinkSkipError("missing_birthday");
        expect(error.message).toBe("산모 생년월일이 등록되지 않았습니다");
        expect(error.reason).toBe("missing_birthday");
        expect(error).toBeInstanceOf(SmsTriggerDeliverySkipError);
    });

    it("returns the existing token's url without rendering when an active token exists for the job and existingUrl is supplied", async () => {
        const activeExpiresAt = new Date("2026-10-01T00:00:00Z");
        const { service, rasterizer, storage, tokenService, receiptLinkTokenRepository, clientRepository } = makeService({
            activeTokenForJob: { id: "existing-tok", expiresAt: activeExpiresAt },
        });

        const result = await service.issue({
            branchId: BRANCH,
            clientId: 7,
            source: "auto_trigger",
            jobId: "job-1",
            existingUrl: "https://m.admin.example/receipt/efr_existing",
        });

        expect(receiptLinkTokenRepository.findActiveByJobId).toHaveBeenCalledWith("job-1");
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_existing", tokenId: "existing-tok", expiresAt: activeExpiresAt });
        // Proves the jobId short-circuit runs before preflight ever touches the client.
        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(rasterizer.renderPageToPng).not.toHaveBeenCalled();
        expect(storage.upload).not.toHaveBeenCalled();
        expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it("mints a new token when an active token exists for the job but no existingUrl is supplied", async () => {
        const { service, rasterizer, storage, tokenService } = makeService({
            activeTokenForJob: { id: "existing-tok", expiresAt: new Date("2026-10-01T00:00:00Z") },
        });

        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1" });

        expect(rasterizer.renderPageToPng).toHaveBeenCalled();
        expect(storage.upload).toHaveBeenCalled();
        expect(tokenService.issue).toHaveBeenCalled();
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it("mints anew when the active token for the job is already expired, even with existingUrl supplied", async () => {
        const { service, rasterizer, storage, tokenService } = makeService({
            activeTokenForJob: { id: "stale-tok", expiresAt: new Date("2020-01-01T00:00:00Z") },
        });

        const result = await service.issue({
            branchId: BRANCH,
            clientId: 7,
            source: "auto_trigger",
            jobId: "job-1",
            existingUrl: "https://m.admin.example/receipt/efr_stale",
        });

        expect(rasterizer.renderPageToPng).toHaveBeenCalled();
        expect(storage.upload).toHaveBeenCalled();
        expect(tokenService.issue).toHaveBeenCalled();
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });
});
