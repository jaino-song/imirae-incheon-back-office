/**
 * Selection policy for the nightly contract auto-finalize run, kept pure so the
 * date boundaries — the part of this feature most likely to be wrong — are unit
 * tested without a scheduler or a database in the frame.
 */

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
 * A contract is due the first KST midnight AFTER its end date: end date the 9th
 * → eligible from the 10th (endDate < todayKst), never on the 9th itself. The
 * activation date fences out the pre-launch backlog: contracts that ended
 * before the feature was turned on stay manual forever.
 */
export function evaluateAutoFinalize(
    contract: Pick<ReviewStageContract, "contractEndDate" | "autoFinalizeAttempts">,
    context: { sinceDate: string; todayKst: string },
): AutoFinalizeVerdict {
    if (contract.autoFinalizeAttempts >= CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS) {
        return { eligible: false, reason: "attempts-exhausted" };
    }
    if (!isValidIsoDate(contract.contractEndDate)) {
        return { eligible: false, reason: "no-end-date" };
    }
    if (contract.contractEndDate < context.sinceDate) {
        return { eligible: false, reason: "before-activation" };
    }
    if (contract.contractEndDate >= context.todayKst) {
        return { eligible: false, reason: "end-date-not-passed" };
    }
    return { eligible: true };
}
