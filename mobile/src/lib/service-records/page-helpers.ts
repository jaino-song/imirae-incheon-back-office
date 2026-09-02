import { countBusinessDaysKr, isoDateInKorea } from "@/lib/date/business-days";

export function isServiceDateMismatch(
    serviceDate: string,
    today = isoDateInKorea(),
): boolean {
    return serviceDate !== today;
}

// Number of Korean business days the schedule moves when the caregiver picks
// `nextIso` instead of the expected `expectedIso`. `countBusinessDaysKr`
// counts both endpoints inclusive, so subtract 1 to get the shift amount.
// Returns `null` (instead of throwing) when either date falls in a year the
// holiday calendar doesn't cover, or when `countBusinessDaysKr` itself
// returns `null` (invalid ISO input) — callers must treat `null` as "the
// shift cannot be computed" and avoid presenting it as a valid value.
export function getServiceDateShiftBusinessDays(expectedIso: string, nextIso: string): number | null {
    let count: number | null;
    try {
        count = countBusinessDaysKr(expectedIso, nextIso);
    } catch {
        return null;
    }
    if (count === null) return null;
    return count - 1;
}

interface DayButtonState {
    done: boolean;
    open: boolean;
    isRecordFinalized: boolean;
}

export function isDayButtonDisabled({ done, open, isRecordFinalized }: DayButtonState): boolean {
    return (!done && !open) || isRecordFinalized;
}
