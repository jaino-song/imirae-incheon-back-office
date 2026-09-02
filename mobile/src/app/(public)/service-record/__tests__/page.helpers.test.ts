import {
    getServiceDateShiftBusinessDays,
    isDayButtonDisabled,
    isServiceDateMismatch,
} from "@/lib/service-records/page-helpers";

describe("isServiceDateMismatch", () => {
    it("detects when the service date differs from today", () => {
        expect(isServiceDateMismatch("2026-07-14", "2026-07-15")).toBe(true);
    });

    it("does not flag today's service date", () => {
        expect(isServiceDateMismatch("2026-07-15", "2026-07-15")).toBe(false);
    });
});

describe("isDayButtonDisabled", () => {
    it("keeps a completed day clickable before record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: false })).toBe(false);
    });

    it("disables every day after record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: true })).toBe(true);
        expect(isDayButtonDisabled({ done: false, open: true, isRecordFinalized: true })).toBe(true);
    });
});

describe("getServiceDateShiftBusinessDays", () => {
    it("counts a two-business-day shift", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-28")).toBe(2);
    });

    it("counts a one-business-day shift", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-27")).toBe(1);
    });

    it("returns zero for the same date", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-26")).toBe(0);
    });

    it("counts a one-business-day shift across a weekend", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-28", "2026-08-31")).toBe(1);
    });

    it("returns null when the target date falls in an unsupported holiday-calendar year", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2030-07-15")).toBeNull();
    });

    it("returns null for an invalid ISO date", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "not-a-date")).toBeNull();
    });
});
