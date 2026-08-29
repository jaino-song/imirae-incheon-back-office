import { isProviderReviewWorkflowStep } from "./eformsign-status-codes";
import { assertSupportedKoreanHolidayYear, isBusinessDayKr } from "../utils/business-days";

// Preserve the historical named export for consumers that imported the
// display-status module directly; the set itself now comes from the single
// versioned calendar source rather than a second hand-maintained copy.
export { KR_HOLIDAYS } from "../utils/business-days";

/**
 * Display status for an eformsign document, shared verbatim by the desktop and
 * mobile contracts UIs so both platforms bucket documents identically.
 *
 * 서명 완료 vs 검토 필요: once the customer has signed, the document sits in the
 * provider-review workflow step. The provider is only expected to act from
 * 1 business day before the contract end date, so until then the document is
 * surfaced as 서명 완료 and flips to 검토 필요 when the window opens.
 */
export type ContractDocStatusLabel = "서명 대기" | "서명 완료" | "검토 필요" | "계약 완료" | "기간 만료";

export type ContractDocStatusCategory = "completed" | "expired" | "in-progress";

/**
 * Wire enum for a document's display status. The BACKEND is the authority: it
 * stamps `display_status` on document payloads at serve time, and clients map
 * it to a label/variant without re-deriving. The client-side resolver below is
 * the fallback for payloads that predate the field, and the backend keeps a
 * byte-identical copy of this rule pinned by parity tests
 * (backend/application/utils/eformsign-doc-display-status.ts).
 */
export type ContractDocDisplayStatus =
    | "pending"
    | "signed"
    | "review"
    | "completed"
    | "expired"
    | "unknown";

export const CONTRACT_DOC_DISPLAY_STATUS_LABELS = {
    pending: "서명 대기",
    signed: "서명 완료",
    review: "검토 필요",
    completed: "계약 완료",
    expired: "기간 만료",
    unknown: "알 수 없음",
} as const satisfies Record<ContractDocDisplayStatus, string>;

export function isContractDocDisplayStatus(value: unknown): value is ContractDocDisplayStatus {
    return typeof value === "string" && value in CONTRACT_DOC_DISPLAY_STATUS_LABELS;
}

const KST_TIME_ZONE = "Asia/Seoul";

/** en-CA locale renders YYYY-MM-DD, giving the KST calendar day of an instant. */
const KST_YMD_FORMAT = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function parseYmdToUtc(ymd: string): Date | null {
    const match = YMD_PATTERN.exec(ymd);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return parsed;
}

const SUBTRACT_BUSINESS_DAY_SEARCH_LIMIT = 30;

/** Step back `days` Korean business days (weekends AND KR holidays skipped). */
function subtractBusinessDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    let remaining = days;
    for (let i = 0; remaining > 0 && i < SUBTRACT_BUSINESS_DAY_SEARCH_LIMIT; i += 1) {
        result.setUTCDate(result.getUTCDate() - 1);
        if (isBusinessDayKr(result.toISOString().slice(0, 10))) remaining -= 1;
    }
    return result;
}

/**
 * True when today (KST) is on or after 1 Korean business day before the
 * contract end date — e.g. a Friday end date opens on Thursday, a Monday end
 * date on the preceding Friday, and holidays are skipped like weekends — and
 * stays true after the end date passes.
 *
 * A missing or malformed end date opens the window (the pre-date-rule
 * behavior), so documents without recoverable dates never hide the review cue.
 */
export function isContractReviewWindowOpen(
    contractEndDate: string | null | undefined,
    now: Date = new Date(),
): boolean {
    const endDate = contractEndDate ? parseYmdToUtc(contractEndDate) : null;
    if (!endDate) return true;
    assertSupportedKoreanHolidayYear(endDate.getUTCFullYear());

    const threshold = subtractBusinessDays(endDate, 1);
    const todayKst = KST_YMD_FORMAT.format(now);
    return todayKst >= threshold.toISOString().slice(0, 10);
}

/**
 * Resolve the wire display status for a contract document from its category,
 * workflow step, and end date. Single rule shared by both apps; the backend
 * keeps a parity-tested copy.
 */
export function resolveContractDocDisplayStatus(params: {
    category: ContractDocStatusCategory;
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined;
    contractEndDate: string | null | undefined;
    now?: Date;
}): Exclude<ContractDocDisplayStatus, "unknown"> {
    if (params.category === "completed") return "completed";
    if (params.category === "expired") return "expired";
    if (!isProviderReviewWorkflowStep(params.currentStatus)) return "pending";
    return isContractReviewWindowOpen(params.contractEndDate, params.now) ? "review" : "signed";
}

/** Resolve the display label for a contract document from its category, workflow step, and end date. */
export function resolveContractDocStatusLabel(params: {
    category: ContractDocStatusCategory;
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined;
    contractEndDate: string | null | undefined;
    now?: Date;
}): ContractDocStatusLabel {
    return CONTRACT_DOC_DISPLAY_STATUS_LABELS[resolveContractDocDisplayStatus(params)];
}
