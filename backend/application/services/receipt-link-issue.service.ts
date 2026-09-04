import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { ClientEntity } from "domain/entities/client.entity";
import {
    FILE_STORAGE_PORT,
    FileStorageObjectNotFoundError,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import {
    EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import {
    IReceiptLinkTokenRepository,
    RECEIPT_LINK_TOKEN_REPOSITORY,
} from "domain/repositories/receipt-link-token.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EformsignDocumentMirrorService } from "./eformsign-document-mirror.service";
import { normalizeBirthdayInput, ReceiptLinkSource, ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "./sms-trigger-payload-enricher.registry";

export const RECEIPT_PAGE_NUMBER = 7;
export const RECEIPT_IMAGE_WIDTH = 1240;
const DEFAULT_RECEIPT_BASE_URL = "https://m.admin.babyjamjam.com";

export type ReceiptLinkSkipReason =
    | "not_voucher_client"
    | "missing_birthday"
    | "no_contract_document"
    | "pdf_unavailable"
    | "render_failed"
    | "upload_failed";

export const RECEIPT_LINK_SKIP_MESSAGES: Record<ReceiptLinkSkipReason, string> = {
    not_voucher_client: "바우처 이용 산모가 아닙니다",
    missing_birthday: "산모 생년월일이 등록되지 않았습니다",
    no_contract_document: "연결된 계약서가 없습니다",
    pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다",
    render_failed: "영수증 이미지 생성에 실패했습니다",
    upload_failed: "영수증 이미지 저장에 실패했습니다",
};

export class ReceiptLinkSkipError extends SmsTriggerDeliverySkipError {
    constructor(readonly skipReason: ReceiptLinkSkipReason) {
        super(skipReason, RECEIPT_LINK_SKIP_MESSAGES[skipReason]);
        this.name = "ReceiptLinkSkipError";
    }
}

export interface ReceiptLinkPreflight {
    client: { id: number; name: string; phone: string | null; birthday: string };
    doc: { id: number; documentId: string };
    pdf: Buffer;
}

export interface IssueReceiptLinkParams {
    branchId: string;
    clientId: number;
    source: ReceiptLinkSource;
    jobId?: string | null;
    createdBy?: string | null;
    /**
     * The payload's current receipt url, supplied only when the caller already has one (e.g. a
     * re-run enrichment for a dispatch job). When `jobId` names a job that already has an active
     * token, this is what `issue` returns as-is instead of minting a second token — see the
     * idempotence note on `issue` below.
     */
    existingUrl?: string;
    /**
     * The exact contract document the caller already resolved (numeric `eformsign_doc.id`), when
     * one is known — e.g. a manual send pins the document the staff selected in the UI. When
     * present, `preflight` renders THIS document instead of re-deriving one from
     * `client.eDocId`/newest-contract, which can point elsewhere after a contract re-issue. When
     * absent, the client-derived auto path is unchanged.
     */
    eformsignDocId?: number;
}

export interface IssuedReceiptLink {
    url: string;
    tokenId: string;
    expiresAt: Date;
}

interface ContractDocumentRef {
    id: number;
    documentId: string;
}

@Injectable()
export class ReceiptLinkIssueService {
    private readonly logger = new Logger(ReceiptLinkIssueService.name);

    constructor(
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY)
        private readonly mirrorRepository: IEformsignDocumentMirrorRepository,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
        private readonly configService: ConfigService,
        private readonly rasterizer: PdfPageRasterizerService,
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
        @Inject(RECEIPT_LINK_TOKEN_REPOSITORY)
        private readonly receiptLinkTokenRepository: IReceiptLinkTokenRepository,
    ) {}

    /** Steps 1-4 of the pipeline: voucher, birthday, contract document, mirrored PDF. No rendering. */
    async preflight(params: { branchId: string; clientId: number; eformsignDocId?: number }): Promise<ReceiptLinkPreflight> {
        const client = await this.clientRepository.findById(params.branchId, params.clientId);
        if (!client) throw new ReceiptLinkSkipError("no_contract_document");
        if (!client.voucherClient) throw new ReceiptLinkSkipError("not_voucher_client");

        // normalizeBirthdayInput accepts both 6-digit (YYMMDD) and 8-digit (YYYYMMDD) input and
        // returns the canonical 6-digit form — the same normalization issue() relies on, so a
        // birthday that would fail there must be caught here instead, not just an empty one.
        const birthday = normalizeBirthdayInput(client.birthday ?? "");
        if (!birthday) throw new ReceiptLinkSkipError("missing_birthday");

        const doc = params.eformsignDocId !== undefined
            ? await this.findExplicitContractDocument(params.branchId, params.eformsignDocId, client.id)
            : await this.findContractDocument(params.branchId, client);
        if (!doc) throw new ReceiptLinkSkipError("no_contract_document");

        const pdf = await this.loadContractPdf(params.branchId, doc);
        if (!pdf) throw new ReceiptLinkSkipError("pdf_unavailable");

        return { client: { id: client.id, name: client.name, phone: client.phone, birthday }, doc, pdf };
    }

    /**
     * Idempotent per `jobId`: `SmsTriggerDeliveryService` may invoke this more than once for the
     * same dispatch job (e.g. a delivery that converges onto an earlier acceptance and never
     * sends). When an active token already exists for `jobId` and the caller supplies
     * `existingUrl` (the payload's current url), that url is returned as-is with no render,
     * upload, or mint. Plaintext link tokens are never stored, so without `existingUrl` there is
     * nothing to return — this mints anew, which is safe: `ReceiptLinkTokenService.issue`
     * revokes the document's previously active token as part of the same write.
     */
    async issue(params: IssueReceiptLinkParams): Promise<IssuedReceiptLink> {
        const now = new Date();
        if (params.jobId) {
            const active = await this.receiptLinkTokenRepository.findActiveByJobId(params.jobId);
            // An "active" row can still be past its expiresAt (nightly cleanup hasn't reaped it
            // yet) — short-circuiting on that would hand the caller back a dead link. Fall
            // through to mint a fresh one instead.
            if (active && active.expiresAt.getTime() > now.getTime() && params.existingUrl) {
                return { url: params.existingUrl, tokenId: active.id, expiresAt: active.expiresAt };
            }
        }

        const { client, doc, pdf } = await this.preflight(params);

        let png: Buffer;
        try {
            png = await this.rasterizer.renderPageToPng(pdf, RECEIPT_PAGE_NUMBER, { width: RECEIPT_IMAGE_WIDTH });
        } catch (error) {
            this.logger.error(`[ReceiptLink] render failed for document ${doc.documentId}: ${describe(error)}`);
            throw new ReceiptLinkSkipError("render_failed");
        }

        const contentSha256 = createHash("sha256").update(png).digest("hex");
        const storagePath = `receipts/${params.branchId}/${doc.id}/${contentSha256}.png`;
        const alreadyStored = await this.receiptLinkTokenRepository.existsByStoragePath(storagePath);
        let shouldUpload = !alreadyStored;
        if (alreadyStored) {
            try {
                await this.storage.download(storagePath);
            } catch (error) {
                if (error instanceof FileStorageObjectNotFoundError) {
                    shouldUpload = true;
                } else {
                    this.logger.error(`[ReceiptLink] storage check failed for ${storagePath}: ${describe(error)}`);
                    throw new ReceiptLinkSkipError("upload_failed");
                }
            }
        }
        if (shouldUpload) {
            try {
                await this.storage.upload(png, storagePath, "image/png");
            } catch (error) {
                if (!isAlreadyExistsError(error)) {
                    this.logger.error(`[ReceiptLink] upload failed for ${storagePath}: ${describe(error)}`);
                    throw new ReceiptLinkSkipError("upload_failed");
                }
            }
        }

        const token = await this.tokenService.issue({
            branchId: params.branchId,
            clientId: client.id,
            eformsignDocId: doc.id,
            jobId: params.jobId ?? null,
            birthday: client.birthday,
            storagePath,
            contentSha256,
            byteSize: png.length,
            source: params.source,
            createdBy: params.createdBy ?? null,
        });

        return { url: this.buildReceiptUrl(token.linkToken), tokenId: token.id, expiresAt: token.expiresAt };
    }

    buildReceiptUrl(linkToken: string): string {
        const base =
            this.configService.get<string>("MOBILE_RECEIPT_BASE_URL")
            || this.configService.get<string>("MOBILE_SERVICE_RECORD_BASE_URL")
            || DEFAULT_RECEIPT_BASE_URL;
        return `${base.replace(/\/+$/, "")}/receipt/${linkToken}`;
    }

    private async findContractDocument(branchId: string, client: ClientEntity): Promise<ContractDocumentRef | null> {
        if (client.eDocId) {
            const byEDocId = await this.eformsignDocRepository.findByDocumentId(branchId, client.eDocId);
            if (
                byEDocId
                && byEDocId.id !== undefined
                && byEDocId.documentKind === "contract"
                && byEDocId.clientId === client.id
            ) {
                return { id: byEDocId.id, documentId: byEDocId.documentId };
            }
        }

        const docs = await this.eformsignDocRepository.findByClientId(branchId, client.id);
        const latest = docs
            .filter((doc) => doc.documentKind === "contract" && doc.id !== undefined)
            .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];
        return latest ? { id: latest.id as number, documentId: latest.documentId } : null;
    }

    /**
     * The explicit-selection counterpart to `findContractDocument`: resolves exactly the
     * document the caller named (by numeric id), requiring it to actually be a contract
     * belonging to this client. Never falls back to client.eDocId or the newest contract — an
     * explicit selection that doesn't check out is `no_contract_document`, not a silent
     * substitution.
     */
    private async findExplicitContractDocument(
        branchId: string,
        eformsignDocId: number,
        clientId: number,
    ): Promise<ContractDocumentRef | null> {
        const doc = await this.eformsignDocRepository.findById(branchId, eformsignDocId);
        if (!doc || doc.id === undefined || doc.documentKind !== "contract" || doc.clientId !== clientId) {
            return null;
        }
        return { id: doc.id, documentId: doc.documentId };
    }

    private async loadContractPdf(branchId: string, doc: ContractDocumentRef): Promise<Buffer | null> {
        const stored = await this.findStoredPdf(doc.documentId);
        if (stored) return stored;

        try {
            await this.documentMirrorService.syncDocument(
                doc.documentId,
                { branchId, source: "worker" },
                {
                    skipBranchOwnedProjection: true,
                    skipClientReconciliation: true,
                    skipHealthySameVersionFileRepair: true,
                    suppressOutboundAutomation: true,
                },
            );
        } catch (error) {
            this.logger.warn(
                `[ReceiptLink] mirror re-sync failed for ${doc.documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            return null;
        }
        return this.findStoredPdf(doc.documentId);
    }

    private async findStoredPdf(documentId: string): Promise<Buffer | null> {
        const file = await this.mirrorRepository.findFile(documentId, "document");
        return file?.content ? Buffer.from(file.content) : null;
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
    return /already exists|duplicate/i.test(describe(error));
}
