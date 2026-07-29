import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";

describe("eformsignExpiryDateFromRemainingDays", () => {
    const referenceTime = Date.parse("2026-07-03T00:00:00.000Z");

    it("uses a fixed non-expiring sentinel when remaining days is zero", () => {
        expect(eformsignExpiryDateFromRemainingDays(0, referenceTime)).toEqual(
            new Date("9999-12-31T23:59:59.999Z"),
        );
    });

    it("keeps the 30-day fallback when remaining days is omitted", () => {
        expect(eformsignExpiryDateFromRemainingDays(undefined, referenceTime)).toEqual(
            new Date(referenceTime + 30 * 24 * 60 * 60 * 1000),
        );
    });

    it("converts positive remaining days from the supplied reference time", () => {
        expect(eformsignExpiryDateFromRemainingDays(3, referenceTime)).toEqual(
            new Date(referenceTime + 3 * 24 * 60 * 60 * 1000),
        );
    });

    it("reads an expired document's value as the instant it already is", () => {
        // Measured on the live company list: every document eformsign reported as expired
        // sent its expiry as epoch milliseconds instead of a day count, with nothing in the
        // payload to say so. Multiplying one of these by a day overflowed Date, and the
        // backfill reported those documents as unmirrorable.
        expect(eformsignExpiryDateFromRemainingDays(1749524449968, referenceTime)).toEqual(
            new Date(1749524449968),
        );
    });

    it.each([
        ["an instant past the end of time", 1e17],
        // Under the epoch threshold, so it takes the day-count branch — but 1e8 days is
        // already past what a Date can hold once multiplied out. Both branches need the
        // same bound; only the instant one had it at first.
        ["a day count that overflows once multiplied", 100_000_000],
    ])("falls back rather than returning a Date that cannot hold %s", (_label, value) => {
        // A caller storing an invalid Date fails entity validation, and the document is
        // dropped from the mirror — the outcome this whole discrimination exists to avoid.
        const result = eformsignExpiryDateFromRemainingDays(value, referenceTime);

        expect(Number.isNaN(result.getTime())).toBe(false);
        expect(result).toEqual(new Date(referenceTime + 30 * 24 * 60 * 60 * 1000));
    });

    it("still treats a plausible day count as days, not as an instant", () => {
        // 9999 days is ~27 years out; an epoch this small would be 1970-01-01T00:00:09Z.
        // The boundary has to leave real day counts on the day-count side.
        expect(eformsignExpiryDateFromRemainingDays(9999, referenceTime)).toEqual(
            new Date(referenceTime + 9999 * 24 * 60 * 60 * 1000),
        );
    });
});
