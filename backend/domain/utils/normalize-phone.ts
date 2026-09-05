/**
 * Normalize a Korean phone number to its canonical key representation.
 *
 * The canonical key is deliberately separate from the display value that is
 * stored in `phone`: writers may preserve the formatting a user supplied while
 * all identity and uniqueness checks use this value. Returns null when the
 * input cannot plausibly be a Korean phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;

    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("82")) {
        digits = `0${digits.slice(2)}`;
    }

    // KR numbers: 02-XXXXXXXX (9-10) or 0XX-XXXX-XXXX (10-11).
    if (digits.length < 9 || digits.length > 11 || !digits.startsWith("0")) {
        return null;
    }

    return digits;
}

/**
 * Raised when a write path receives a present phone value that cannot be
 * represented by the canonical identity key.  Read/reconstitution paths may
 * still encounter legacy rows, but every new or changed identity must pass
 * this guard before persistence or provider work.
 */
/**
 * The single wording for "this phone is not a domestic number". Every write
 * path that rejects one surfaces it to an operator, so it lives beside the
 * error that raises it rather than being re-typed per service.
 */
export const INVALID_PHONE_MESSAGE = "연락처가 올바른 국내 전화번호 형식이 아닙니다.";

/** Same rejection, named for the specific contract field that carried it. */
export function invalidPhoneFieldMessage(field: string): string {
    return `${field} 항목이 올바른 국내 전화번호 형식이 아닙니다.`;
}

export class InvalidPhoneError extends Error {
    readonly code = "INVALID_PHONE" as const;

    constructor() {
        super(INVALID_PHONE_MESSAGE);
        this.name = "InvalidPhoneError";
    }
}

/**
 * Validate an optional client phone while preserving the caller's display
 * formatting. Explicit null/undefined means "no phone" and remains allowed;
 * an empty or malformed string is never silently converted to null.
 */
export function assertValidPhone(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new InvalidPhoneError();
    }

    const normalized = normalizePhone(raw);
    if (normalized === null) throw new InvalidPhoneError();
    return normalized;
}

/** Validate a required employee/provider phone and return its canonical key. */
export function assertRequiredPhone(raw: string | null | undefined): string {
    const normalized = assertValidPhone(raw);
    if (normalized === null) throw new InvalidPhoneError();
    return normalized;
}

/** Pull every plausible phone number out of free text (e.g. a recording file name). */
export function extractPhoneCandidates(text: string | null | undefined): string[] {
    if (!text) return [];

    const matches = text.match(/(\+?82[-\s.]?|0)1[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g) ?? [];
    const seen = new Set<string>();
    for (const match of matches) {
        const normalized = normalizePhone(match);
        if (normalized) seen.add(normalized);
    }
    return [...seen];
}
