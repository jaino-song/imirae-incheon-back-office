import { getExpectedSessionDateFromRecords } from "./service-record-schedule";

describe("getExpectedSessionDateFromRecords", () => {
    it("falls back to the N-th business day from start when no records exist", () => {
        expect(getExpectedSessionDateFromRecords("2026-01-05", 1, [])).toBe("2026-01-05");
        expect(getExpectedSessionDateFromRecords("2026-01-02", 2, [])).toBe("2026-01-05");
    });

    it("chains an unwritten slot's expected date from the last written session's actual date", () => {
        const records = Array.from({ length: 13 }, (_, i) => {
            const sessionIndex = i + 1;
            if (sessionIndex === 12) return { sessionIndex, serviceDate: "2026-08-28" };
            if (sessionIndex === 13) return { sessionIndex, serviceDate: "2026-08-31" };
            return { sessionIndex, serviceDate: "2026-08-01" };
        });

        expect(getExpectedSessionDateFromRecords("2026-08-01", 14, records)).toBe("2026-09-01");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 15, records)).toBe("2026-09-02");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 18, records)).toBe("2026-09-07");
    });

    it("chains from the closest preceding written record across a gap", () => {
        const records = [
            { sessionIndex: 1, serviceDate: "2026-07-16" },
            { sessionIndex: 3, serviceDate: "2026-07-20" },
        ];

        // Slot 2 has no record at index 2, so it chains from record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 2, records)).toBe("2026-07-20");
        // Slot 4 chains from the closer record 3, not record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 4, records)).toBe("2026-07-21");
    });

    it("returns null when there is no start date and no preceding record", () => {
        expect(getExpectedSessionDateFromRecords(null, 1, [])).toBeNull();
    });
});
