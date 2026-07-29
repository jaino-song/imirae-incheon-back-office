const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DOCUMENT_EXPIRY_DAYS = 30;

/**
 * eformsign defines zero remaining days as "no expiry", while expiredDate is NOT NULL.
 * Year 9999 is a fixed ISO sentinel supported by both JavaScript Date and PostgreSQL,
 * and cannot become a rolling accidental expiry. Phase C must recognize this exact
 * value and keep expired=false before applying any expiredDate time comparison.
 */
export const EFORMSIGN_NO_EXPIRY_DATE = "9999-12-31T23:59:59.999Z";

/**
 * Above this, the number is not a day count.
 *
 * eformsign sends `expired_date` two different ways, and nothing in the payload declares
 * which: a small day count while the document can still be signed, and the actual expiry
 * instant in epoch milliseconds once it has expired. Measured on the live company list
 * (2026-07-29): 189 live documents sent `0`, and every one of the 18 that sent a value
 * near 1.7e12 also carried `_expired: true`.
 *
 * Magnitude is the discriminator rather than `_expired`, because `_expired` is absent from
 * some list responses while the ambiguity is not. 1e10 days is 27 million years and 1e10
 * milliseconds is 1970-04-26, so no real value of either kind lands near the boundary.
 */
const EPOCH_MILLISECONDS_THRESHOLD = 1e10;

/** The largest instant a JavaScript Date can hold; beyond it `new Date()` is invalid. */
const MAX_TIME_VALUE = 8.64e15;

/**
 * The moment a document expires, from whichever form eformsign sent.
 *
 * Always returns a valid Date. It used to be possible for it not to: reading an epoch as a
 * day count multiplies it past `MAX_TIME_VALUE`, and the resulting Invalid Date failed
 * entity validation, which the backfill then reported as an unmirrorable document. Both
 * halves of that history were half-right — reading every value as an epoch stored 1970 for
 * live documents, reading every value as days broke the expired ones.
 */
export function eformsignExpiryDateFromRemainingDays(
    remainingDays: number | null | undefined,
    referenceTime: number,
): Date {
    if (remainingDays === 0) {
        return new Date(EFORMSIGN_NO_EXPIRY_DATE);
    }

    if (
        typeof remainingDays === "number"
        && Number.isFinite(remainingDays)
        && remainingDays >= EPOCH_MILLISECONDS_THRESHOLD
    ) {
        // Already an instant.
        return boundedDate(remainingDays, referenceTime);
    }

    const expiryDays = typeof remainingDays === "number"
        && Number.isInteger(remainingDays)
        && remainingDays > 0
        ? remainingDays
        : DEFAULT_DOCUMENT_EXPIRY_DAYS;

    // A day count under the epoch threshold can still overflow once multiplied — anything
    // past 1e8 days does — so this branch needs the same bound as the instant one.
    return boundedDate(referenceTime + expiryDays * MILLISECONDS_PER_DAY, referenceTime);
}

/**
 * The single place the "always a valid Date" guarantee is enforced, so neither branch above
 * can quietly stop honouring it. A value a Date cannot hold is not a date at all; it falls
 * back to the default window, and if even that is unusable the caller gets the no-expiry
 * sentinel rather than a value that fails entity validation and drops the document.
 */
function boundedDate(timeValue: number, referenceTime: number): Date {
    if (Number.isFinite(timeValue) && Math.abs(timeValue) <= MAX_TIME_VALUE) {
        return new Date(timeValue);
    }

    const fallback = referenceTime + DEFAULT_DOCUMENT_EXPIRY_DAYS * MILLISECONDS_PER_DAY;
    return Number.isFinite(fallback) && Math.abs(fallback) <= MAX_TIME_VALUE
        ? new Date(fallback)
        : new Date(EFORMSIGN_NO_EXPIRY_DATE);
}
