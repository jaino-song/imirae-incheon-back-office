/**
 * Versioned Korean holiday calendar used by every business-day consumer.
 *
 * A calendar year is deliberately either present here or unsupported. Falling
 * back to weekdays-only for an unknown year changes contractual durations and
 * is therefore unsafe. Add a complete year and bump the version before that
 * year is used in production.
 */
export declare const KOREAN_HOLIDAY_CALENDAR_VERSION: "kr-public-holidays-2024-2027.v1";
export declare const KOREAN_HOLIDAY_CALENDAR: Readonly<Record<number, readonly string[]>>;
/** All dates in the authoritative calendar, useful for diagnostics and parity checks. */
export declare const KOREAN_HOLIDAYS: Set<string>;
/**
 * Legacy 2026/2027 export retained for callers that only need the original
 * release window. It is derived from the authoritative calendar above (not a
 * second hand-maintained holiday list).
 */
export declare const KR_HOLIDAYS: Set<string>;
export declare class UnsupportedKoreanHolidayYearError extends Error {
    readonly year: number;
    constructor(year: number);
}
export declare function getKoreanHolidays(year: number): ReadonlySet<string>;
export declare function assertSupportedKoreanHolidayYear(year: number): void;
export declare function isBusinessDayKr(iso: string): boolean;
export declare function isoDateInKorea(date?: Date): string;
export declare function diffBusinessDaysKr(targetISO: string, baseISO?: string): number | null;
export declare function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string;
export declare function nextBusinessDayKr(iso: string): string;
export declare function addBusinessDaysKr(iso: string, n: number): string;
export declare function countBusinessDaysKr(startISO: string, endISO: string): number | null;
