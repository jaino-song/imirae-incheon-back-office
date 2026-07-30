const MAX_EFORMSIGN_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Keeps operator-visible sync failures useful without copying credentials or
 * customer phone numbers into logs, readiness records, or CI output.
 */
export function sanitizeEformsignErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(
            /\b(postgres(?:ql)?|redis(?:s)?):\/\/[^@\s/]+@/gi,
            "$1://[REDACTED]@",
        )
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(
            /(["']?(?:access[_-]?token|refresh[_-]?token|oauth[_-]?token|external[_-]?token|outside[_-]?token|download[_-]?token|signature[_-]?token|api[_-]?key|client[_-]?secret|password|secret)["']?\s*[:=]\s*)["']?[^"'\s,;}&]+["']?/gi,
            "$1[REDACTED]",
        )
        .replace(
            /(?<![\w+.])\+82[\s.-]?(?:10|[2-9]\d?)[\s.-]?\d{3,4}[\s.-]?\d{4}(?![\w.])/g,
            "[REDACTED_PHONE]",
        )
        .replace(
            /(?<![\w.])0\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}(?![\w.])/g,
            "[REDACTED_PHONE]",
        )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_EFORMSIGN_ERROR_MESSAGE_LENGTH);
}
