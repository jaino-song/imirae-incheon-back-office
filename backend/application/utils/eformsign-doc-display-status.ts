import {
    getDocumentStatusCategory,
    isProviderReviewStep,
    type EformsignListDoc,
} from "application/utils/eformsign-document-list";
import {
    assertSupportedKoreanHolidayYear,
    isBusinessDayKr,
    isoDateInKorea,
} from "domain/utils/business-days";

/**
 * Wire enum for a document's display status, stamped on list pages, status
 * signals, and the client-docs payload at SERVE time (never into cached
 * snapshots — the review window moves with the calendar). The backend is the
 * authority; clients map this to a label/variant and display it.
 *
 * Byte-identical copy of the rule in
 * packages/shared/src/constants/eformsign-doc-status.ts. The backend domain
 * surface re-exports the same versioned business-day module from the generated
 * backend runtime package. Parity is pinned by
 * backend/test/utils/eformsign-doc-display-status.spec.ts, which mirrors the
 * shared test fixtures — change both files together.
 */
export type EformsignDocDisplayStatus =
    | "pending"
    | "signed"
    | "review"
    | "completed"
    | "expired"
    | "unknown";

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

const SUBTRACT_BUSINESS_DAY_SEARCH_LIMIT = 30;

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

/** Step back `days` Korean business days (weekends AND KR holidays skipped). */
function subtractBusinessDaysKr(date: Date, days: number): Date {
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
 * contract end date — weekends and the shared versioned Korean holiday
 * calendar are both skipped; a missing or malformed end date opens the window
 * (legacy behavior).
 */
export function isContractReviewWindowOpen(
    contractEndDate: string | null | undefined,
    now: Date = new Date(),
): boolean {
    const endDate = contractEndDate ? parseYmdToUtc(contractEndDate) : null;
    if (!endDate) return true;
    assertSupportedKoreanHolidayYear(endDate.getUTCFullYear());

    const threshold = subtractBusinessDaysKr(endDate, 1);
    return isoDateInKorea(now) >= threshold.toISOString().slice(0, 10);
}

/** Resolve the display status of a projected list document. */
export function resolveEformsignDocDisplayStatus(
    document: EformsignListDoc,
    now: Date = new Date(),
): EformsignDocDisplayStatus {
    const category = getDocumentStatusCategory(document);
    if (category === "completed") return "completed";
    if (category === "expired") return "expired";
    if (category === "unknown") return "unknown";
    if (!isProviderReviewStep(document)) return "pending";

    const contractEndDate = typeof document["contract_end_date"] === "string"
        ? document["contract_end_date"]
        : null;
    return isContractReviewWindowOpen(contractEndDate, now) ? "review" : "signed";
}
