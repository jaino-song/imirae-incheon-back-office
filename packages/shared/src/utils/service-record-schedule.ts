import { addBusinessDaysKr, calcEndDateBusinessDays } from "./business-days";

export interface ServiceRecordScheduleEntry {
    sessionIndex: number;
    serviceDate: string;
}

const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function datePartOf(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(DATE_ONLY_PREFIX);
    return match?.[0] ?? null;
}

/**
 * Finds the highest-indexed written session that still precedes `sessionIndex`.
 * Written sessions need not be contiguous (a gap is fine) — only the closest
 * preceding one matters, since that is what the next slot's date chains from.
 */
function findPrecedingRecord(
    sessionIndex: number,
    records: ReadonlyArray<ServiceRecordScheduleEntry>,
): ServiceRecordScheduleEntry | null {
    let preceding: ServiceRecordScheduleEntry | null = null;
    for (const record of records) {
        if (record.sessionIndex >= sessionIndex) continue;
        if (preceding === null || record.sessionIndex > preceding.sessionIndex) {
            preceding = record;
        }
    }
    return preceding;
}

/**
 * Computes the expected (예정일) date for an unwritten session slot.
 *
 * Written slots chain the schedule forward: an unwritten slot's expected
 * date is N business days after the *actual* (possibly postponed) date of
 * the closest preceding written session, matching the caregiver wizard's
 * own scheduling logic. Only when no written session precedes this slot do
 * we fall back to counting business days from the assignment's start date.
 */
export function getExpectedSessionDateFromRecords(
    startDate: string | null,
    sessionIndex: number,
    records: ReadonlyArray<ServiceRecordScheduleEntry>,
): string | null {
    const precedingRecord = findPrecedingRecord(sessionIndex, records);
    if (precedingRecord) {
        const precedingDatePart = datePartOf(precedingRecord.serviceDate);
        if (precedingDatePart) {
            return addBusinessDaysKr(precedingDatePart, sessionIndex - precedingRecord.sessionIndex) || null;
        }
    }

    const startDatePart = datePartOf(startDate);
    if (!startDatePart) return null;
    return calcEndDateBusinessDays(startDatePart, sessionIndex) || null;
}
