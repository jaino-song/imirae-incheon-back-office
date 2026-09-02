import {
    addBusinessDaysKr,
    assertSupportedKoreanHolidayYear,
    calcEndDateBusinessDays,
    countBusinessDaysKr,
    diffBusinessDaysKr,
    KOREAN_HOLIDAY_CALENDAR_VERSION,
    isBusinessDayKr,
    KR_HOLIDAYS,
    nextBusinessDayKr,
    UnsupportedKoreanHolidayYearError,
} from "./business-days";

describe("versioned Korean holiday calendar", () => {
    it("exposes the calendar version and fails closed for an unpopulated year", () => {
        expect(KOREAN_HOLIDAY_CALENDAR_VERSION).toBe("kr-public-holidays-2024-2027.v1");
        expect(() => assertSupportedKoreanHolidayYear(2028))
            .toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => isBusinessDayKr("2028-01-03"))
            .toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => countBusinessDaysKr("2028-01-03", "2028-01-04"))
            .toThrow(UnsupportedKoreanHolidayYearError);
    });
});

describe("KR_HOLIDAYS fixtures", () => {
    it("contains the 2026/2027 Korean public holidays used by both apps", () => {
        expect(KR_HOLIDAYS.has("2026-01-01")).toBe(true); // New Year's Day
        expect(KR_HOLIDAYS.has("2026-07-17")).toBe(true); // Constitution Day (P0-3 fixture date)
        expect(KR_HOLIDAYS.has("2026-06-03")).toBe(true); // local elections
        expect(KR_HOLIDAYS.has("2027-12-25")).toBe(true); // Christmas
        expect(KR_HOLIDAYS.size).toBe(44);
    });

    it("does not flag an ordinary weekday as a holiday", () => {
        expect(KR_HOLIDAYS.has("2026-07-16")).toBe(false);
    });
});

describe("isBusinessDayKr", () => {
    it("treats weekends as non-business days", () => {
        expect(isBusinessDayKr("2026-07-18")).toBe(false); // Saturday
        expect(isBusinessDayKr("2026-07-19")).toBe(false); // Sunday
    });

    it("treats a Korean holiday (P0-3 fixture) as a non-business day even on a weekday", () => {
        expect(isBusinessDayKr("2026-07-17")).toBe(false); // Constitution Day, Friday
    });

    it("treats an ordinary weekday as a business day", () => {
        expect(isBusinessDayKr("2026-07-16")).toBe(true);
    });

    it("returns false for an empty input", () => {
        expect(isBusinessDayKr("")).toBe(false);
    });
});

describe("Korean business-day helpers", () => {
    it("counts the start date as the first service day when it is a business day", () => {
        expect(calcEndDateBusinessDays("2026-01-05", 1)).toBe("2026-01-05");
    });

    it("skips weekends when calculating the service end date", () => {
        expect(calcEndDateBusinessDays("2026-01-02", 2)).toBe("2026-01-05");
    });

    it("starts counting from the next business day when the start date is a holiday", () => {
        expect(calcEndDateBusinessDays("2026-01-01", 1)).toBe("2026-01-02");
    });

    it("skips Korean holidays from the shared source-of-truth list", () => {
        expect(isBusinessDayKr("2026-06-03")).toBe(false);
        expect(calcEndDateBusinessDays("2026-06-02", 2)).toBe("2026-06-04");
    });

    it("returns an empty string for invalid inputs", () => {
        expect(calcEndDateBusinessDays("", 10)).toBe("");
        expect(calcEndDateBusinessDays("260602", 10)).toBe("");
        expect(calcEndDateBusinessDays("2026-06-02", 0)).toBe("");
    });

    it("counts business-day distance while skipping weekends and holidays", () => {
        expect(diffBusinessDaysKr("2026-07-08", "2026-07-07")).toBe(1);
        expect(diffBusinessDaysKr("2026-07-06", "2026-07-07")).toBe(-1);
        expect(diffBusinessDaysKr("2026-07-20", "2026-07-07")).toBe(8);
        expect(diffBusinessDaysKr("2026-06-04", "2026-06-02")).toBe(1);
    });
});

describe("nextBusinessDayKr / addBusinessDaysKr", () => {
    it("returns the next business day, skipping a holiday-then-weekend run", () => {
        // 2026-08-15 (Sat, Liberation Day) is already a weekend; the
        // substitute holiday lands on 2026-08-17 (Mon).
        expect(nextBusinessDayKr("2026-08-14")).toBe("2026-08-18");
    });

    it("adds N business days, skipping weekends and holidays", () => {
        // 2026-07-16 (Thu) -> 2026-07-17 (Fri, Constitution Day holiday) and
        // the weekend are skipped, landing on 2026-07-20 (Mon).
        expect(addBusinessDaysKr("2026-07-16", 1)).toBe("2026-07-20");
    });

    it("returns the input unchanged for a non-positive count", () => {
        expect(addBusinessDaysKr("2026-07-16", 0)).toBe("2026-07-16");
    });

    it("does not bypass the calendar for an unsupported zero-step date", () => {
        expect(() => addBusinessDaysKr("2028-01-03", 0))
            .toThrow(UnsupportedKoreanHolidayYearError);
    });
});
