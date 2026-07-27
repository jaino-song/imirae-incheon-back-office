import { isoDateInKorea } from "@/lib/date/business-days";

export function isServiceDateMismatch(
    serviceDate: string,
    today = isoDateInKorea(),
): boolean {
    return serviceDate !== today;
}

interface DayButtonState {
    done: boolean;
    open: boolean;
    isRecordFinalized: boolean;
}

export function isDayButtonDisabled({ done, open, isRecordFinalized }: DayButtonState): boolean {
    return (!done && !open) || isRecordFinalized;
}
