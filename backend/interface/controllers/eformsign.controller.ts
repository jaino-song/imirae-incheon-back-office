import { BadRequestException, Controller, Post, Get, Head, Delete, Body, Query, Param, HttpException, HttpStatus, UseGuards, Res, ServiceUnavailableException } from "@nestjs/common";
import { EformsignService } from "../../application/services/eformsign.service";
import { EformsignDocService } from "../../application/services/eformsign-doc.service";
import { AreaTemplateService } from "../../application/services/area-template.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { INCHEON_STAFF_BRANCH_SLUG } from "domain/constants/branch-routing.constants";
import { GenerateStaffDocumentRequestDto } from "../dto/staff-document.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { Response } from "express";
import { parseInteger } from "interface/parse-integer";
import {
    AccessTokenRequestDto,
    DeleteDocumentsRequestDto,
    GenerateDocumentRequestDto,
    GenerateSignatureRequestDto,
    RefreshTokenRequestDto,
    ReRequestOutsiderDocumentRequestDto,
} from "interface/dto/eformsign.dto";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import {
    DocumentSnapshotEntry,
    DocumentSnapshotScope,
    EformsignDocumentSnapshotService,
} from "application/services/eformsign-document-snapshot.service";
import { stringFromUnknown } from "application/utils/eformsign-document-customer-name";
import {
    EformsignMirrorListService,
    enrichMirrorPage,
} from "application/services/eformsign-mirror-list.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EformsignPermanentPurgeRequest } from "domain/repositories/eformsign-document-mirror.repository.interface";
import {
    EformsignApiError,
    isEformsignDocumentAbsentError,
} from "infrastructure/api/eformsign-api.error";
import {
    documentSearchIndex,
    type DocumentStatusCategory,
    type EformsignListDoc,
    type TemplateMatch,
} from "application/utils/eformsign-document-list";
import {
    resolveEformsignDocDisplayStatus,
    type EformsignDocDisplayStatus,
} from "application/utils/eformsign-doc-display-status";
import {
    normalizeEformsignStatusCode,
    normalizeEformsignStepType,
} from "domain/utils/eformsign-status-code";

function throwHttpOrInternalError(error: unknown): never {
    if (error instanceof HttpException) {
        throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new HttpException(
        { error: message },
        HttpStatus.INTERNAL_SERVER_ERROR
    );
}

function parseBooleanQuery(value: string | undefined, name: string, defaultValue: boolean): boolean {
    if (value === undefined || value === "") {
        return defaultValue;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }

    throw new BadRequestException(`${name} must be true or false`);
}

type DownloadFileType = "document" | "audit_trail";

function parseDownloadFileType(value: string | undefined): DownloadFileType {
    if (value === undefined || value === "") {
        return "document";
    }
    if (value === "document" || value === "audit_trail") {
        return value;
    }

    throw new BadRequestException("fileType must be document or audit_trail");
}


function parseStatusCategory(value: string | undefined): DocumentStatusCategory | undefined {
    const normalized = value?.trim();
    if (!normalized) {
        return undefined;
    }

    const aliases: Record<string, DocumentStatusCategory> = {
        drafting: "drafting",
        "in-progress": "in-progress",
        completed: "completed",
        expired: "expired",
        unknown: "unknown",
        대기: "drafting",
        검토필요: "in-progress",
        완료: "completed",
        기간만료: "expired",
        상태확인: "unknown",
    };
    const category = aliases[normalized.toLowerCase().replace(/\s/g, "")];
    if (category) {
        return category;
    }

    throw new BadRequestException(
        "statusCategory must be drafting, in-progress, completed, expired, or unknown",
    );
}

function parseTemplateMatch(value: string | undefined): TemplateMatch {
    if (value === undefined || value === "" || value === "include") {
        return "include";
    }
    if (value === "exclude") {
        return "exclude";
    }

    throw new BadRequestException("templateMatch must be include or exclude");
}

function shouldExcludeSnapshotTombstones(
    scope: string,
    excludeDeleted: boolean | undefined,
    statusCategory: DocumentStatusCategory | undefined,
): boolean {
    return scope !== "all" || Boolean(excludeDeleted) || statusCategory !== undefined;
}

// StatsBar 카운터 계산에 필요한 최소 신호만 추린 형태. 버킷 분류(매핑)는
// 프론트의 status-codes.ts(foldContractStats) 한 곳에서만 수행한다.
type EformsignStatusSignal = {
    status_type: string | null;
    step_type: string | null;
    step_name: string | null;
    step_recipient_types: Array<string | null>;
    /** YYYY-MM-DD when known; the 서명 완료/검토 필요 counters split on it. */
    contract_end_date: string | null;
    /** Authoritative display status, stamped at serve time. */
    display_status: EformsignDocDisplayStatus;
};

function toStatusSignal(doc: unknown): EformsignStatusSignal {
    const { current_status: currentStatus, contract_end_date: contractEndDate } = doc as {
        current_status?: {
            status_type?: unknown;
            step_type?: unknown;
            step_name?: unknown;
            step_recipients?: Array<{ recipient_type?: unknown }>;
        };
        contract_end_date?: unknown;
    };
    const stepRecipients = Array.isArray(currentStatus?.step_recipients) ? currentStatus.step_recipients : [];
    const statusType = stringFromUnknown(currentStatus?.status_type);
    const stepType = stringFromUnknown(currentStatus?.step_type);
    return {
        status_type: statusType === null
            ? null
            : normalizeEformsignStatusCode(statusType),
        step_type: stepType === null
            ? null
            : normalizeEformsignStepType(stepType),
        step_name: stringFromUnknown(currentStatus?.step_name),
        step_recipient_types: stepRecipients.map((recipient) =>
            typeof recipient?.recipient_type === "string"
                ? recipient.recipient_type
                : null),
        contract_end_date: stringFromUnknown(contractEndDate),
        display_status: resolveEformsignDocDisplayStatus(doc as EformsignListDoc),
    };
}

@Controller("api")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignController {
    constructor(
        private readonly eformsignService: EformsignService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly eformsignDocService: EformsignDocService,
        private readonly prisma: PrismaService,
        private readonly assignmentGuard: ContractClientAssignmentGuardService,
        private readonly documentSnapshotService: EformsignDocumentSnapshotService,
        private readonly mirrorListService: EformsignMirrorListService,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
    ) { }

    /**
     * The list, answered locally.
     *
     * No access token: this path never calls the vendor, so it has no credential to spend
     * and nothing that varies by one. Only the application session and tenant scope are
     * required for local reads.
     */
    private async listFromMirror(params: {
        branchId: string;
        isHeadquarters: boolean;
        scope: string;
        limit: number;
        skip: number;
        templateId?: string;
        templateMatch: TemplateMatch;
        statusCategory?: DocumentStatusCategory;
        search?: string;
        excludeDeleted?: boolean;
    }) {
        // Through the same snapshot the API path uses. Not for the vendor calls it saves —
        // there are none here — but because pagination has to walk one generation: a
        // document leaving the set between two pages shifts the rest up, and the page the
        // client asks for next then skips one it never saw.
        const snapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
            {
                scope: params.scope as DocumentSnapshotScope,
                branchId: params.branchId,
                isHeadquarters: params.isHeadquarters,
                source: "mirror",
            },
            async () => this.toSnapshotEntries(
                await this.mirrorListService.loadScopeDocuments(params),
            ),
            {
                excludeTombstones: shouldExcludeSnapshotTombstones(
                    params.scope,
                    params.excludeDeleted,
                    params.statusCategory,
                ),
            },
        );
        const { documents } = this.mirrorListService.filterScope(
            snapshot.entries.map((entry) => entry.document),
            params,
        );
        const page = documents.slice(params.skip, params.skip + params.limit);

        return {
            // display_status is stamped at serve time, never into the cached snapshot —
            // the 서명 완료→검토 필요 flip moves with the calendar, not with document writes.
            documents: enrichMirrorPage(page).map((document) => ({
                ...document,
                display_status: resolveEformsignDocDisplayStatus(document),
            })),
            total_rows: documents.length,
            limit: params.limit,
            skip: params.skip,
            has_more: params.skip + params.limit < documents.length,
            // The client resets its pagination when a later page reports a different
            // generation. Without this it has no way to notice that the list moved under
            // it, and would quietly skip whatever the shift displaced.
            ...(snapshot.snapshotVersion ? { snapshot_version: snapshot.snapshotVersion } : {}),
        };
    }


    /**
     * 인천점(staff slug=incheon)은 본사 성격이라 지점에 매여 있지 않은 문서까지 본다:
     * 자기가 만든 문서 + 지점 매핑이 없는(branchId 미지정) 문서. 단, 다른 지점이
     * 소유한 문서는 제외한다. 그 외 지점은 자기 지점이 만든(=로컬에 적재된) 문서만 본다.
     */
    private async isHeadquartersBranch(branchId: string): Promise<boolean> {
        if (!branchId) {
            return false;
        }
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { slug: true },
        });
        return branch?.slug === INCHEON_STAFF_BRANCH_SLUG;
    }

    /**
     * (단일 페이지 후처리 필터) 외부 목록 한 페이지를 현재 지점 기준으로 거른다.
     * 인천점(본사)은 "다른 지점이 소유한" 문서만 제외하고(자기 문서 + 미지정 문서는
     * 통과) 그 외 지점은 자기 지점이 로컬에 보유한 documentId만 통과시킨다.
     * per-type 목록 엔드포인트에서 사용.
     */
    private async filterDocumentsByBranch<T extends { id: string }>(
        branchId: string,
        documents: T[],
        options: { includePermanentPurgePending?: boolean } = {},
    ): Promise<T[]> {
        if (!branchId) {
            return [];
        }
        const isHeadquarters = await this.isHeadquartersBranch(branchId);
        if (options.includePermanentPurgePending) {
            if (!isHeadquarters) {
                const localDocs = await Promise.all(documents.map((doc) =>
                    this.eformsignDocService.findByDocumentIdIncludingPurgePending(
                        branchId,
                        doc.id,
                    )));
                return documents.filter((_doc, index) => Boolean(localDocs[index]));
            }
            const otherBranchIds = new Set(
                await this.eformsignDocService.findDocumentIdsForOtherBranches(branchId),
            );
            return documents.filter((doc) => !otherBranchIds.has(doc.id));
        }

        const visibleDocuments = isHeadquarters
            ? await this.eformsignDocService.findAllForHeadquarters(branchId)
            : await this.eformsignDocService.findAll(branchId);
        const visibleDocumentIds = new Set(
            visibleDocuments.map((document) => document.documentId),
        );
        return documents.filter((document) => visibleDocumentIds.has(document.id));
    }

    private toSnapshotEntries(documents: EformsignListDoc[]): DocumentSnapshotEntry<EformsignListDoc>[] {
        return documents.map((document) => ({
            document,
            searchIndex: documentSearchIndex(document),
        }));
    }

    private async getBranchScopedStatusPage(
        branchId: string,
        limit: number,
        skip: number,
        scope: DocumentSnapshotScope,
        templateId?: string,
        templateMatch: TemplateMatch = "include",
        statusCategory?: DocumentStatusCategory,
        search?: string,
    ) {
        const isHeadquarters = await this.isHeadquartersBranch(branchId);
        // Tabs are classified from locally mirrored status codes. HTTP reads never call
        // the vendor; webhook and reconciliation are the only refresh paths.
        return this.listFromMirror({
            branchId,
            isHeadquarters,
            scope,
            limit,
            skip,
            templateId,
            templateMatch,
            statusCategory,
            search,
        });
    }

    @Post("generate-signature")
    async generateSignature(@Body() body: GenerateSignatureRequestDto) {
        try {
            const signature = this.eformsignService.generateSignature(body.executionTime);
            return { signature };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("access-token")
    async getAccessToken(@Body() body: AccessTokenRequestDto) {
        try {
            const result = await this.eformsignService.getAccessToken(
                body.executionTime,
                body.memberEmail
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("refresh-token")
    async refreshAccessToken(@Body() body: RefreshTokenRequestDto) {
        try {
            const result = await this.eformsignService.refreshAccessToken(
                body.executionTime,
                body.refreshToken
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("generate-document")
    async generateDocument(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() body: GenerateDocumentRequestDto
    ) {
        try {
            await this.assignmentGuard.assertAssignedProvider(
                tenant.branchId ?? "",
                body.clientId,
                body.contractData.caretaker1Contact,
            );
            // Look up templateId based on area
            let templateId: string | undefined;
            if (body.contractData.area) {
                const areaTemplate = await this.areaTemplateService.findByArea(
                    tenant.branchId ?? "",
                    body.contractData.area
                );
                templateId = areaTemplate?.templateId;
            }

            const documentOptions = this.eformsignService.generateDocumentOptions(
                body.contractData,
                body.accessToken,
                body.refreshToken,
                templateId
            );

            // Return clientId for frontend to use when creating eformsign doc record
            return {
                ...documentOptions,
                clientId: body.clientId,
            };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    @Post("generate-staff-document")
    async generateStaffDocument(@Body() body: GenerateStaffDocumentRequestDto) {
        try {
            return await this.eformsignService.generateStaffCompletionOptions(
                body.documentId,
                body.accessToken,
                body.refreshToken,
                body.prefillEndDate,
            );
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get all documents (combines in-progress, completed, rejected in single request)
     * More efficient than making 3 separate requests from frontend
     */
    @Get("documents")
    async getAllDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
        @Query("excludeDeleted") excludeDeletedValue?: string,
    ) {
        try {
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            const excludeDeleted = excludeDeletedValue === "true";
            const branchId = tenant.branchId ?? "";

            const isHeadquarters = await this.isHeadquartersBranch(branchId);
            return await this.listFromMirror({
                branchId,
                isHeadquarters,
                scope: "all",
                limit: parsedLimit,
                skip: parsedSkip,
                templateId,
                templateMatch,
                statusCategory,
                search,
                excludeDeleted,
            });
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * 전체 탭 StatsBar 카운터용: 현재 지점(인천=다른 지점 제외 전체)의 문서를 한 번
     * 모아 버킷 계산에 필요한 원시 신호(status_type + 현재 단계 정보)만 내려준다.
     * 분류는 프론트(foldContractStats). status-counts는 documents/:documentId보다
     * 먼저 선언되어야 정적 경로로 매칭된다.
     */
    @Get("documents/status-counts")
    async getStatusCounts(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("search") search?: string,
        @Query("excludeDeleted") excludeDeletedValue?: string,
    ) {
        try {
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const excludeDeleted = excludeDeletedValue === "true";
            const branchId = tenant.branchId ?? "";
            // 인천점(본사)은 다른 지점 소유분 제외 전체, 그 외 지점은 보유 문서 전체를 모은다.
            // 목록과 같은 "all" 스냅샷을 공유해 StatsBar 카운터와 목록이 항상 같은 세대를 본다.
            const isHeadquarters = await this.isHeadquartersBranch(branchId);
            // Same filters, source and snapshot generation as the local list so the
            // counters and rows cannot describe different moments.
            const countSnapshot = await this.documentSnapshotService
                .getOrBuild<EformsignListDoc>(
                    { scope: "all", branchId, isHeadquarters, source: "mirror" },
                    async () => this.toSnapshotEntries(
                        await this.mirrorListService.loadScopeDocuments({
                            branchId,
                            isHeadquarters,
                        }),
                    ),
                    {
                        excludeTombstones: shouldExcludeSnapshotTombstones(
                            "all",
                            excludeDeleted,
                            undefined,
                        ),
                    },
                );
            const { documents } = this.mirrorListService.filterScope(
                countSnapshot.entries.map((entry) => entry.document),
                {
                    branchId,
                    isHeadquarters,
                    scope: "all",
                    templateId,
                    templateMatch,
                    search,
                    excludeDeleted,
                },
            );
            return { documents: documents.map((doc) => toStatusSignal(doc)) };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get in-progress documents (진행 중 - type: 01)
     */
    @Get("documents/in-progress")
    async getInProgressDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                "in-progress",
                templateId,
                templateMatch,
                statusCategory,
                search,
            );
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get completed documents (완료 - type: 03)
     */
    @Get("documents/completed")
    async getCompletedDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                "completed",
                templateId,
                templateMatch,
                statusCategory,
                search,
            );
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get rejected documents (거부/반려 - type: 04)
     */
    @Get("documents/rejected")
    async getRejectedDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                "rejected",
                templateId,
                templateMatch,
                statusCategory,
                search,
            );
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Delete one or more documents
     */
    @Delete("documents")
    async deleteDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
        @Query("is_permanent") isPermanent: string,
        @Body() body: DeleteDocumentsRequestDto
    ) {
        let requestedDocumentIds: string[] = [];
        let permanentPurgeRequests: EformsignPermanentPurgeRequest[] = [];
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            if (!body.document_ids || !Array.isArray(body.document_ids) || body.document_ids.length === 0) {
                throw new HttpException(
                    { error: "document_ids array is required and must not be empty" },
                    HttpStatus.BAD_REQUEST
                );
            }
            // is_permanent no longer selects a behaviour. A delete now always cancels at the
            // vendor and purges locally; the old recoverable variant hid the document from
            // every list anyway, so it was never recoverable. The parameter is still parsed so
            // existing clients that send it keep working unchanged.
            parseBooleanQuery(isPermanent, "is_permanent", false);
            requestedDocumentIds = [...new Set(body.document_ids)];
            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                requestedDocumentIds.map((id) => ({ id })),
                { includePermanentPurgePending: true },
            );
            if (allowedDocuments.length !== requestedDocumentIds.length) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }
            // Persist before the vendor call: a timeout after eformsign accepted the
            // cancellation must not leave local PII without a durable retry record.
            permanentPurgeRequests = await this.documentMirrorService.requestPermanentPurge(
                requestedDocumentIds,
            );
            // Cancel, not delete. Cancelling expires the recipient's signing link — the whole
            // point, since deletions are usually mis-sends — while leaving the document and its
            // audit trail at eformsign.
            const result = await this.eformsignService.cancelDocuments(
                accessToken,
                requestedDocumentIds,
            );
            const cancelledDocumentIds = successfulDeletedDocumentIds(result);
            const uncancelledDocumentIds = requestedDocumentIds.filter(
                (documentId) => !cancelledDocumentIds.includes(documentId),
            );
            // eformsign only cancels in-progress documents, so every completed, rejected or
            // already-cancelled one comes back refused. Those have no live signing link left to
            // revoke, so the local purge proceeds — otherwise a completed contract could never
            // be deleted at all.
            const terminalDocumentIds = await this.documentMirrorService
                .findTerminalDocumentIds(uncancelledDocumentIds);
            const purgeableDocumentIds = [
                ...new Set([...cancelledDocumentIds, ...terminalDocumentIds]),
            ];
            // Anything left was neither cancelled nor already finished, so its signing link may
            // still be live. Purging it would destroy the local record while leaving the
            // document signable — the exact failure this flow exists to prevent.
            const unresolvedDocumentIds = uncancelledDocumentIds.filter(
                (documentId) => !terminalDocumentIds.includes(documentId),
            );
            // Of those, release the purge intent only for vendor-definitive refusals. Transient
            // and unrecognised outcomes keep their generation-fenced intent so reconciliation
            // can finish the job later — a purge request hides the document from local reads,
            // and one document's failure must not strand an unrelated document's intent.
            const definitiveFailureDocumentIds = new Set(
                failedDeletedDocumentIds(result, requestedDocumentIds),
            );
            const definitiveFailurePurgeRequests = permanentPurgeRequests.filter((request) =>
                unresolvedDocumentIds.includes(request.documentId)
                && definitiveFailureDocumentIds.has(request.documentId),
            );
            if (definitiveFailurePurgeRequests.length > 0) {
                const cleanupErrors: unknown[] = [];
                try {
                    await this.documentMirrorService.clearPermanentPurgeRequest(
                        definitiveFailurePurgeRequests,
                    );
                } catch (error) {
                    cleanupErrors.push(error);
                }
                try {
                    await this.documentMirrorService.purgeDocuments(purgeableDocumentIds);
                } catch (error) {
                    cleanupErrors.push(error);
                }

                if (cleanupErrors.length > 0) {
                    throw new AggregateError(
                        cleanupErrors,
                        "Document cleanup was incomplete",
                    );
                }
            } else {
                await this.documentMirrorService.purgeDocuments(purgeableDocumentIds);
                // Preserve the previous empty-clear call after a successful purge,
                // while ensuring it cannot run after a failed local purge.
                await this.documentMirrorService.clearPermanentPurgeRequest([]);
            }
            return { ...result, unresolved_document_ids: unresolvedDocumentIds };
        } catch (error) {
            const apiError = error instanceof EformsignApiError ? error : null;
            const isConfirmedDocumentAbsence = isEformsignDocumentAbsentError(error);
            if (
                apiError !== null
                && apiError.status >= 400
                && apiError.status < 500
                // A confirmed absence may mean the document is already gone at the vendor,
                // so there is nothing left to cancel. Retain the generation-fenced intent
                // until reconciliation can purge the local detail and PDFs safely.
                && !isConfirmedDocumentAbsence
                && ![408, 429].includes(apiError.status)
            ) {
                await this.documentMirrorService.clearPermanentPurgeRequest(permanentPurgeRequests);
            }
            if (error instanceof HttpException) {
                throw error;
            }
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get single document by ID
     */
    @Get("documents/:documentId")
    async getDocumentById(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
    ) {
        try {
            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                [{ id: documentId }],
            );
            if (allowedDocuments.length === 0) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }

            const document = await this.documentMirrorService.getStoredDetail(documentId);
            if (!document) {
                throw new ServiceUnavailableException({
                    error: "Document detail is waiting for local synchronization",
                    documentId,
                });
            }
            return document;
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Read document PDF metadata without loading the stored bytes.
     */
    @Head("documents/:documentId/download_files")
    async headDocumentFile(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
        @Query("fileType") fileType: string | undefined,
        @Res() res: Response,
    ) {
        try {
            const parsedFileType = parseDownloadFileType(fileType);
            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                [{ id: documentId }],
            );
            if (allowedDocuments.length === 0) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }
            const file = await this.documentMirrorService.getStoredFileMetadata(
                documentId,
                parsedFileType,
            );
            if (!file) {
                throw new ServiceUnavailableException({
                    error: "Document file is waiting for local synchronization",
                    documentId,
                    fileType: parsedFileType,
                });
            }

            res.status(file.status);
            res.set({
                "Content-Type": file.contentType,
                ...(file.contentDisposition ? { "Content-Disposition": file.contentDisposition } : {}),
                "Content-Length": String(file.byteSize),
            });
            res.end();
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Download document PDF for preview/download.
     */
    @Get("documents/:documentId/download_files")
    async downloadDocumentFile(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
        @Query("fileType") fileType: string | undefined,
        @Res() res: Response,
    ) {
        try {
            const parsedFileType = parseDownloadFileType(fileType);
            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                [{ id: documentId }],
            );
            if (allowedDocuments.length === 0) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }
            const file = await this.documentMirrorService.getStoredFile(
                documentId,
                parsedFileType,
            );
            if (!file) {
                throw new ServiceUnavailableException({
                    error: "Document file is waiting for local synchronization",
                    documentId,
                    fileType: parsedFileType,
                });
            }

            res.status(file.status);
            res.set({
                "Content-Type": file.contentType,
                ...(file.contentDisposition ? { "Content-Disposition": file.contentDisposition } : {}),
                "Content-Length": String(file.body.length),
            });
            res.send(file.body);
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Re-request an outsider document to the current recipient.
     */
    @Post("documents/:documentId/re_request_outsider")
    async reRequestOutsiderDocument(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
        @Body() body: ReRequestOutsiderDocumentRequestDto
    ) {
        try {
            if (!body.accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            if (!body.stepType || !body.stepSeq) {
                throw new HttpException(
                    { error: "stepType and stepSeq are required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            if (
                body.recipientPhone &&
                (!body.recipientPhone.countryCode || !body.recipientPhone.phoneNumber)
            ) {
                throw new HttpException(
                    { error: "recipientPhone countryCode and phoneNumber are required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            const allowedDocuments = await this.filterDocumentsByBranch(
                tenant.branchId ?? "",
                [{ id: documentId }],
            );
            if (allowedDocuments.length === 0) {
                throw new HttpException(
                    { error: "Document access forbidden" },
                    HttpStatus.FORBIDDEN,
                );
            }

            return await this.eformsignService.reRequestOutsiderDocument(
                body.accessToken,
                documentId,
                body.stepType,
                body.stepSeq,
                body.comment,
                body.recipientPhone
            );
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}

function successfulDeletedDocumentIds(result: unknown): string[] {
    if (typeof result !== "object" || result === null) {
        return [];
    }
    const resultBody = (result as Record<string, unknown>)["result"];
    if (typeof resultBody !== "object" || resultBody === null) {
        return [];
    }
    const successResult = (resultBody as Record<string, unknown>)["success_result"];
    if (!Array.isArray(successResult)) {
        return [];
    }
    return successResult.filter(
        (documentId): documentId is string =>
            typeof documentId === "string" && documentId.trim().length > 0,
    );
}

function failedDeletedDocumentIds(result: unknown, requestedDocumentIds: string[]): string[] {
    if (typeof result !== "object" || result === null) return [];
    const resultBody = (result as Record<string, unknown>)["result"];
    if (typeof resultBody !== "object" || resultBody === null) return [];
    const failures = (resultBody as Record<string, unknown>)["fail_result"];
    if (!Array.isArray(failures)) return [];

    const requested = new Set(requestedDocumentIds);
    return [...new Set(failures.flatMap((failure) => {
        if (typeof failure !== "object" || failure === null) return [];
        const { document_id: documentId, code } = failure as Record<string, unknown>;
        const normalizedId = typeof documentId === "string" ? documentId.trim() : "";
        return classifyEformsignDeleteFailureCode(code) === "clear"
            && normalizedId
            && requested.has(normalizedId)
            ? [normalizedId]
            : [];
    }))];
}

/** Vendor application codes, not HTTP statuses. Unknown outcomes retain intent. */
function classifyEformsignDeleteFailureCode(code: unknown): "clear" | "retain" {
    const normalized = typeof code === "string"
        ? code.trim()
        : typeof code === "number" && Number.isInteger(code)
            ? String(code)
            : "";

    switch (normalized) {
        case "4000164": // token lacks authority to delete this document
            return "clear";
        case "4000031": // already deleted; reconcile must verify vendor 404 before purge
        default:
            return "retain";
    }
}
