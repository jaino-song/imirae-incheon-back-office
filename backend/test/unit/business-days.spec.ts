import {
    addBusinessDaysKr,
    countBusinessDaysKr,
    diffBusinessDaysKr,
    isBusinessDayKr,
    nextBusinessDayKr,
} from "domain/utils/business-days";

describe("Korean business day utilities", () => {
    describe("nextBusinessDayKr", () => {
        it("should skip a weekend from Friday to Monday", () => {
            expect(nextBusinessDayKr("2026-07-03")).toBe("2026-07-06");
        });

        it("should skip the 2026 Seollal holiday run", () => {
            expect(nextBusinessDayKr("2026-02-13")).toBe("2026-02-19");
        });

        it("should skip Liberation Day and its substitute holiday", () => {
            expect(nextBusinessDayKr("2026-08-14")).toBe("2026-08-18");
        });

        it("should skip New Year's Day and the following weekend across year boundary", () => {
            expect(nextBusinessDayKr("2026-12-31")).toBe("2027-01-04");
        });
    });

    describe("addBusinessDaysKr", () => {
        it("should return the original date for non-positive offsets", () => {
            expect(addBusinessDaysKr("2026-07-03", 0)).toBe("2026-07-03");
            expect(addBusinessDaysKr("2026-07-03", -1)).toBe("2026-07-03");
        });

        it("should add Korean business days", () => {
            expect(addBusinessDaysKr("2026-07-03", 2)).toBe("2026-07-07");
        });
    });

    describe("diffBusinessDaysKr", () => {
        it("should count Korean business days until the target date", () => {
            expect(diffBusinessDaysKr("2026-07-16", "2026-07-13")).toBe(3);
        });

        it("should skip Korean holidays and weekends", () => {
            expect(diffBusinessDaysKr("2026-07-20", "2026-07-13")).toBe(4);
        });

        it("should return zero for the same date", () => {
            expect(diffBusinessDaysKr("2026-07-13", "2026-07-13")).toBe(0);
        });
    });

    describe("countBusinessDaysKr", () => {
        it("should count the inclusive Korean business-day service period", () => {
            expect(countBusinessDaysKr("2026-08-03", "2026-08-10")).toBe(6);
        });

        it("should skip weekends and Korean holidays inside the period", () => {
            expect(countBusinessDaysKr("2026-08-14", "2026-08-18")).toBe(2);
        });

        it("should return null for invalid or reversed periods", () => {
            expect(countBusinessDaysKr("", "2026-08-10")).toBeNull();
            expect(countBusinessDaysKr("2026-08-11", "2026-08-10")).toBeNull();
        });
    });

    describe("isBusinessDayKr", () => {
        it("should identify weekdays, weekends, holidays, and empty input", () => {
            expect(isBusinessDayKr("2026-07-06")).toBe(true);
            expect(isBusinessDayKr("2026-07-04")).toBe(false);
            expect(isBusinessDayKr("2026-02-16")).toBe(false);
            expect(isBusinessDayKr("")).toBe(false);
        });
    });
});
