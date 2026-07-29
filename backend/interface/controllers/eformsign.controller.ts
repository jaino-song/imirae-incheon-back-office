import { BadRequestException, Controller, Post, Get, Delete, Body, Query, Param, HttpException, HttpStatus, UseGuards, Res, Logger } from "@nestjs/common";
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
    DocumentDisplayFieldEnrichment,
    DocumentSnapshotEntry,
    DocumentSnapshotResult,
    DocumentSnapshotScope,
    EformsignDocumentSnapshotService,
} from "application/services/eformsign-document-snapshot.service";
import {
    documentCustomerNameValue,
    stringFromUnknown,
} from "application/utils/eformsign-document-customer-name";
import {
    eformsignListCompareFields,
    EformsignListShadowCompareService,
} from "application/services/eformsign-list-shadow-compare.service";
import { ConfigService } from "@nestjs/config";
import {
    EformsignMirrorListService,
    enrichMirrorPage,
} from "application/services/eformsign-mirror-list.service";
import {
    documentSearchIndex,
    documentSearchValues,
    filterDocumentsByStatusCategory,
    filterDocumentsByTemplate,
    eformsignListScopeSelector,
    filterOutDeletedDocuments,
    matchesKoreanSearch,
    sortDocumentsByCreatedDate,
    type DocumentStatusCategory,
    type EformsignListDoc,
    type TemplateMatch,
} from "application/utils/eformsign-document-list";
import {
    normalizeEformsignStatusCode,
    normalizeEformsignStepType,
} from "domain/utils/eformsign-status-code";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

/**
 * The served side of a shadow comparison: the whole filtered set rather than the page, so
 * a single disagreement early in the list is not re-reported at every later page boundary.
 */
function buildShadowServed(filteredDocuments: EformsignListDoc[], scope: string) {
    // A vendor inbox is not a tab: type 04 is eformsign's document-management inbox and
    // carries in-progress and completed documents too, which the client filters out by
    // status before rendering. Narrowing both sides the same way is what makes the
    // comparison answer the question that matters — would the tab show the same thing.
    const scopeSelector = eformsignListScopeSelector(scope);
    const comparable = scopeSelector === undefined
        ? filteredDocuments
        : filteredDocuments.filter(scopeSelector);

    return {
        documentIds: comparable.map((document) => document.id),
        fieldsById: new Map(
            comparable.map((document) => [
                document.id,
                eformsignListCompareFields(document),
            ] as const),
        ),
    };
}

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

const DEFAULT_DETAIL_ENRICHMENT_CONCURRENCY = 8;
const DETAIL_ENRICHMENT_CONCURRENCY_ENV = "EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY";
const DETAIL_ENRICHMENT_BUDGET_MS = 5_000;
const DETAIL_ENRICHMENT_RETRY_DELAYS_MS = [500, 1_500] as const;

function getDetailEnrichmentConcurrency(): number {
    const configured = Number(process.env[DETAIL_ENRICHMENT_CONCURRENCY_ENV]);
    return Number.isInteger(configured) && configured > 0
        ? configured
        : DEFAULT_DETAIL_ENRICHMENT_CONCURRENCY;
}

function isEformsignRateLimitError(error: unknown): boolean {
    if (error instanceof EformsignApiError && error.status === 429) {
        return true;
    }

    if (error && typeof error === "object") {
        const directStatus = (error as { status?: unknown }).status;
        const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
        if (directStatus === 429 || responseStatus === 429) {
            return true;
        }
    }

    return error instanceof Error
        && /^Failed to get document:\s*429(?:\s*-|$)/.test(error.message);
}

async function waitForDetailEnrichmentRetry(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

function documentHasCustomerNameField(doc: EformsignListDoc): boolean {
    return documentCustomerNameValue(doc) !== null;
}

function hasCollectionValues(value: unknown): boolean {
    return Array.isArray(value) ? value.length > 0 : value != null;
}

function applyDisplayFieldEnrichment(
    document: EformsignListDoc,
    enrichment: DocumentDisplayFieldEnrichment,
): EformsignListDoc {
    return {
        ...document,
        fields: hasCollectionValues(enrichment.fields)
            ? enrichment.fields
            : document.fields,
        detail_template_info: hasCollectionValues(enrichment.detail_template_info)
            ? enrichment.detail_template_info
            : document.detail_template_info,
    };
}

function addLocalCustomerNameField(
    document: EformsignListDoc,
    customerName: string,
): EformsignListDoc {
    const customerField = { id: "이용자 성명", value: customerName };
    const fields = Array.isArray(document.fields)
        ? [...document.fields, customerField]
        : hasCollectionValues(document.fields)
            ? [document.fields, customerField]
            : [customerField];
    return { ...document, fields };
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(items[currentIndex] as T);
            }
        }),
    );

    return results;
}

// StatsBar 카운터 계산에 필요한 최소 신호만 추린 형태. 버킷 분류(매핑)는
// 프론트의 status-codes.ts(foldContractStats) 한 곳에서만 수행한다.
type EformsignStatusSignal = {
    status_type: string | null;
    step_type: string | null;
    step_name: string | null;
    step_recipient_types: Array<string | null>;
};

function toStatusSignal(doc: unknown): EformsignStatusSignal {
    const currentStatus = (doc as {
        current_status?: {
            status_type?: unknown;
            step_type?: unknown;
            step_name?: unknown;
            step_recipients?: Array<{ recipient_type?: unknown }>;
        };
    }).current_status;
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
    };
}

@Controller("api")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignController {
    private readonly logger = new Logger(EformsignController.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly eformsignDocService: EformsignDocService,
        private readonly prisma: PrismaService,
        private readonly assignmentGuard: ContractClientAssignmentGuardService,
        private readonly documentSnapshotService: EformsignDocumentSnapshotService,
        private readonly listShadowCompareService: EformsignListShadowCompareService,
        private readonly mirrorListService: EformsignMirrorListService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Whether the list is answered from the local mirror instead of scanning eformsign.
     *
     * The switch stays until the shadow log has read clean for long enough that nobody
     * wants it back — reverting has to be a config change, not a deploy, because the whole
     * point of the staged rollout is that this step is the reversible one.
     */
    private servesFromMirror(): boolean {
        return this.configService.get<string>("EFORMSIGN_LIST_FROM_MIRROR") === "true";
    }

    /**
     * The list, answered locally. No snapshot cache: it exists to make a 30-call vendor
     * scan bearable, and there is no scan here to amortise.
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
        const { documents, entityById } = await this.mirrorListService.buildList(params);
        const page = documents.slice(params.skip, params.skip + params.limit);

        return {
            documents: enrichMirrorPage(page, entityById),
            total_rows: documents.length,
            limit: params.limit,
            skip: params.skip,
            has_more: params.skip + params.limit < documents.length,
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
    ): Promise<T[]> {
        if (!branchId) {
            return [];
        }
        if (await this.isHeadquartersBranch(branchId)) {
            const otherBranchIds = new Set(
                await this.eformsignDocService.findDocumentIdsForOtherBranches(branchId),
            );
            return documents.filter((doc) => !otherBranchIds.has(doc.id));
        }
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        return documents.filter((doc) => allowedIds.has(doc.id));
    }

    /**
     * 외부 회사 목록을 페이지 단위로 훑어 keep 조건을 만족하는 문서를 모아 최신순으로
     * 돌려준다. 호출부에서 limit/skip으로 잘라 페이지네이션한다.
     * - targetCount(기대 개수)를 주면 그만큼 모은 시점에 조기 종료한다(지점 보유분).
     * - null이면 페이지 상한(MAX_PAGES)까지 전수 스캔한다(인천 본사: "타 지점 제외 전부").
     */
    private async scanCompanyDocuments(
        accessToken: string,
        keep: (doc: EformsignListDoc) => boolean,
        targetCount: number | null,
        branchId: string,
        fetchPage: (limit: number, skip: number) => Promise<{ documents?: EformsignListDoc[] }> =
            (limit, skip) => this.eformsignService.getAllDocuments(accessToken, limit, skip),
    ): Promise<EformsignListDoc[]> {
        const PAGE_SIZE = 100;
        const MAX_PAGES = 10;
        const scanStartedAt = Date.now();
        let pagesFetched = 0;
        const collected = new Map<string, EformsignListDoc>();
        let exhausted = false;

        for (let page = 0; page < MAX_PAGES; page++) {
            pagesFetched = page + 1;
            const result = await fetchPage(PAGE_SIZE, page * PAGE_SIZE);
            const pageDocs: EformsignListDoc[] = result.documents ?? [];
            if (pageDocs.length === 0) {
                exhausted = true;
                break;
            }
            for (const doc of pageDocs) {
                if (keep(doc) && !collected.has(doc.id)) {
                    collected.set(doc.id, doc);
                }
            }
            if (targetCount !== null && collected.size >= targetCount) {
                exhausted = true;
                break;
            }
        }

        if (!exhausted && targetCount !== null && collected.size < targetCount) {
            this.logger.warn(
                `scanCompanyDocuments hit MAX_PAGES (${MAX_PAGES}) for branch ${branchId}; ` +
                `matched ${collected.size}/${targetCount}. Older contracts beyond the page cap may be omitted.`,
            );
        }

        this.logger.log(
            `scanCompanyDocuments branch=${branchId} pages=${pagesFetched} matched=${collected.size} tookMs=${Date.now() - scanStartedAt}`,
        );
        return sortDocumentsByCreatedDate(Array.from(collected.values()));
    }

    private async collectBranchScopedDocuments(
        accessToken: string,
        branchId: string,
        fetchPage: (limit: number, skip: number) => Promise<{ documents?: EformsignListDoc[] }>,
    ): Promise<EformsignListDoc[]> {
        if (await this.isHeadquartersBranch(branchId)) {
            const otherBranchIds = new Set(
                await this.eformsignDocService.findDocumentIdsForOtherBranches(branchId),
            );
            return this.scanCompanyDocuments(
                accessToken,
                (doc) => !otherBranchIds.has(doc.id),
                null,
                branchId,
                fetchPage,
            );
        }

        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        if (allowedIds.size === 0) {
            return [];
        }
        return this.scanCompanyDocuments(
            accessToken,
            (doc) => allowedIds.has(doc.id),
            allowedIds.size,
            branchId,
            fetchPage,
        );
    }

    private async filterDocumentsBySearch(
        documents: EformsignListDoc[],
        branchId: string,
        search: string | undefined,
        searchIndexByDocumentId?: Map<string, string[]>,
    ): Promise<EformsignListDoc[]> {
        const query = search?.trim() ?? "";
        if (!query) {
            return documents;
        }

        const localDocuments = await this.eformsignDocService.findAll(branchId);
        const localValuesByDocumentId = new Map<string, string[]>();
        for (const localDocument of localDocuments) {
            const values = [
                stringFromUnknown(localDocument.stepRecipientName),
            ].filter((value): value is string => Boolean(value));
            localValuesByDocumentId.set(localDocument.documentId, values);
        }

        return documents.filter((document) => {
            const localValues = localValuesByDocumentId.get(document.id) ?? [];
            const precomputed = searchIndexByDocumentId?.get(document.id);
            const values = precomputed
                ? [...precomputed, ...localValues]
                : documentSearchValues(document, localValues);
            return values.some((value) => matchesKoreanSearch(value, query));
        });
    }

    private async filterAndSortDocuments(
        documents: EformsignListDoc[],
        branchId: string,
        templateId: string | undefined,
        templateMatch: TemplateMatch,
        statusCategory: DocumentStatusCategory | undefined,
        search: string | undefined,
        excludeDeleted = false,
        searchIndexByDocumentId?: Map<string, string[]>,
    ): Promise<EformsignListDoc[]> {
        const templateFiltered = filterDocumentsByTemplate(documents, templateId, templateMatch);
        const deletionFiltered = filterOutDeletedDocuments(templateFiltered, excludeDeleted);
        const statusFiltered = filterDocumentsByStatusCategory(deletionFiltered, statusCategory);
        const searchFiltered = await this.filterDocumentsBySearch(
            statusFiltered,
            branchId,
            search,
            searchIndexByDocumentId,
        );
        return sortDocumentsByCreatedDate(searchFiltered);
    }

    private toSnapshotEntries(documents: EformsignListDoc[]): DocumentSnapshotEntry<EformsignListDoc>[] {
        return documents.map((document) => ({
            document,
            searchIndex: documentSearchIndex(document),
        }));
    }

    /**
     * 스냅샷(정렬까지 끝난 지점 문서 목록)에 요청별 필터를 적용하고 요청 구간만 잘라 반환한다.
     * 상세 보강(enrich)은 잘라낸 페이지에만 적용한다. 캐시가 우회된 요청은 snapshot_version을 생략한다.
     */
    private async paginateSnapshot(
        accessToken: string,
        branchId: string,
        snapshot: DocumentSnapshotResult<EformsignListDoc>,
        limit: number,
        skip: number,
        templateId: string | undefined,
        templateMatch: TemplateMatch,
        statusCategory: DocumentStatusCategory | undefined,
        search: string | undefined,
        excludeDeleted = false,
        shadow?: { scope: string; isHeadquarters: boolean },
    ) {
        const documents = snapshot.entries.map((entry) => entry.document);
        const searchIndexByDocumentId = new Map(
            snapshot.entries.map((entry) => [entry.document.id, entry.searchIndex] as const),
        );
        const filteredDocuments = await this.filterAndSortDocuments(
            documents,
            branchId,
            templateId,
            templateMatch,
            statusCategory,
            search,
            excludeDeleted,
            searchIndexByDocumentId,
        );
        const pageDocuments = filteredDocuments.slice(skip, skip + limit);
        if (shadow) {
            // Answer the same page from the mirror and report only where the two disagree.
            // Nothing below waits on it: the served response is the API's, exactly as it
            // was, until the diffs have been zero for long enough to trust the switch.
            this.listShadowCompareService.compareInBackground(
                {
                    branchId,
                    isHeadquarters: shadow.isHeadquarters,
                    scope: shadow.scope,
                    limit,
                    skip,
                    templateId,
                    templateMatch,
                    statusCategory,
                    search,
                    excludeDeleted,
                },
                buildShadowServed(filteredDocuments, shadow.scope),
            );
        }
        return {
            documents: await this.enrichDocumentsWithDisplayFields(
                branchId,
                accessToken,
                pageDocuments,
            ),
            total_rows: filteredDocuments.length,
            limit,
            skip,
            has_more: skip + limit < filteredDocuments.length,
            ...(snapshot.snapshotVersion ? { snapshot_version: snapshot.snapshotVersion } : {}),
        };
    }

    private async getBranchScopedStatusPage(
        accessToken: string,
        branchId: string,
        limit: number,
        skip: number,
        fetchPage: (limit: number, skip: number) => Promise<{ documents?: EformsignListDoc[] }>,
        scope: DocumentSnapshotScope,
        templateId?: string,
        templateMatch: TemplateMatch = "include",
        statusCategory?: DocumentStatusCategory,
        search?: string,
    ) {
        const isHeadquarters = await this.isHeadquartersBranch(branchId);
        if (this.servesFromMirror()) {
            // The tab is answered from status codes, not from which vendor inbox the
            // document sat in — the mirror does not record that, and the shadow comparison
            // has been measuring exactly this substitution.
            return await this.listFromMirror({
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

        const snapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
            { scope, branchId, accessToken, isHeadquarters },
            async () => this.toSnapshotEntries(
                await this.collectBranchScopedDocuments(accessToken, branchId, fetchPage),
            ),
        );
        return this.paginateSnapshot(
            accessToken,
            branchId,
            snapshot,
            limit,
            skip,
            templateId,
            templateMatch,
            statusCategory,
            search,
            false,
            { scope, isHeadquarters },
        );
    }

    /**
     * 현재 지점이 보유한 전자서명 문서 "전체"를 외부 목록에서 모아 최신순으로 돌려준다.
     * 외부 eformsign 목록을 회사 단위로 페이지네이션하면 지점 문서가 뒤 페이지에 있을 때
     * 빈 페이지에서 무한스크롤이 멈춰 누락되므로, 회사 페이지를 훑어 지점 문서를 모은다.
     * 지점 보유 documentId 집합 크기를 기대 개수로 삼아 다 찾으면 조기 종료한다.
     */
    private async collectBranchDocuments(
        accessToken: string,
        branchId: string,
    ): Promise<EformsignListDoc[]> {
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        if (allowedIds.size === 0) {
            return [];
        }
        return this.scanCompanyDocuments(
            accessToken,
            (doc) => allowedIds.has(doc.id),
            allowedIds.size,
            branchId,
        );
    }

    /**
     * 인천점(본사) 전용: 회사 전체 문서 중 "다른 지점이 소유한" 문서만 제외하고 모은다.
     * 즉 인천이 만든 문서 + 지점 매핑이 없는(branchId null/미적재) 문서를 본다. 제외할
     * 집합만 알 뿐 기대 개수를 알 수 없어, 페이지 상한까지 전수 스캔(targetCount=null)한다.
     */
    private async collectHeadquartersDocuments(
        accessToken: string,
        incheonBranchId: string,
    ): Promise<EformsignListDoc[]> {
        const otherBranchIds = new Set(
            await this.eformsignDocService.findDocumentIdsForOtherBranches(incheonBranchId),
        );
        return this.scanCompanyDocuments(
            accessToken,
            (doc) => !otherBranchIds.has(doc.id),
            null,
            incheonBranchId,
        );
    }

    private async enrichDocumentsWithDisplayFields(
        branchId: string,
        accessToken: string,
        documents: EformsignListDoc[],
    ): Promise<EformsignListDoc[]> {
        const enrichStartedAt = Date.now();
        const retryDeadline = enrichStartedAt + DETAIL_ENRICHMENT_BUDGET_MS;
        const candidateDocumentIds = Array.from(new Set(
            documents
                .filter((document) => !documentHasCustomerNameField(document))
                .map((document) => document.id),
        ));
        const localCustomerNameByDocumentId = new Map<string, string>();
        if (candidateDocumentIds.length > 0) {
            try {
                const localDisplayFields = await this.eformsignDocService.findDisplayFieldsByDocumentIds(
                    branchId,
                    candidateDocumentIds,
                );
                for (const localDisplayField of localDisplayFields) {
                    if (localDisplayField.customerName) {
                        localCustomerNameByDocumentId.set(
                            localDisplayField.documentId,
                            localDisplayField.customerName,
                        );
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                this.logger.warn(
                    `Local eformsign display-field lookup failed docs=${candidateDocumentIds.length}; falling back: ${message}`,
                );
            }
        }

        let localHits = 0;
        let cacheHits = 0;
        let apiFallbacks = 0;
        const enriched = await mapWithConcurrency(documents, getDetailEnrichmentConcurrency(), async (doc) => {
            if (documentHasCustomerNameField(doc)) {
                return doc;
            }

            const localCustomerName = localCustomerNameByDocumentId.get(doc.id);
            // stepRecipientName can fall back to the document title at adoption
            // time; such a value is not a customer name, so let those documents
            // take the cache/API path instead.
            const documentTitle = (stringFromUnknown(doc["document_name"]) ?? "").trim();
            if (localCustomerName && localCustomerName !== documentTitle) {
                localHits += 1;
                return addLocalCustomerNameField(doc, localCustomerName);
            }

            const cached = await this.documentSnapshotService.getDisplayFieldEnrichment(
                doc.id,
                accessToken,
            );
            if (cached !== null) {
                cacheHits += 1;
                return applyDisplayFieldEnrichment(doc, cached);
            }

            apiFallbacks += 1;
            try {
                const detail = await this.getDocumentDetailForEnrichment(
                    accessToken,
                    doc.id,
                    retryDeadline,
                );
                const detailEnrichment: DocumentDisplayFieldEnrichment = {
                    ...(hasCollectionValues(detail?.fields) ? { fields: detail.fields } : {}),
                    ...(hasCollectionValues(detail?.detail_template_info)
                        ? { detail_template_info: detail.detail_template_info }
                        : {}),
                };
                await this.documentSnapshotService.setDisplayFieldEnrichment(
                    doc.id,
                    accessToken,
                    detailEnrichment,
                );
                return applyDisplayFieldEnrichment(doc, detailEnrichment);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                this.logger.warn(`Failed to enrich eformsign document ${doc.id}: ${message}`);
                return doc;
            }
        });
        this.logger.log(
            `enrichDocumentsWithDisplayFields docs=${documents.length} localHits=${localHits} cacheHits=${cacheHits} apiFallbacks=${apiFallbacks} tookMs=${Date.now() - enrichStartedAt}`,
        );
        return enriched;
    }

    private async getDocumentDetailForEnrichment(
        accessToken: string,
        documentId: string,
        retryDeadline: number,
    ): Promise<EformsignListDoc> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await this.eformsignService.getDocumentById(accessToken, documentId);
            } catch (error) {
                const retryDelay = DETAIL_ENRICHMENT_RETRY_DELAYS_MS[attempt];
                if (
                    retryDelay === undefined
                    || !isEformsignRateLimitError(error)
                    || Date.now() + retryDelay > retryDeadline
                ) {
                    throw error;
                }
                await waitForDetailEnrichmentRetry(retryDelay);
            }
        }
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
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
        @Query("excludeDeleted") excludeDeletedValue?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            const excludeDeleted = excludeDeletedValue === "true";
            const branchId = tenant.branchId ?? "";

            const isHeadquarters = await this.isHeadquartersBranch(branchId);
            if (this.servesFromMirror()) {
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
            }

            // 인천점(본사): 회사 전체에서 다른 지점 소유분만 빼고 모은 뒤 요청 구간만 잘라 반환.
            // (필터링 때문에 외부 페이지네이션을 그대로 흘리면 페이지 경계에 빈틈이 생긴다.)
            if (isHeadquarters) {
                const hqSnapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
                    { scope: "all", branchId, accessToken, isHeadquarters: true },
                    async () => this.toSnapshotEntries(
                        await this.collectHeadquartersDocuments(accessToken, branchId),
                    ),
                );
                return this.paginateSnapshot(
                    accessToken,
                    branchId,
                    hqSnapshot,
                    parsedLimit,
                    parsedSkip,
                    templateId,
                    templateMatch,
                    statusCategory,
                    search,
                    excludeDeleted,
                    {
                        scope: "all",
                        isHeadquarters: true,
                    },
                );
            }

            // 일반 지점: 지점 보유 문서 전체를 모은 뒤 요청 구간만 잘라 반환한다.
            // (회사 페이지를 그대로 필터하면 지점 문서가 뒤 페이지에 있을 때 무한스크롤이
            //  빈 페이지에서 멈춰 누락되므로, 지점 단위로 페이지네이션한다.)
            const branchSnapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
                { scope: "all", branchId, accessToken },
                async () => this.toSnapshotEntries(
                    await this.collectBranchDocuments(accessToken, branchId),
                ),
            );
            return this.paginateSnapshot(
                accessToken,
                branchId,
                branchSnapshot,
                parsedLimit,
                parsedSkip,
                templateId,
                templateMatch,
                statusCategory,
                search,
                excludeDeleted,
                {
                    scope: "all",
                    isHeadquarters: false,
                },
            );
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
        @Query("accessToken") accessToken: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("search") search?: string,
        @Query("excludeDeleted") excludeDeletedValue?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const excludeDeleted = excludeDeletedValue === "true";
            const branchId = tenant.branchId ?? "";
            // 인천점(본사)은 다른 지점 소유분 제외 전체, 그 외 지점은 보유 문서 전체를 모은다.
            // 목록과 같은 "all" 스냅샷을 공유해 StatsBar 카운터와 목록이 항상 같은 세대를 본다.
            const isHeadquarters = await this.isHeadquartersBranch(branchId);
            if (this.servesFromMirror()) {
                // Same filters as the list, and the same source — the counters and the
                // list have to agree, which is why they shared a snapshot generation
                // before and share a query now.
                const { documents } = await this.mirrorListService.buildList({
                    branchId,
                    isHeadquarters,
                    scope: "all",
                    templateId,
                    templateMatch,
                    search,
                    excludeDeleted,
                });
                return { documents: documents.map((doc) => toStatusSignal(doc)) };
            }

            const snapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
                { scope: "all", branchId, accessToken, isHeadquarters },
                async () => this.toSnapshotEntries(
                    isHeadquarters
                        ? await this.collectHeadquartersDocuments(accessToken, branchId)
                        : await this.collectBranchDocuments(accessToken, branchId),
                ),
            );
            // 모바일 필터 pill 카운터용: 목록과 동일한 선(先)필터를 적용한 뒤 신호만 내려준다.
            // 파라미터 미지정 시 기존과 동일하게 전체 신호를 반환한다.
            const searchIndexByDocumentId = new Map(
                snapshot.entries.map((entry) => [entry.document.id, entry.searchIndex] as const),
            );
            const filteredDocuments = await this.filterAndSortDocuments(
                snapshot.entries.map((entry) => entry.document),
                branchId,
                templateId,
                templateMatch,
                undefined,
                search,
                excludeDeleted,
                searchIndexByDocumentId,
            );
            return { documents: filteredDocuments.map((doc) => toStatusSignal(doc)) };
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
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                accessToken,
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                (pageLimit, pageSkip) => this.eformsignService.getInProgressDocuments(
                    accessToken,
                    pageLimit,
                    pageSkip,
                ),
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
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                accessToken,
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                (pageLimit, pageSkip) => this.eformsignService.getCompletedDocuments(
                    accessToken,
                    pageLimit,
                    pageSkip,
                ),
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
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
        @Query("templateId") templateId?: string,
        @Query("templateMatch") templateMatchValue?: string,
        @Query("statusCategory") statusCategoryValue?: string,
        @Query("search") search?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const templateMatch = parseTemplateMatch(templateMatchValue);
            const statusCategory = parseStatusCategory(statusCategoryValue);
            return await this.getBranchScopedStatusPage(
                accessToken,
                tenant.branchId ?? "",
                parsedLimit,
                parsedSkip,
                (pageLimit, pageSkip) => this.eformsignService.getRejectedDocuments(
                    accessToken,
                    pageLimit,
                    pageSkip,
                ),
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
        @Query("accessToken") accessToken: string,
        @Query("is_permanent") isPermanent: string,
        @Body() body: DeleteDocumentsRequestDto
    ) {
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
            const permanent = parseBooleanQuery(isPermanent, "is_permanent", false);
            const result = await this.eformsignService.deleteDocuments(
                accessToken,
                body.document_ids,
                permanent
            );
            return result;
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
     * Get single document by ID
     */
    @Get("documents/:documentId")
    async getDocumentById(
        @Param("documentId") documentId: string,
        @Query("accessToken") accessToken: string
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const document = await this.eformsignService.getDocumentById(accessToken, documentId);
            return document;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Download document PDF for preview/download.
     */
    @Get("documents/:documentId/download_files")
    async downloadDocumentFile(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("documentId") documentId: string,
        @Query("accessToken") accessToken: string,
        @Query("fileType") fileType: string | undefined,
        @Res() res: Response,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }

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
            const file = await this.eformsignService.downloadDocumentFile(accessToken, documentId, parsedFileType);

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
