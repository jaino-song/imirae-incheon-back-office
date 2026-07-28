const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DOCUMENT_EXPIRY_DAYS = 30;

/**
 * eformsign defines zero remaining days as "no expiry", while expiredDate is NOT NULL.
 * Year 9999 is a fixed ISO sentinel supported by both JavaScript Date and PostgreSQL,
 * and cannot become a rolling accidental expiry. Phase C must recognize this exact
 * value and keep expired=false before applying any expiredDate time comparison.
 */
export const EFORMSIGN_NO_EXPIRY_DATE = "9999-12-31T23:59:59.999Z";

export function eformsignExpiryDateFromRemainingDays(
    remainingDays: number | null | undefined,
    referenceTime: number,
): Date {
    if (remainingDays === 0) {
        return new Date(EFORMSIGN_NO_EXPIRY_DATE);
    }

    const expiryDays = typeof remainingDays === "number"
        && Number.isInteger(remainingDays)
        && remainingDays > 0
        ? remainingDays
        : DEFAULT_DOCUMENT_EXPIRY_DAYS;

    return new Date(referenceTime + expiryDays * MILLISECONDS_PER_DAY);
}
