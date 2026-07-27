import {
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
