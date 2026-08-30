/**
 * Canonical employee status/availability labels (M6: employee status label
 * drift).
 *
 * `working` describes an active assignment. `available`/`unavailable`
 * describe whether the employee can be assigned, so their visible labels
 * must not look like another work-status vocabulary.
 */
export type EmployeeStatus = "available" | "working" | "unavailable";

export const EMPLOYEE_STATUS_LABELS: Readonly<Record<EmployeeStatus, string>> = {
    available: "배정 가능",
    working: "근무 중",
    unavailable: "배정 불가",
};

/**
 * Derive the employee's current work status from the authoritative inputs.
 * An active assignment describes current work; availability only describes
 * whether another assignment may be accepted when no work is active.
 */
export function deriveEmployeeStatus(
    hasActiveAssignment: boolean,
    openToNextWork: boolean,
): EmployeeStatus {
    if (hasActiveAssignment) return "working";
    return openToNextWork ? "available" : "unavailable";
}

/**
 * Labels for the `openToNextWork` (다음 배정 가능 여부) toggle, kept
 * separate from `EMPLOYEE_STATUS_LABELS` because the boolean toggle and the
 * derived employee status remain different data fields even when they share
 * the same assignment-availability copy.
 */
export const OPEN_TO_NEXT_WORK_LABELS: Readonly<Record<"true" | "false", string>> = {
    true: "배정 가능",
    false: "배정 불가",
};

export function getOpenToNextWorkLabel(openToNextWork: boolean): string {
    return OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"];
}
