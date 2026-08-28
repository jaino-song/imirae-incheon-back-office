import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    EFORMSIGN_STUB_COMPANY_ID,
    EFORMSIGN_STUB_TEMPLATE_ID,
    EFORMSIGN_STUB_USER_EMAIL,
    areE2EVendorStubsEnabled,
    buildEformsignStubDeleteResponse,
    buildEformsignStubDocument,
    buildEformsignStubListResponse,
    buildEformsignStubPdf,
    buildEformsignStubReRequestResponse,
} from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { ContractDataDto } from "../dto/contract.dto";
import { EFORMSIGN_END_DATE_FIELD_IDS } from "../usecases/eformsign-doc/eformsign-end-date-field-ids";
import { EformsignDocumentSnapshotService } from "./eformsign-document-snapshot.service";
import {
    EformsignApiError,
    extractEformsignVendorCode,
} from "infrastructure/api/eformsign-api.error";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { normalizeKoreanWon } from "domain/value-objects/money.vo";

export interface EformsignDocumentWorkflowState {
    statusCode?: string;
    stepType?: string;
    stepIndex?: string;
    stepName?: string;
}

const ISO_END_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const EFORMSIGN_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const EFORMSIGN_DOWNLOAD_TIMEOUT_MS = 30_000;
export const EFORMSIGN_STATUS_READ_TIMEOUT_MS = 2_000;
// Deletion is non-idempotent, so one bounded attempt is safer than retries.
// Keep the same total request-and-body budget used by the API client.
export const EFORMSIGN_DELETE_TIMEOUT_MS = 30_000;

function normalizeEformsignAmount(value: string): string {
    if (value.trim() === "") return "";
    return normalizeKoreanWon(value) ?? "";
}

export function getDocumentCreatedTimestamp(document: { created_date?: unknown; createdDate?: unknown }): number {
    const value = document.created_date ?? document.createdDate;

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === "string") {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue) && value.trim() !== "") {
            return numericValue;
        }

        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    return 0;
}

@Injectable()
export class EformsignService {
    private readonly logger = new Logger(EformsignService.name);
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string;
    private readonly EFORMSIGN_DOC_API_URL: string;
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly EFORMSIGN_TEMPLATE_ID: string;
    private readonly isConfigured: boolean;
    private readonly vendorStubsEnabled: boolean;

    constructor(
        private configService: ConfigService,
        @Optional()
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository?: IEformsignDocRepository,
        @Optional()
        private readonly documentSnapshotService?: EformsignDocumentSnapshotService,
    ) {
        this.vendorStubsEnabled = areE2EVendorStubsEnabled(this.configService);
        this.USER_EMAIL = this.configService.get<string>("EFORMSIGN_USER_EMAIL") || (this.vendorStubsEnabled ? EFORMSIGN_STUB_USER_EMAIL : "");
        this.EFORMSIGN_API_URL = this.configService.get<string>("EFORMSIGN_API_URL") || "";
        this.EFORMSIGN_DOC_API_URL = this.configService.get<string>("EFORMSIGN_DOC_API_URL") || "";
        this.EFORMSIGN_API_KEY = this.configService.get<string>("EFORMSIGN_API_KEY") || "";
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get<string>("EFORMSIGN_PRIVATE_KEY") || "";
        this.EFORMSIGN_COMPANY_ID = this.configService.get<string>("EFORMSIGN_COMPANY_ID") || (this.vendorStubsEnabled ? EFORMSIGN_STUB_COMPANY_ID : "");
        this.EFORMSIGN_TEMPLATE_ID = this.configService.get<string>("EFORMSIGN_TEMPLATE_ID") || (this.vendorStubsEnabled ? EFORMSIGN_STUB_TEMPLATE_ID : "");
        this.isConfigured = this.vendorStubsEnabled || Boolean(
            this.USER_EMAIL &&
            this.EFORMSIGN_API_URL &&
            this.EFORMSIGN_DOC_API_URL &&
            this.EFORMSIGN_API_KEY &&
            this.EFORMSIGN_PRIVATE_KEY &&
            this.EFORMSIGN_COMPANY_ID &&
            this.EFORMSIGN_TEMPLATE_ID,
        );

        if (this.vendorStubsEnabled) {
            this.logger.warn("E2E vendor stubs enabled for eformsign integration.");
        } else if (!this.isConfigured) {
            this.logger.warn("Eformsign environment variables are not fully configured. Eformsign features will be disabled.");
        }
    }

    /**
     * Generate eformsign signature using SHA256withECDSA
     * According to eformsign API docs:
     * - Uses asymmetric key with Elliptic Curve Cryptography
     * - Algorithm: SHA256withECDSA
     * - Message: execution_time as string (UTF-8)
     * - Output: hex string
     */
    generateSignature(executionTime: number): string {
        if (this.vendorStubsEnabled) {
            return "e2e-stub-signature";
        }

        this.assertConfigured();
        const message = String(executionTime);

        // Convert hex private key to DER format for crypto.sign
        const privateKeyHex = this.EFORMSIGN_PRIVATE_KEY;
        const privateKeyDer = Buffer.from(privateKeyHex, "hex");

        // Create private key object from DER format
        const privateKey = crypto.createPrivateKey({
            key: privateKeyDer,
            format: "der",
            type: "pkcs8",
        });

        // Sign with SHA256 and ECDSA
        const signature = crypto.sign(
            "sha256",
            Buffer.from(message, "utf-8"),
            privateKey
        );

        // Return as hex string
        return signature.toString("hex");
    }

    generateDocumentOptions(contractData: ContractDataDto, accessToken: string, refreshToken: string, templateId?: string) {
        this.assertConfigured();
        const fullPrice = normalizeEformsignAmount(contractData.fullPrice);
        const grant = normalizeEformsignAmount(contractData.grant);
        const actualPrice = normalizeEformsignAmount(contractData.actualPrice);
        return {
            company: {
                id: this.EFORMSIGN_COMPANY_ID,
                country_code: "kr",
                user_key: this.USER_EMAIL,
            },
            layout: {
                "lang_code": "ko",
                "zoom": "0.75",
                "viewer_toolbar": {
                    "toolbar.save": "false",
                    "toolbar.print": "false",
                },
            },
            user: {
                type: "01",
                id: this.USER_EMAIL,
                access_token: accessToken,
                refresh_token: refreshToken,
            },
            mode: {
                type: "01",
                template_id: templateId || this.EFORMSIGN_TEMPLATE_ID,
            },
            prefill: {
                document_name: "산모신생아건강관리서비스 계약서",
                fields: [
                    { id: "이용자 성명", value: contractData.customerName, enabled: true },
                    { id: "이용자 생년월일", value: contractData.customerDOB || "", enabled: true },
                    { id: "이용자 주소", value: contractData.customerAddress, enabled: true },
                    // inputOutsiderNumber (이용자 연락처) — 발급 staff (현재 로그인 계정)의 폰 번호로 prefill.
                    // contractData.issuerPhone 미지정 시 customerContact 으로 fallback (test setup에서 둘이 동일).
                    { id: "이용자 연락처", value: contractData.issuerPhone || contractData.customerContact, enabled: true },
                    { id: "계약 시작 년도", value: contractData.startYear },
                    { id: "계약 시작 월", value: contractData.startMonth },
                    { id: "계약 시작 일", value: contractData.startDay },
                    { id: "계약 종료 년도", value: contractData.endYear },
                    { id: "계약 종료 월", value: contractData.endMonth },
                    { id: "계약 종료 일", value: contractData.endDay },
                    { id: "서비스 비용", value: fullPrice },
                    { id: "정부지원금", value: grant },
                    { id: "본인부담금", value: actualPrice },
                    { id: "서비스 기간", value: contractData.days },
                    { id: "제공인력 1 성명", value: contractData.caretaker1Name },
                    { id: "제공인력 1 연락처", value: contractData.caretaker1Contact },
                    { id: "서비스 가격", value: fullPrice },
                    { id: "본인부담금 수령 년도", value: contractData.paymentYear },
                    { id: "본인부담금 수령 월", value: contractData.paymentMonth },
                    { id: "본인부담금 수령 일", value: contractData.paymentDay },
                    { id: "서비스 기간", value: contractData.contractDuration },
                ],
                recipients: [
                    {
                        step_idx: "2",
                        step_type: "05",
                        name: contractData.customerName,
                        id: "",
                        sms: contractData.customerContact,
                        use_sms: true,
                    },
                    {
                        step_idx: "3",
                        step_type: "06",
                        name: "제공기관 확인",
                        id: this.USER_EMAIL,
                        use_mail: false,
                        use_sms: false,
                    },
                ],
            },
            return_fields: [contractData.customerName],
        };
    }

    async generateStaffCompletionOptions(
        documentId: string,
        accessToken: string,
        refreshToken: string,
        prefillEndDate?: string,
    ) {
        this.assertConfigured();
        const doc = this.vendorStubsEnabled
            ? buildEformsignStubDocument(documentId)
            : await this.fetchStaffCompletionDocument(documentId, accessToken);
        const templateId =
            doc?.detail_template_info?.id ??
            doc?.template?.id ??
            doc?.template_id;
        if (!templateId) {
            throw new Error(`Cannot resolve template_id for document ${documentId}`);
        }

        const prefill = this.buildStaffCompletionPrefill(prefillEndDate);

        return {
            company: {
                id: this.EFORMSIGN_COMPANY_ID,
                country_code: "kr",
                user_key: this.USER_EMAIL,
            },
            layout: {
                lang_code: "ko",
                zoom: "0.75",
                viewer_toolbar: {
                    "toolbar.save": "false",
                    "toolbar.print": "false",
                },
            },
            user: {
                type: "01",
                id: this.USER_EMAIL,
                access_token: accessToken,
                refresh_token: refreshToken,
            },
            mode: {
                type: "02",
                template_id: templateId,
                document_id: documentId,
            },
            ...(prefill ? { prefill } : {}),
        };
    }

    private buildStaffCompletionPrefill(prefillEndDate?: string) {
        if (typeof prefillEndDate === "undefined") {
            return undefined;
        }

        if (!ISO_END_DATE_REGEX.test(prefillEndDate)) {
            throw new BadRequestException("prefillEndDate must match YYYY-MM-DD");
        }

        const [year, month, day] = prefillEndDate.split("-");

        return {
            fields: [
                // The live regional templates print the century prefix (`20`)
                // outside this field, matching the two-digit values sent during
                // contract creation. Supplying `2026` renders as `20 2026`.
                { id: EFORMSIGN_END_DATE_FIELD_IDS.year, value: year!.slice(-2), enabled: true, required: false },
                { id: EFORMSIGN_END_DATE_FIELD_IDS.month, value: month, enabled: true, required: false },
                { id: EFORMSIGN_END_DATE_FIELD_IDS.day, value: day, enabled: true, required: false },
            ],
        };
    }

    /**
     * Get in-progress documents (진행 중)
     * type: "01"
     */
    async getInProgressDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        if (this.vendorStubsEnabled) {
            return buildEformsignStubListResponse("01", limit, skip);
        }

        this.assertConfigured();
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "01",
                title_and_content: "",
                title: "",
                content: "",
                limit: String(limit),
                skip: String(skip)
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get in-progress documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get completed documents (완료)
     * type: "03"
     */
    async getCompletedDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        if (this.vendorStubsEnabled) {
            return buildEformsignStubListResponse("03", limit, skip);
        }

        this.assertConfigured();
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "03",
                title_and_content: "",
                title: "",
                content: "",
                limit: String(limit),
                skip: String(skip)
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get completed documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get rejected documents (반려/거부)
     * type: "04"
     */
    async getRejectedDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        if (this.vendorStubsEnabled) {
            return buildEformsignStubListResponse("04", limit, skip);
        }

        this.assertConfigured();
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "04",
                title_and_content: "",
                title: "",
                content: "",
                limit: String(limit),
                skip: String(skip)
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get rejected documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get single document by ID
     * GET /v2.0/api/documents/{documentId}
     */
    async getDocumentById(accessToken: string, documentId: string): Promise<any> {
        if (this.vendorStubsEnabled) {
            return buildEformsignStubDocument(documentId);
        }

        this.assertConfigured();
        const includeParams = new URLSearchParams({
            include_fields: "true",
            include_histories: "true",
            include_previous_status: "true",
            include_next_status: "true",
            include_external_token: "false",
            include_detail_template_info: "true",
        });

        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}?${includeParams.toString()}`,
            {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get document: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Download document PDF or audit trail PDF
     * GET /v2.0/api/documents/{documentId}/download_files?file_type=document|audit_trail
     */
    async downloadDocumentFile(
        accessToken: string,
        documentId: string,
        fileType: "document" | "audit_trail" = "document"
    ): Promise<{
        status: number;
        contentType: string;
        contentDisposition: string | null;
        body: Buffer;
    }> {
        if (this.vendorStubsEnabled) {
            return {
                status: 200,
                contentType: "application/pdf",
                contentDisposition: `attachment; filename="${documentId}-${fileType}.pdf"`,
                body: buildEformsignStubPdf(documentId, fileType),
            };
        }

        this.assertConfigured();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort(createDownloadTimeoutError());
        }, EFORMSIGN_DOWNLOAD_TIMEOUT_MS);

        try {
            const response = await fetch(
                `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}/download_files?file_type=${fileType}`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${accessToken}`,
                    },
                    signal: controller.signal,
                }
            );

            const body = await readResponseBodyWithLimit(
                response,
                EFORMSIGN_MAX_DOWNLOAD_BYTES,
                controller.signal,
            );

            return {
                status: response.status,
                contentType: response.headers.get("content-type") || "application/octet-stream",
                contentDisposition: response.headers.get("content-disposition"),
                body,
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Get all documents (combines in-progress, completed, and rejected)
     * Makes parallel requests for performance
     */
    async getAllDocuments(accessToken: string, limit = 100, skip = 0): Promise<{
        documents: any[];
        total_rows: number;
        limit: number;
        skip: number;
    }> {
        this.assertConfigured();
        const [inProgress, completed, rejected] = await Promise.all([
            this.getInProgressDocuments(accessToken, limit, skip),
            this.getCompletedDocuments(accessToken, limit, skip),
            this.getRejectedDocuments(accessToken, limit, skip),
        ]);

        // Combine all documents
        const allDocuments = [
            ...(inProgress.documents || []),
            ...(completed.documents || []),
            ...(rejected.documents || []),
        ];

        // Remove duplicates by document id
        const seenIds = new Set<string>();
        const uniqueDocuments: any[] = [];
        for (const doc of allDocuments) {
            if (!seenIds.has(doc.id)) {
                seenIds.add(doc.id);
                uniqueDocuments.push(doc);
            }
        }

        // eformsign list_document returns created_date; local fallbacks may use createdDate.
        uniqueDocuments.sort((a, b) => getDocumentCreatedTimestamp(b) - getDocumentCreatedTimestamp(a));

        return {
            documents: uniqueDocuments,
            total_rows: uniqueDocuments.length,
            limit,
            skip,
        };
    }

    /**
     * Delete one or more documents
     * DELETE /v2.0/api/documents
     * @param accessToken - eformsign access token
     * @param documentIds - array of document IDs to delete
     * @param isPermanent - whether to permanently delete (default: false)
     */
    async deleteDocuments(
        accessToken: string,
        documentIds: string[],
        isPermanent: boolean = false
    ): Promise<any> {
        if (this.vendorStubsEnabled) {
            const result = buildEformsignStubDeleteResponse(documentIds);
            await this.bumpDocumentSnapshotVersions(documentIds);
            return result;
        }

        this.assertConfigured();
        const url = new URL(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents`);
        if (isPermanent) {
            url.searchParams.set("is_permanent", "true");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort(createDeleteTimeoutError());
        }, EFORMSIGN_DELETE_TIMEOUT_MS);
        try {
            const response = await waitForDeleteOperation(
                fetch(url.toString(), {
                    method: "DELETE",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        document_ids: documentIds,
                    }),
                    signal: controller.signal,
                }),
                controller.signal,
            );

            if (!response.ok) {
                const errorData = await waitForDeleteOperation(
                    response.text(),
                    controller.signal,
                );
                throw new EformsignApiError(
                    `Failed to delete documents: ${response.status} - ${errorData}`,
                    response.status,
                    extractEformsignVendorCode(errorData),
                );
            }

            const result = await waitForDeleteOperation(response.json(), controller.signal);
            await this.bumpDocumentSnapshotVersions(documentIds);
            return result;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Cancel one or more documents.
     * POST /v2.0/api/documents/cancel
     *
     * This is what "삭제" performs against the vendor. Cancelling expires the recipient's
     * signing link immediately — verified live: a link that opened before the call showed
     * an expiry notice after it — which is the point, since deletions are usually mis-sends.
     * Unlike DELETE it leaves the document and its audit trail at eformsign; a non-permanent
     * DELETE would only park it in the vendor's trash for 14 days before erasing it.
     *
     * Only in-progress documents can be cancelled. Already completed/rejected/cancelled ones
     * come back in `fail_result`; that is expected and is not an error — they have no live
     * signing link left to revoke. The caller decides what to do with them.
     *
     * Note: a cancelled document still reports `recipients[].token_id`, despite the vendor
     * spec claiming otherwise. Never treat that token's presence as "the link is alive".
     *
     * Shares the delete timeout helpers: both are single-shot mutating vendor calls that
     * must not be retried blindly.
     */
    async cancelDocuments(
        accessToken: string,
        documentIds: string[],
        comment: string = "관리자 삭제",
    ): Promise<any> {
        if (this.vendorStubsEnabled) {
            const result = buildEformsignStubDeleteResponse(documentIds);
            await this.bumpDocumentSnapshotVersions(documentIds);
            return result;
        }

        this.assertConfigured();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort(createDeleteTimeoutError());
        }, EFORMSIGN_DELETE_TIMEOUT_MS);
        try {
            const response = await waitForDeleteOperation(
                fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/cancel`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        input: {
                            document_ids: documentIds,
                            comment,
                        },
                    }),
                    signal: controller.signal,
                }),
                controller.signal,
            );

            if (!response.ok) {
                const errorData = await waitForDeleteOperation(
                    response.text(),
                    controller.signal,
                );
                throw new EformsignApiError(
                    `Failed to cancel documents: ${response.status} - ${errorData}`,
                    response.status,
                    extractEformsignVendorCode(errorData),
                );
            }

            const result = await waitForDeleteOperation(response.json(), controller.signal);
            await this.bumpDocumentSnapshotVersions(documentIds);
            return result;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Re-request a document for the current outsider recipient.
     * Reuses the existing recipient settings by omitting recipients from next_steps.
     */
    async reRequestOutsiderDocument(
        accessToken: string,
        documentId: string,
        stepType: string,
        stepSeq: string,
        comment: string = "재요청입니다.",
        recipientPhone?: {
            countryCode?: string;
            phoneNumber?: string;
        }
    ): Promise<any> {
        if (this.vendorStubsEnabled) {
            const result = buildEformsignStubReRequestResponse(documentId);
            await this.bumpDocumentSnapshotVersions([documentId]);
            return result;
        }

        this.assertConfigured();
        const nextStep: {
            step_type: string;
            step_seq: string;
            comment: string;
            recipients?: Array<{
                member?: {
                    name?: string;
                    id?: string;
                    sms?: {
                        country_code: string;
                        phone_number: string;
                    };
                };
                use_mail: boolean;
                use_sms: boolean;
            }>;
        } = {
            step_type: stepType,
            step_seq: stepSeq,
            comment,
        };

        if (recipientPhone) {
            const document = await this.getDocumentById(accessToken, documentId);
            const currentRecipient = document?.current_status?.step_recipients?.[0];

            if (!currentRecipient) {
                throw new Error("Failed to determine the current recipient for phone override");
            }

            const member: {
                name?: string;
                id?: string;
                sms?: {
                    country_code: string;
                    phone_number: string;
                };
            } = {};

            if (currentRecipient?.name) {
                member.name = currentRecipient.name;
            }

            if (currentRecipient?.id) {
                member.id = currentRecipient.id;
            }

            member.sms = {
                country_code: recipientPhone.countryCode ?? "+82",
                phone_number: recipientPhone.phoneNumber ?? "",
            };

            const recipientConfig: {
                member?: typeof member;
                use_mail: boolean;
                use_sms: boolean;
            } = {
                use_mail: Boolean(currentRecipient?.id),
                use_sms: true,
            };

            if (member.name || member.id || member.sms) {
                recipientConfig.member = member;
            }

            nextStep.recipients = [recipientConfig];
        }

        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}/re_request_outsider`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    input: {
                        next_steps: [nextStep],
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to re-request document: ${response.status} - ${errorData}`);
        }

        const result = await response.json();
        await this.bumpDocumentSnapshotVersions([documentId]);
        return result;
    }

    private async bumpDocumentSnapshotVersions(documentIds: string[]): Promise<void> {
        if (!this.eformsignDocRepository || !this.documentSnapshotService) return;

        const branchIds = await Promise.all(
            documentIds.map(async (documentId) => {
                try {
                    return await this.eformsignDocRepository?.findBranchIdByDocumentId(documentId) ?? null;
                } catch {
                    return null;
                }
            }),
        );
        const mappedBranchIds = new Set(
            branchIds.filter((branchId): branchId is string => Boolean(branchId)),
        );

        // 지점 매핑이 없는 문서는 본사(HQ) 뷰에만 나타난다 — 지점 버전 대신 회사
        // epoch를 올려 본사 스냅샷을 무효화한다.
        if (mappedBranchIds.size === 0) {
            try {
                await this.documentSnapshotService?.bumpCompanyEpoch();
            } catch {
                // 캐시 무효화 실패가 삭제·재요청 성공을 되돌리면 안 된다.
            }
            return;
        }

        await Promise.all(
            [...mappedBranchIds].map(async (branchId) => {
                try {
                    await this.documentSnapshotService?.bumpVersion(branchId);
                } catch {
                    // 캐시 무효화 실패가 삭제·재요청 성공을 되돌리면 안 된다.
                }
            }),
        );
    }

    /**
     * The document's current status at the vendor, normalized to a canonical
     * code. When a headless run ends without a terminal SDK callback, eformsign
     * — not the automation — is the authority on whether the step finished.
     * Returns undefined when the response carries no recognizable status.
     */
    async fetchDocumentWorkflowState(
        documentId: string,
        accessToken: string,
    ): Promise<EformsignDocumentWorkflowState> {
        const doc = await this.fetchStaffCompletionDocument(
            documentId,
            accessToken,
            AbortSignal.timeout(EFORMSIGN_STATUS_READ_TIMEOUT_MS),
        );
        const currentStatus = doc?.document?.current_status ?? doc?.current_status;
        const rawStatus =
            currentStatus?.status_type ??
            doc?.document?.document_status ??
            doc?.document_status ??
            doc?.status_type ??
            doc?.status;
        const asOptionalString = (value: unknown): string | undefined => {
            if (value === null || value === undefined) return undefined;
            const normalized = String(value).trim();
            return normalized || undefined;
        };

        return {
            statusCode: rawStatus === null || rawStatus === undefined || rawStatus === ""
                ? undefined
                : normalizeEformsignStatusCode(rawStatus),
            stepType: asOptionalString(currentStatus?.step_type),
            stepIndex: asOptionalString(currentStatus?.step_index),
            stepName: asOptionalString(currentStatus?.step_name),
        };
    }

    async fetchDocumentStatusCode(documentId: string, accessToken: string): Promise<string | undefined> {
        return (await this.fetchDocumentWorkflowState(documentId, accessToken)).statusCode;
    }

    private async fetchStaffCompletionDocument(
        documentId: string,
        accessToken: string,
        signal?: AbortSignal,
    ): Promise<any> {
        const params = new URLSearchParams({ include_detail_template_info: "true" });
        const docRes = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            ...(signal ? { signal } : {}),
        });

        if (!docRes.ok) {
            throw new Error(`Failed to get document ${documentId} for staff completion: ${docRes.status} ${await docRes.text()}`);
        }

        return await docRes.json();
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Eformsign integration is not configured.");
        }
    }
}

async function readResponseBodyWithLimit(
    response: Response,
    maxBytes: number,
    signal: AbortSignal,
): Promise<Buffer> {
    const contentLengthValue = response.headers.get("content-length");
    const contentLength = contentLengthValue === null
        ? null
        : Number.parseInt(contentLengthValue, 10);
    if (
        contentLength !== null
        && Number.isFinite(contentLength)
        && contentLength > maxBytes
    ) {
        throw new Error(
            `Eformsign download exceeds the local mirror size limit (${maxBytes} bytes)`,
        );
    }

    if (!response.body) {
        const body = Buffer.from(await waitForDownloadBody(response.arrayBuffer(), signal));
        if (body.length > maxBytes) {
            throw new Error(
                `Eformsign download exceeds the local mirror size limit (${maxBytes} bytes)`,
            );
        }
        return body;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await waitForDownloadBody(
            reader.read(),
            signal,
            () => {
                void reader.cancel().catch(() => undefined);
            },
        );
        if (done) {
            break;
        }
        if (!value) {
            continue;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error(
                `Eformsign download exceeds the local mirror size limit (${maxBytes} bytes)`,
            );
        }
        chunks.push(Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength,
        ));
    }
    return Buffer.concat(chunks, totalBytes);
}

function waitForDownloadBody<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    onAbort?: () => void,
): Promise<T> {
    if (signal.aborted) {
        onAbort?.();
        return Promise.reject(downloadAbortReason(signal));
    }

    return new Promise<T>((resolve, reject) => {
        const abort = () => {
            onAbort?.();
            reject(downloadAbortReason(signal));
        };
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}

function downloadAbortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : createDownloadTimeoutError();
}

function createDownloadTimeoutError(): Error {
    return new Error(`Eformsign download timed out after ${EFORMSIGN_DOWNLOAD_TIMEOUT_MS}ms`);
}

function waitForDeleteOperation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(deleteAbortReason(signal));
    }

    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(deleteAbortReason(signal));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}

function deleteAbortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : createDeleteTimeoutError();
}

function createDeleteTimeoutError(): Error {
    return new Error(`Eformsign delete timed out after ${EFORMSIGN_DELETE_TIMEOUT_MS}ms`);
}
