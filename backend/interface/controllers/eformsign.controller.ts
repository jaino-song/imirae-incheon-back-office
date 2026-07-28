import { BadRequestException, Controller, Post, Get, Delete, Body, Query, Param, HttpException, HttpStatus, UseGuards, Res, Logger } from "@nestjs/common";
import { EformsignService, getDocumentCreatedTimestamp } from "../../application/services/eformsign.service";
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
    isRecord,
    stringFromUnknown,
    type UnknownRecord,
} from "application/utils/eformsign-document-customer-name";

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

type EformsignListDoc = {
    id: string;
    created_date?: unknown;
    createdDate?: unknown;
    fields?: unknown;
    detail_template_info?: unknown;
} & Record<string, unknown>;

type TemplateMatch = "include" | "exclude";
type DocumentStatusCategory = "drafting" | "in-progress" | "completed" | "expired" | "unknown";

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const EXPIRED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080", "090"]);
const DELETED_STATUS_CODES = new Set(["047", "049"]);
const IN_PROGRESS_STATUS_CODES = new Set(["001", "002", "010", "020", "030", "043", "060", "063", "064", "070"]);
const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];
const STATUS_NAME_TO_CODE: Record<string, string> = {
    doc_tempsave: "001",
    doc_create: "002",
    doc_complete: "003",
    doc_request_approval: "010",
    doc_reject_approval: "011",
    doc_accept_approval: "012",
    doc_request_reception: "020",
    doc_reject_reception: "021",
    doc_accept_reception: "022",
    doc_request_outsider: "030",
    doc_reject_outsider: "031",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_update: "043",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
};
const CHOSUNG_LIST = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

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

function getDocumentTemplateId(document: EformsignListDoc): string | null {
    const template = isRecord(document["template"]) ? document["template"] : null;
    const detailTemplate = isRecord(document.detail_template_info)
        ? document.detail_template_info
        : null;
    const candidates = [template?.["id"], detailTemplate?.["id"], document["template_id"]];
    const templateId = candidates.find(
        (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    );

    return templateId ?? null;
}

/**
 * `templateId` may be a single id or a comma-separated list (BJJ-multi-tier: the UI passes every
 * configured 제공기록지 tier so documents created on any tier's template are matched). A single id
 * is naturally backward-compatible since it round-trips through the same split/trim/Set path.
 */
function filterDocumentsByTemplate(
    documents: EformsignListDoc[],
    templateId: string | undefined,
    templateMatch: TemplateMatch,
): EformsignListDoc[] {
    if (!templateId) {
        return documents;
    }
    const templateIds = new Set(
        templateId.split(",").map((id) => id.trim()).filter((id) => id.length > 0),
    );
    if (templateIds.size === 0) {
        return documents;
    }

    return documents.filter((document) => {
        const documentTemplateId = getDocumentTemplateId(document);
        const matches = documentTemplateId !== null && templateIds.has(documentTemplateId);
        return templateMatch === "include" ? matches : !matches;
    });
}

function normalizeStatusCode(code: string | null): string {
    const normalized = code?.trim().toLowerCase();
    if (!normalized) {
        return "000";
    }
    return STATUS_NAME_TO_CODE[normalized] ?? normalized.padStart(3, "0");
}

function getCurrentStatus(document: EformsignListDoc): UnknownRecord | null {
    return isRecord(document["current_status"]) ? document["current_status"] : null;
}

function isProviderReviewStep(document: EformsignListDoc): boolean {
    const currentStatus = getCurrentStatus(document);
    const stepType = stringFromUnknown(currentStatus?.["step_type"]) ?? "";
    const stepName = stringFromUnknown(currentStatus?.["step_name"]) ?? "";

    if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) {
        return true;
    }
    if (!stepName || CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) {
        return false;
    }

    const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
    const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
    return hasProviderOwner && hasReviewAction;
}

function getDocumentStatusCategory(document: EformsignListDoc): DocumentStatusCategory {
    const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
    const normalized = normalizeStatusCode(statusType);
    if (COMPLETED_STATUS_CODES.has(normalized)) {
        return "completed";
    }
    if (EXPIRED_STATUS_CODES.has(normalized) && !DELETED_STATUS_CODES.has(normalized)) {
        return "expired";
    }
    if (DELETED_STATUS_CODES.has(normalized)) {
        return "unknown";
    }
    if (!IN_PROGRESS_STATUS_CODES.has(normalized)) {
        return "unknown";
    }
    return isProviderReviewStep(document) ? "in-progress" : "drafting";
}

function filterDocumentsByStatusCategory(
    documents: EformsignListDoc[],
    statusCategory: DocumentStatusCategory | undefined,
): EformsignListDoc[] {
    if (!statusCategory) {
        return documents;
    }

    return documents.filter((document) => {
        const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
        if (DELETED_STATUS_CODES.has(normalizeStatusCode(statusType))) {
            return false;
        }
        return getDocumentStatusCategory(document) === statusCategory;
    });
}

function filterOutDeletedDocuments(
    documents: EformsignListDoc[],
    excludeDeleted: boolean,
): EformsignListDoc[] {
    if (!excludeDeleted) {
        return documents;
    }
    return documents.filter((document) => {
        const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
        return !DELETED_STATUS_CODES.has(normalizeStatusCode(statusType));
    });
}

function getChosung(character: string): string {
    const code = character.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
        return CHOSUNG_LIST[Math.floor((code - 0xac00) / 588)] ?? character;
    }
    return character;
}

function matchesKoreanSearch(target: string, query: string): boolean {
    const normalizedTarget = target.normalize("NFC");
    if (normalizedTarget.toLowerCase().includes(query.toLowerCase())) {
        return true;
    }

    const hasChosung = query.split("").some((character) =>
        CHOSUNG_LIST.includes(character as (typeof CHOSUNG_LIST)[number]),
    );
    if (!hasChosung) {
        return false;
    }

    const targetChosung = normalizedTarget.split("").map(getChosung).join("").replace(/\s/g, "");
    return targetChosung.startsWith(query);
}

function sortDocumentsByCreatedDate(documents: EformsignListDoc[]): EformsignListDoc[] {
    return [...documents].sort((a, b) => {
        const byCreated = getDocumentCreatedTimestamp(b) - getDocumentCreatedTimestamp(a);
        if (byCreated !== 0) {
            return byCreated;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
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

function documentSearchValues(document: EformsignListDoc, localValues: string[]): string[] {
    const template = isRecord(document["template"]) ? document["template"] : null;
    const templateName = (stringFromUnknown(template?.["name"]) ?? "").replace(/\s*계약서$/, "");
    const documentNumber = (
        stringFromUnknown(document["document_number"]) ?? document.id?.slice(0, 16)
    ) || "-";

    return [
        documentCustomerNameValue(document) ?? "고객 미지정",
        ...localValues,
        stringFromUnknown(document["document_name"]) ?? "",
        templateName,
        documentNumber,
    ];
}

/**
 * 문서 자체에서 파생되는 검색 값(고객명/문서명/템플릿명/문서번호)만 미리 뽑아 스냅샷에 넣는다.
 * 로컬 DB에서 오는 값(stepRecipientName)은 검색어가 있을 때만 조회하는 기존 동작을 유지하기
 * 위해 여기에 포함하지 않고, 질의 시점에 합쳐 쓴다. 빈 문자열은 어떤 검색어와도 매칭되지
 * 않으므로 제거해 스냅샷 크기를 줄인다.
 */
function documentSearchIndex(document: EformsignListDoc): string[] {
    return documentSearchValues(document, []).filter((value) => value.length > 0);
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
    return {
        status_type: typeof currentStatus?.status_type === "string" ? currentStatus.status_type : null,
        step_type: typeof currentStatus?.step_type === "string" ? currentStatus.step_type : null,
        step_name: typeof currentStatus?.step_name === "string" ? currentStatus.step_name : null,
        step_recipient_types: stepRecipients.map((r) => (typeof r?.recipient_type === "string" ? r.recipient_type : null)),
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
    ) { }

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
        const snapshot = await this.documentSnapshotService.getOrBuild<EformsignListDoc>(
            { scope, branchId, accessToken, isHeadquarters: await this.isHeadquartersBranch(branchId) },
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
        );
    }

    /**
     * 현재 지점이 보유한 전자서명 문서 "전체"를 외부 목록에서 모아 최신순으로 돌려준다.
     * 외부 eformsign 목록을 회사 단위로 페이지네이션하면 지점 문서가 뒤 페이지에 있을 때
     * 빈 페이지에서 무한스크롤이 멈춰 누락되므로, 회사 페이지를 훑어 지점 문서를 모은다.
     * 지점 보유 documentId 집합 크기를 기대 개수로 삼아 다 찾으면 조기 종료한다.
     */
    private async collectBranchDocuments(accessToken: string, branchId: string): Promise<EformsignListDoc[]> {
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
    private async collectHeadquartersDocuments(accessToken: string, incheonBranchId: string): Promise<EformsignListDoc[]> {
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

            // 인천점(본사): 회사 전체에서 다른 지점 소유분만 빼고 모은 뒤 요청 구간만 잘라 반환.
            // (필터링 때문에 외부 페이지네이션을 그대로 흘리면 페이지 경계에 빈틈이 생긴다.)
            if (await this.isHeadquartersBranch(branchId)) {
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
