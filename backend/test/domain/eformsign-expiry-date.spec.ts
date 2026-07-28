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
});
