import { BackfillEformsignDocsError } from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";

/**
 * Backfill failures are wrapped at the document, scan, and run boundaries.
 * Preserve those boundaries for operators while applying the same credential and
 * customer-data redaction used by every other eformsign failure log.
 */
export function describeEformsignBackfillError(error: unknown): string {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    const visit = (value: unknown): void => {
        if (value === undefined || value === null || seen.has(value)) {
            return;
        }
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        messages.push(sanitizeEformsignErrorMessage(value));
        if (value instanceof BackfillEformsignDocsError) {
            visit(value.cause);
        }
    };

    visit(error);
    return messages.join(" <- ") || sanitizeEformsignErrorMessage(error);
}
