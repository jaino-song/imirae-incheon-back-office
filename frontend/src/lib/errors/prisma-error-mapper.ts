import { t, Locale } from '@/lib/i18n/translations';

/**
 * Backend Prisma error response structure
 * (No user-facing message - frontend handles localization)
 */
interface PrismaErrorResponse {
    statusCode: number;
    code: string;      // Prisma error code (P2002, P2003, etc.)
    error: string;     // HTTP error type (Conflict, Bad Request, etc.)
    field?: string;    // Affected field name
}

/**
 * Extract error response from Axios error or any error object
 */
export function extractApiError(error: unknown): unknown {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const axiosError = error as {
        response?: { data?: unknown };
        data?: unknown;
    };

    // Axios error structure: error.response.data
    if (axiosError.response?.data) {
        return axiosError.response.data;
    }

    // Direct data property (from TanStack Query error)
    if (axiosError.data) {
        return axiosError.data;
    }

    // If error itself has code property, it might be the error response
    if ('code' in error) {
        return error;
    }

    return null;
}

/**
 * Type guard to check if error is a Prisma error response
 */
function isPrismaErrorResponse(error: unknown): error is PrismaErrorResponse {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as PrismaErrorResponse).code === 'string' &&
        (error as PrismaErrorResponse).code.startsWith('P')
    );
}

/**
 * Map Prisma error code to user-friendly message using i18n
 *
 * @param error - The extracted API error object
 * @param locale - Current locale ('ko' | 'en')
 * @returns User-friendly error message, or null if not a Prisma error
 *
 * @example
 * const apiError = extractApiError(error);
 * const message = mapPrismaError(apiError, locale) || t(locale, 'errors.generic');
 */
export function mapPrismaError(error: unknown, locale: Locale): string | null {
    if (!isPrismaErrorResponse(error)) {
        return null;
    }

    const { code, field } = error;

    // Try field-specific translation first (e.g., errors.prisma.P2002.phone)
    if (field) {
        const fieldSpecificKey = `errors.prisma.${code}.${field}`;
        const fieldSpecificMsg = t(locale, fieldSpecificKey);
        if (fieldSpecificMsg !== fieldSpecificKey) {
            return fieldSpecificMsg;
        }
    }

    // Fall back to generic error with field interpolation
    const baseKey = `errors.prisma.${code}`;
    let message = t(locale, baseKey);

    // If key not found, use unknown error message
    if (message === baseKey) {
        return t(locale, 'errors.prisma.unknown');
    }

    // Interpolate field name if present
    if (field && message.includes('{field}')) {
        const fieldLabelKey = `errors.fields.${field}`;
        const fieldLabel = t(locale, fieldLabelKey);
        // Use translated field name if available, otherwise use raw field name
        const displayField = fieldLabel !== fieldLabelKey ? fieldLabel : field;
        message = message.replace('{field}', displayField);
    }

    return message;
}

/**
 * Bare HTTP status names and this app's own proxy placeholder. A backend that
 * only gives us one of these has told the operator nothing, so the localized
 * fallback is the better message.
 */
const UNINFORMATIVE_MESSAGES = new Set([
    'bad request',
    'unauthorized',
    'payment required',
    'forbidden',
    'not found',
    'method not allowed',
    'conflict',
    'gone',
    'unprocessable entity',
    'too many requests',
    'internal server error',
    'not implemented',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
]);

function isUninformative(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return UNINFORMATIVE_MESSAGES.has(normalized) || normalized.startsWith('failed to ');
}

/**
 * Read the response body only. Surfacing an Error's own `message` would leak
 * transport strings ("Network Error") that mean nothing to an operator.
 */
function getResponsePayload(error: unknown): { error?: unknown; message?: unknown } | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const candidate = error as { response?: { data?: unknown }; data?: unknown };
    const data = candidate.response?.data ?? candidate.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }

    return data as { error?: unknown; message?: unknown };
}

/**
 * Pull the backend's own explanation out of an API error response. Nest puts it
 * in `message`; the Next proxy flattens that into `error` before it reaches the
 * browser, so both are read, `message` first.
 *
 * @returns The backend's message, or null when it carries no usable text
 */
export function getApiDisplayMessage(error: unknown): string | null {
    const payload = getResponsePayload(error);
    if (!payload) {
        return null;
    }

    for (const candidate of [payload.message, payload.error]) {
        const text = Array.isArray(candidate)
            ? candidate.filter((entry): entry is string => typeof entry === 'string').join(', ')
            : candidate;
        if (typeof text === 'string' && text.trim() && !isUninformative(text)) {
            return text.trim();
        }
    }

    return null;
}

/**
 * Get error message from any error type, with Prisma error handling
 * Falls back to the backend's own message, then to a generic localized message
 */
export function getErrorMessage(
    error: unknown,
    locale: Locale,
    fallbackKey: string = 'errors.generic'
): string {
    const apiError = extractApiError(error);
    return mapPrismaError(apiError, locale)
        || getApiDisplayMessage(error)
        || t(locale, fallbackKey);
}
