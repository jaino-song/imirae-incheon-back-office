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
export function getServiceDateShiftBusinessDays(expectedIso: string, nextIso: string): number {
    return (countBusinessDaysKr(expectedIso, nextIso) ?? 1) - 1;
}

interface DayButtonState {
    done: boolean;
    open: boolean;
    isRecordFinalized: boolean;
}

export function isDayButtonDisabled({ done, open, isRecordFinalized }: DayButtonState): boolean {
    return (!done && !open) || isRecordFinalized;
}
