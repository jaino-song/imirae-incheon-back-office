export class EformsignApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly vendorCode?: string,
    ) {
        super(message);
        this.name = EformsignApiError.name;
    }
}

const EFORMSIGN_ABSENT_DOCUMENT_CODES = new Set([
    "4000004", // documented as "No document"
    "4000006", // returned by document detail after the document was deleted
]);

export function isEformsignDocumentAbsentError(
    error: unknown,
): error is EformsignApiError {
    return error instanceof EformsignApiError
        && (
            error.status === 404
            || (
                error.status === 400
                && error.vendorCode !== undefined
                && EFORMSIGN_ABSENT_DOCUMENT_CODES.has(error.vendorCode)
            )
        );
}

/**
 * eformsign returns its application error code at the top level for JSON
 * responses, but some legacy endpoints return a text body. Keep extraction at
 * the shared error boundary so every vendor caller preserves the same signal.
 */
export function extractEformsignVendorCode(errorBody: string): string | undefined {
    try {
        const parsed = JSON.parse(errorBody) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
            const record = parsed as Record<string, unknown>;
            const code = record["code"] ?? record["error_code"];
            if (typeof code === "string" && /^\d{4,8}$/.test(code.trim())) {
                return code.trim();
            }
            if (typeof code === "number" && Number.isInteger(code)) {
                return String(code);
            }
        }
    } catch {
        // Fall through to the explicitly named code format below.
    }

    return errorBody.match(
        /["']?(?:code|error_code)["']?\s*[:=]\s*["']?(\d{4,8})["']?/i,
    )?.[1];
}
