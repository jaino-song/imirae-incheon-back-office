import { normalizeEformsignStatusCode, normalizeEformsignStepType } from "domain/utils/eformsign-status-code";

import { documentCustomerNameValue, isRecord, stringFromUnknown, type UnknownRecord } from "application/utils/eformsign-document-customer-name";
import { eformsignDocumentTemplateId } from "application/utils/eformsign-document-template-id";
import { getDocumentCreatedTimestamp } from "application/services/eformsign.service";

/**
 * The rules that turn a set of eformsign documents into what the contract list shows:
 * which documents survive each filter, how they are searched, and what order they end in.
 *
 * These live apart from the controller because the local mirror has to reproduce the list
 * exactly, and the only way to be sure of that is for both paths to run the same code.
 * Duplicating a rule here has already cost this codebase three separate defects.
 */

export type EformsignListDoc = {
    id: string;
    created_date?: unknown;
    createdDate?: unknown;
    fields?: unknown;
    detail_template_info?: unknown;
} & Record<string, unknown>;

export type TemplateMatch = "include" | "exclude";
export type DocumentStatusCategory =
    | "drafting"
    | "in-progress"
    | "completed"
    | "expired"
    | "unknown";

export const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
export const EXPIRED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080", "090"]);
export const DELETED_STATUS_CODES = new Set(["047", "049"]);
export const IN_PROGRESS_STATUS_CODES = new Set(["001", "002", "010", "020", "030", "043", "060", "063", "064", "070"]);
export const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
export const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
export const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
export const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];
export const CHOSUNG_LIST = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;



/**
 * `templateId` may be a single id or a comma-separated list (BJJ-multi-tier: the UI passes every
 * configured 제공기록지 tier so documents created on any tier's template are matched). A single id
 * is naturally backward-compatible since it round-trips through the same split/trim/Set path.
 */
export function filterDocumentsByTemplate(
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
        const documentTemplateId = eformsignDocumentTemplateId(document);
        const matches = documentTemplateId !== null && templateIds.has(documentTemplateId);
        return templateMatch === "include" ? matches : !matches;
    });
}

export function getCurrentStatus(document: EformsignListDoc): UnknownRecord | null {
    return isRecord(document["current_status"]) ? document["current_status"] : null;
}

export function isProviderReviewStep(document: EformsignListDoc): boolean {
    const currentStatus = getCurrentStatus(document);
    const stepType = normalizeEformsignStepType(
        stringFromUnknown(currentStatus?.["step_type"]),
    );
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

export function getDocumentStatusCategory(document: EformsignListDoc): DocumentStatusCategory {
    const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
    const normalized = normalizeEformsignStatusCode(statusType);
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

export function filterDocumentsByStatusCategory(
    documents: EformsignListDoc[],
    statusCategory: DocumentStatusCategory | undefined,
): EformsignListDoc[] {
    if (!statusCategory) {
        return documents;
    }

    return documents.filter((document) => {
        const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
        if (DELETED_STATUS_CODES.has(normalizeEformsignStatusCode(statusType))) {
            return false;
        }
        return getDocumentStatusCategory(document) === statusCategory;
    });
}

export function filterOutDeletedDocuments(
    documents: EformsignListDoc[],
    excludeDeleted: boolean,
): EformsignListDoc[] {
    if (!excludeDeleted) {
        return documents;
    }
    return documents.filter((document) => {
        const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
        return !DELETED_STATUS_CODES.has(normalizeEformsignStatusCode(statusType));
    });
}

export function getChosung(character: string): string {
    const code = character.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
        return CHOSUNG_LIST[Math.floor((code - 0xac00) / 588)] ?? character;
    }
    return character;
}

export function matchesKoreanSearch(target: string, query: string): boolean {
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

export function sortDocumentsByCreatedDate(documents: EformsignListDoc[]): EformsignListDoc[] {
    return [...documents].sort((a, b) => {
        const byCreated = getDocumentCreatedTimestamp(b) - getDocumentCreatedTimestamp(a);
        if (byCreated !== 0) {
            return byCreated;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

export function documentSearchValues(document: EformsignListDoc, localValues: string[]): string[] {
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
export function documentSearchIndex(document: EformsignListDoc): string[] {
    return documentSearchValues(document, []).filter((value) => value.length > 0);
}

/**
 * Which documents a local list would put in each tab, standing in for "whichever vendor
 * inbox the document sits in" — the mirror does not record that, so the switch has to
 * answer the tabs from status codes instead.
 *
 * Deleted codes are named here rather than folded into a category, because
 * getDocumentStatusCategory puts them in "unknown" alongside every blank or unrecognised
 * status, and the UI does not treat those alike: it shows the deleted ones under 기간 만료
 * and everything else it cannot place under 진행 중.
 */
const SCOPE_SELECTORS: Readonly<Record<string, (document: EformsignListDoc) => boolean>> = {
    "in-progress": (document) => {
        const category = getDocumentStatusCategory(document);
        return category === "drafting"
            || category === "in-progress"
            || (category === "unknown" && !isDeletedDocument(document));
    },
    completed: (document) => getDocumentStatusCategory(document) === "completed",
    rejected: (document) => {
        const category = getDocumentStatusCategory(document);
        return category === "expired"
            || (category === "unknown" && isDeletedDocument(document));
    },
};

export function isDeletedDocument(document: EformsignListDoc): boolean {
    const statusType = stringFromUnknown(getCurrentStatus(document)?.["status_type"]);
    return DELETED_STATUS_CODES.has(normalizeEformsignStatusCode(statusType));
}

/**
 * The tab selector for a scope, or undefined for the merged list, which does not filter by
 * inbox at all. Both sides of the shadow comparison resolve it from here by name so they
 * cannot come to different conclusions about what a tab contains.
 */
export function eformsignListScopeSelector(
    scope: string,
): ((document: EformsignListDoc) => boolean) | undefined {
    return SCOPE_SELECTORS[scope];
}
