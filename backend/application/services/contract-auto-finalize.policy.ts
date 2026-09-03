/**
 * Selection policy for the daily contract auto-finalize run, kept pure so the
 * date boundaries — the part of this feature most likely to be wrong — are unit
 * tested without a scheduler or a database in the frame.
 */

import { DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG } from "domain/entities/system-setting.entity";
import type { ReviewStageContract } from "domain/repositories/eformsign-doc.repository.interface";

/** Initial attempt plus two retries, per the approved design. */
export const CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS = 3;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string | null | undefined): value is string {
    return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}

export type AutoFinalizeVerdict =
    | { eligible: true }
    | {
        eligible: false;
        reason: "no-end-date" | "end-date-not-passed" | "before-activation" | "attempts-exhausted";
    };

/**
 * A contract is due at the 17:00 KST run on its end date. Contracts missed by a
 * delayed or unavailable scheduler remain eligible on later runs, while the
 * activation date fences out the pre-launch backlog permanently.
 */
export function evaluateAutoFinalize(
    contract: Pick<ReviewStageContract, "contractEndDate" | "autoFinalizeAttempts">,
    context: { sinceDate: string; todayKst: string; graceDays?: number; maxAttempts?: number },
): AutoFinalizeVerdict {
    const maxAttempts = context.maxAttempts ?? CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS;
    if (contract.autoFinalizeAttempts >= maxAttempts) {
        return { eligible: false, reason: "attempts-exhausted" };
    }
    if (!isValidIsoDate(contract.contractEndDate)) {
        return { eligible: false, reason: "no-end-date" };
    }
    if (contract.contractEndDate < context.sinceDate) {
        return { eligible: false, reason: "before-activation" };
    }
    const dueDate = addCalendarDays(contract.contractEndDate, context.graceDays ?? DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays);
    if (dueDate > context.todayKst) {
        return { eligible: false, reason: "end-date-not-passed" };
    }
    return { eligible: true };
}

function addCalendarDays(date: string, days: number): string {
    const result = new Date(`${date}T00:00:00.000Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
}
