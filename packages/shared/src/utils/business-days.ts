/**
 * Versioned Korean holiday calendar used by every business-day consumer.
 *
 * A calendar year is deliberately either present here or unsupported. Falling
 * back to weekdays-only for an unknown year changes contractual durations and
 * is therefore unsafe. Add a complete year and bump the version before that
 * year is used in production.
 */
export const KOREAN_HOLIDAY_CALENDAR_VERSION = "kr-public-holidays-2024-2027.v1" as const;

export const KOREAN_HOLIDAY_CALENDAR: Readonly<Record<number, readonly string[]>> = {
    // 2024
    2024: [
        "2024-01-01", // New Year's Day
        "2024-02-09", "2024-02-10", "2024-02-11", "2024-02-12", // Seollal + substitute
        "2024-03-01", // Independence Movement Day
        "2024-04-10", // 22nd National Assembly election
        "2024-05-01", // Labor Day
        "2024-05-05", "2024-05-06", // Children's Day + substitute
        "2024-05-15", // Buddha's Birthday
        "2024-06-06", // Memorial Day
        "2024-08-15", // Liberation Day
        "2024-09-16", "2024-09-17", "2024-09-18", // Chuseok
        "2024-10-03", // National Foundation Day
        "2024-10-09", // Hangeul Day
        "2024-12-25", // Christmas
    ],
    // 2025
    2025: [
        "2025-01-01", // New Year's Day
        "2025-01-28", "2025-01-29", "2025-01-30", // Seollal
        "2025-03-01", "2025-03-03", // Independence Movement Day + substitute
        "2025-05-01", // Labor Day
        "2025-05-05", "2025-05-06", // Children's Day/Buddha's Birthday + substitute
        "2025-06-06", // Memorial Day
        "2025-08-15", // Liberation Day
        "2025-10-03", // National Foundation Day
        "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08", // Chuseok + substitute
        "2025-10-09", // Hangeul Day
        "2025-12-25", // Christmas
    ],
    // 2026
    2026: [
        "2026-01-01", // New Year's Day
        "2026-02-16", "2026-02-17", "2026-02-18", // Seollal
        "2026-03-01", // Independence Movement Day
        "2026-03-02", // substitute holiday
        "2026-05-01", // Labor Day
        "2026-05-05", // Children's Day
        "2026-05-24", "2026-05-25", // Buddha's Birthday + substitute
        "2026-06-03", // local elections
        "2026-06-06", // Memorial Day
        "2026-07-17", // Constitution Day
        "2026-08-15", // Liberation Day
        "2026-08-17", // substitute holiday
        "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // Chuseok + substitute
        "2026-10-03", "2026-10-05", // National Foundation Day + substitute
        "2026-10-09", // Hangeul Day
        "2026-12-25", // Christmas
    ],
    // 2027
    2027: [
        "2027-01-01", // New Year's Day
        "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // Seollal + substitute
        "2027-03-01", // Independence Movement Day
        "2027-05-01", // Labor Day
        "2027-05-05", // Children's Day
        "2027-05-13", // Buddha's Birthday
        "2027-06-06", "2027-06-07", // Memorial Day + substitute
        "2027-07-17", // Constitution Day
        "2027-08-15", "2027-08-16", // Liberation Day + substitute
        "2027-09-14", "2027-09-15", "2027-09-16", // Chuseok
        "2027-10-03", "2027-10-04", // National Foundation Day + substitute
        "2027-10-09", // Hangeul Day
        "2027-12-25", // Christmas
    ],
};

/** All dates in the authoritative calendar, useful for diagnostics and parity checks. */
export const KOREAN_HOLIDAYS = new Set<string>(
    Object.values(KOREAN_HOLIDAY_CALENDAR).flat(),
);

/**
 * Legacy 2026/2027 export retained for callers that only need the original
 * release window. It is derived from the authoritative calendar above (not a
 * second hand-maintained holiday list).
 */
export const KR_HOLIDAYS = new Set<string>([
    ...KOREAN_HOLIDAY_CALENDAR[2026]!,
    ...KOREAN_HOLIDAY_CALENDAR[2027]!,
]);

export class UnsupportedKoreanHolidayYearError extends Error {
    readonly year: number;

    constructor(year: number) {
        super(`Korean holiday calendar does not support year ${year} (version ${KOREAN_HOLIDAY_CALENDAR_VERSION})`);
        this.name = "UnsupportedKoreanHolidayYearError";
        this.year = year;
    }
}

export function getKoreanHolidays(year: number): ReadonlySet<string> {
    const holidays = KOREAN_HOLIDAY_CALENDAR[year];
    if (!holidays) throw new UnsupportedKoreanHolidayYearError(year);
    return new Set(holidays);
}

export function assertSupportedKoreanHolidayYear(year: number): void {
    if (!KOREAN_HOLIDAY_CALENDAR[year]) {
        throw new UnsupportedKoreanHolidayYearError(year);
    }
}

const KOREA_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

function parseIsoDate(iso: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
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

function isoFromUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function assertSupportedIsoYear(iso: string): void {
    assertSupportedKoreanHolidayYear(Number(iso.slice(0, 4)));
}

export function isBusinessDayKr(iso: string): boolean {
    if (!iso) return false;
    const date = parseIsoDate(iso);
    if (!date) return false;

    // Fail closed for a valid date in an unpopulated year. This is intentionally
    // before the weekday check: an unsupported Saturday must not look safe merely
    // because it is a weekend.
    assertSupportedIsoYear(iso);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    return !KOREAN_HOLIDAYS.has(iso);
}

export function isoDateInKorea(date = new Date()): string {
    const parts = KOREA_DATE_FORMATTER.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
}

export function diffBusinessDaysKr(targetISO: string, baseISO = isoDateInKorea()): number | null {
    const target = parseIsoDate(targetISO);
    const base = parseIsoDate(baseISO);
    if (!target || !base) return null;

    assertSupportedIsoYear(targetISO);
    assertSupportedIsoYear(baseISO);

    const targetTime = target.getTime();
    const baseTime = base.getTime();
    if (targetTime === baseTime) return 0;

    const cursor = new Date(base);
    let count = 0;

    if (targetTime > baseTime) {
        while (cursor.getTime() < targetTime) {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
            if (isBusinessDayKr(isoFromUtcDate(cursor))) count++;
        }
        return count;
    }

    while (cursor.getTime() > targetTime) {
        if (isBusinessDayKr(isoFromUtcDate(cursor))) count++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return -count;
}

// Counts startISO as day 1. If startISO is not a business day, the next
// Korean business day becomes day 1.
export function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string {
    if (!startISO || !Number.isFinite(numberOfBusinessDays) || numberOfBusinessDays <= 0) return "";
    const start = parseIsoDate(startISO);
    if (!start) return "";
    assertSupportedIsoYear(startISO);

    const cursor = new Date(start);
    let counted = 0;

    for (let i = 0; i < 365 && counted < numberOfBusinessDays; i += 1) {
        const iso = isoFromUtcDate(cursor);
        if (isBusinessDayKr(iso)) {
            counted += 1;
            if (counted === numberOfBusinessDays) return iso;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return "";
}

// Ported from mobile/src/lib/date/business-days.ts, which has these two
// helpers but frontend does not. Kept here so this module is a complete
// superset of both call sites' business-day needs.
const NEXT_BUSINESS_DAY_SEARCH_LIMIT = 30;

export function nextBusinessDayKr(iso: string): string {
    const start = parseIsoDate(iso);
    if (!start) throw new Error(`Invalid Korean calendar date: ${iso}`);
    assertSupportedIsoYear(iso);

    const cursor = new Date(start);
    for (let i = 0; i < NEXT_BUSINESS_DAY_SEARCH_LIMIT; i += 1) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const cursorIso = isoFromUtcDate(cursor);
        if (isBusinessDayKr(cursorIso)) return cursorIso;
    }

    throw new Error(
        `Unable to find next Korean business day within ${NEXT_BUSINESS_DAY_SEARCH_LIMIT} days after ${iso}`,
    );
}

export function addBusinessDaysKr(iso: string, n: number): string {
    const parsed = parseIsoDate(iso);
    if (!parsed) throw new Error(`Invalid Korean calendar date: ${iso}`);
    assertSupportedIsoYear(iso);
    if (n <= 0) return iso;

    let cursor = iso;
    for (let i = 0; i < n; i += 1) {
        cursor = nextBusinessDayKr(cursor);
    }

    return cursor;
}

export function countBusinessDaysKr(startISO: string, endISO: string): number | null {
    const start = parseIsoDate(startISO);
    const end = parseIsoDate(endISO);
    if (!start || !end || start.getTime() > end.getTime()) return null;

    assertSupportedIsoYear(startISO);
    assertSupportedIsoYear(endISO);

    const cursor = new Date(start);
    let count = 0;
    while (cursor.getTime() <= end.getTime()) {
        if (isBusinessDayKr(isoFromUtcDate(cursor))) count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
}
