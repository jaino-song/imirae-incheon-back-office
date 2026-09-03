import {
    atKstHour,
    getServiceRecordFinalizationDueAt,
    getServiceRecordLinkScheduledFor,
    getServiceRecordTokenExpiresAt,
    SERVICE_RECORD_LINK_GRACE_DAYS,
} from "domain/constants/service-record-link-message";

/**
 * Pins the storage contract documented in
 * backend/domain/constants/service-record-link-message.ts:9-13 and
 * docs/conventions/date-handling.md (P2-9):
 *
 *   `@db.Date` columns (e.g. employee_schedule.startDate / endDate) round-trip
 *   through Prisma as a UTC-midnight `Date` (`T00:00:00.000Z`) representing a
 *   pure calendar day with no time-of-day component. `atKstHour` depends on
 *   this: it extracts the calendar day via `date.toISOString().slice(0, 10)`,
 *   which is only correct when the incoming `Date` IS that UTC-midnight
 *   instant.
 *
 * This backend has no disposable-DB integration harness to round-trip a real
 * `@db.Date` column through Prisma: `backend/test/integration/*` mock the
 * service layer (see employee-schedule.controller.integration.spec.ts), and
 * `backend/test/e2e/*` requires a live DB/env and is excluded from the
 * default `jest` run via `testPathIgnorePatterns` in jest.config.ts. So the
 * contract is pinned here at the unit level: the "happy path" tests assert
 * behavior against UTC-midnight input (what `@db.Date` actually returns),
 * and the "regression guard" tests assert what goes wrong when that
 * assumption is violated, so a future change that breaks the assumption
 * elsewhere in the pipeline (e.g. feeding a TIMESTAMPTZ or a locally
 * constructed Date into these functions) has a test that explains why the
 * result would be wrong instead of silently shifting a day.
 */
describe("service-record-link-message date contract (P2-9)", () => {
    describe("atKstHour — given a UTC-midnight Date (the @db.Date round-trip contract)", () => {
        it("extracts the same calendar day and returns the KST wall-clock instant", () => {
            const utcMidnight = new Date("2025-06-15T00:00:00.000Z");

            const result = atKstHour(utcMidnight, 15);

            // 2025-06-15T15:00:00+09:00 === 2025-06-15T06:00:00.000Z
            expect(result.toISOString()).toBe("2025-06-15T06:00:00.000Z");
        });

        it("preserves the calendar day across a year boundary", () => {
            const utcMidnight = new Date("2025-12-31T00:00:00.000Z");

            const result = atKstHour(utcMidnight, 20);

            expect(result.toISOString()).toBe("2025-12-31T11:00:00.000Z");
        });
    });

    describe("atKstHour — given a non-UTC-midnight Date (contract violation)", () => {
        it("REGRESSION GUARD: a Date whose time-of-day has already crossed into the next KST calendar day is read back as the PREVIOUS (wrong) day", () => {
            // 2025-06-15T18:00:00.000Z is 2025-06-16T03:00:00+09:00 in KST —
            // the calendar day this instant actually falls on, in KST, is the
            // 16th. But atKstHour naively reads `.toISOString().slice(0, 10)`
            // (the UTC calendar day) and gets "2025-06-15": one day EARLIER
            // than the true KST day. This is the failure mode atKstHour is
            // exposed to if it is ever fed a raw TIMESTAMPTZ value (or
            // anything but a UTC-midnight @db.Date) instead of a pure
            // calendar-day Date.
            const nonMidnight = new Date("2025-06-15T18:00:00.000Z");

            const trueKstCalendarDay = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Seoul",
            }).format(nonMidnight);
            expect(trueKstCalendarDay).toBe("2025-06-16");

            const result = atKstHour(nonMidnight, 15);

            // Computed off the UTC calendar day, not the true KST day above.
            expect(result.toISOString()).toBe("2025-06-15T06:00:00.000Z");
            expect(result.toISOString().slice(0, 10)).not.toBe(trueKstCalendarDay);
        });

        it("REGRESSION GUARD: a Date representing KST-local midnight (instead of UTC midnight) is read back as the PREVIOUS calendar day", () => {
            // A common mistake: constructing "midnight on 2025-06-15" as KST
            // local time (`2025-06-15T00:00:00+09:00`) rather than as UTC
            // midnight (`2025-06-15T00:00:00.000Z`). The KST-local instant is
            // actually 2025-06-14T15:00:00.000Z in UTC, so atKstHour reads
            // the calendar day back as "2025-06-14" — one day EARLIER than
            // the 15th the caller intended.
            const kstLocalMidnight = new Date("2025-06-15T00:00:00+09:00");
            expect(kstLocalMidnight.toISOString()).toBe("2025-06-14T15:00:00.000Z");

            const result = atKstHour(kstLocalMidnight, 15);

            expect(result.toISOString()).toBe("2025-06-14T06:00:00.000Z");
        });
    });

    describe("getServiceRecordLinkScheduledFor", () => {
        it("schedules the 제공기록지 링크 SMS at 15:00 KST on the @db.Date-sourced startDate's calendar day", () => {
            const startDate = new Date("2025-06-15T00:00:00.000Z");

            const result = getServiceRecordLinkScheduledFor(startDate);

            expect(result.toISOString()).toBe("2025-06-15T06:00:00.000Z");
        });
    });

    describe("getServiceRecordFinalizationDueAt", () => {
        it("is due at 20:00 KST on the @db.Date-sourced endDate's calendar day (unaffected by the link's grace period)", () => {
            const endDate = new Date("2026-09-02T00:00:00.000Z");

            const result = getServiceRecordFinalizationDueAt(endDate);

            expect(result.toISOString()).toBe("2026-09-02T11:00:00.000Z");
        });
    });

    describe("getServiceRecordTokenExpiresAt", () => {
        it(`expires the access token ${SERVICE_RECORD_LINK_GRACE_DAYS} calendar days after the @db.Date-sourced endDate, at 20:00 KST`, () => {
            const endDate = new Date("2026-09-02T00:00:00.000Z");

            const result = getServiceRecordTokenExpiresAt(endDate);

            // endDate + 7 calendar days = 2026-09-09, at 20:00 KST
            expect(result.toISOString()).toBe("2026-09-09T11:00:00.000Z");
        });

        it("rolls over the calendar month when the +7-day grace period crosses a month boundary", () => {
            const endDate = new Date("2026-08-28T00:00:00.000Z");

            const result = getServiceRecordTokenExpiresAt(endDate);

            // 2026-08-28 + 7 calendar days = 2026-09-04, at 20:00 KST
            expect(result.toISOString()).toBe("2026-09-04T11:00:00.000Z");
        });
    });
});
