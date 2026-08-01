import { isProviderReviewWorkflowStep } from "./eformsign-status-codes";

/**
 * Display status for an eformsign document, shared verbatim by the desktop and
 * mobile contracts UIs so both platforms bucket documents identically.
 *
 * 서명 완료 vs 검토 필요: once the customer has signed, the document sits in the
 * provider-review workflow step. The provider is only expected to act from
 * 1 business day before the contract end date, so until then the document is
 * surfaced as 서명 완료 and flips to 검토 필요 when the window opens.
 */
export type ContractDocStatusLabel = "대기" | "서명 완료" | "검토 필요" | "계약 완료" | "기간 만료";

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
    pending: "대기",
    signed: "서명 완료",
    review: "검토 필요",
    completed: "계약 완료",
    expired: "기간 만료",
    unknown: "알 수 없음",
} as const satisfies Record<ContractDocDisplayStatus, string>;

export function isContractDocDisplayStatus(value: unknown): value is ContractDocDisplayStatus {
    return typeof value === "string" && value in CONTRACT_DOC_DISPLAY_STATUS_LABELS;
}

/**
 * 한국 공휴일 — backend/domain/utils/business-days.ts의 KR_HOLIDAYS 사본.
 * 발급 가능 연도 기준 2026~2027 hardcode, 매년 두 파일을 함께 갱신할 것.
 * (백엔드 빌드는 workspace TS를 import하지 못해 사본으로 유지한다.)
 */
export const KR_HOLIDAYS = new Set<string>([
    // 2026
    "2026-01-01", // 신정
    "2026-02-16", "2026-02-17", "2026-02-18", // 설날
    "2026-03-01", // 삼일절
    "2026-03-02", // 삼일절 대체 (일요일)
    "2026-05-01", // 노동절
    "2026-05-05", // 어린이날
    "2026-05-24", "2026-05-25", // 부처님오신날 + 대체
    "2026-06-03", // 제9회 전국동시지방선거
    "2026-06-06", // 현충일
    "2026-07-17", // 제헌절
    "2026-08-15", // 광복절
    "2026-08-17", // 광복절 대체 (토요일)
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // 추석 + 대체
    "2026-10-03", "2026-10-05", // 개천절 + 대체 (토요일)
    "2026-10-09", // 한글날
    "2026-12-25", // 크리스마스
    // 2027
    "2027-01-01", // 신정
    "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // 설날 + 대체
    "2027-03-01", // 삼일절
    "2027-05-01", // 노동절
    "2027-05-05", // 어린이날
    "2027-05-13", // 부처님오신날
    "2027-06-06", "2027-06-07", // 현충일 + 대체 (일요일)
    "2027-07-17", // 제헌절
    "2027-08-15", "2027-08-16", // 광복절 + 대체 (일요일)
    "2027-09-14", "2027-09-15", "2027-09-16", // 추석
    "2027-10-03", "2027-10-04", // 개천절 + 대체 (일요일)
    "2027-10-09", // 한글날
    "2027-12-25",
]);

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
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isBusinessDayKr(ymd: string, date: Date): boolean {
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    return !KR_HOLIDAYS.has(ymd);
}

const SUBTRACT_BUSINESS_DAY_SEARCH_LIMIT = 30;

/** Step back `days` Korean business days (weekends AND KR holidays skipped). */
function subtractBusinessDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    let remaining = days;
    for (let i = 0; remaining > 0 && i < SUBTRACT_BUSINESS_DAY_SEARCH_LIMIT; i += 1) {
        result.setUTCDate(result.getUTCDate() - 1);
        if (isBusinessDayKr(result.toISOString().slice(0, 10), result)) remaining -= 1;
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
