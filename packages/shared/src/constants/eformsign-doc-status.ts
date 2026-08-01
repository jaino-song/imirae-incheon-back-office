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

/** Step back `days` business days, skipping Saturdays and Sundays. */
function subtractBusinessDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    let remaining = days;
    while (remaining > 0) {
        result.setUTCDate(result.getUTCDate() - 1);
        const weekday = result.getUTCDay();
        if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return result;
}

/**
 * True when today (KST) is on or after 1 business day before the contract end
 * date — e.g. a Friday end date opens on Thursday, a Monday end date on the
 * preceding Friday — and stays true after the end date passes.
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

/** Resolve the display label for a contract document from its category, workflow step, and end date. */
export function resolveContractDocStatusLabel(params: {
    category: ContractDocStatusCategory;
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined;
    contractEndDate: string | null | undefined;
    now?: Date;
}): ContractDocStatusLabel {
    if (params.category === "completed") return "계약 완료";
    if (params.category === "expired") return "기간 만료";
    if (!isProviderReviewWorkflowStep(params.currentStatus)) return "대기";
    return isContractReviewWindowOpen(params.contractEndDate, params.now) ? "검토 필요" : "서명 완료";
}
