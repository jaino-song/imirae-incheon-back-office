const HTTPS_PROTOCOL = "https:";

function parseHttpsUrl(value: string | undefined, label: string): URL {
    const trimmed = value?.trim();
    if (!trimmed) throw new Error(`${label} is required`);

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`${label} must be a valid HTTPS URL`);
    }
    if (parsed.protocol !== HTTPS_PROTOCOL) throw new Error(`${label} must use HTTPS`);
    if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials`);
    return parsed;
}

/**
 * Validate the protected preview target before any secret-bearing request is
 * made. The allowlist is supplied by the protected GitHub environment, not by
 * workflow-dispatch input.
 */
export function validateEvaluationBaseUrl(
    baseUrl: string | undefined,
    allowedOrigin: string | undefined,
): string {
    const candidate = parseHttpsUrl(baseUrl, "Agent evaluation base URL");
    const allowlisted = parseHttpsUrl(allowedOrigin, "Agent evaluation allowed origin");
    if (allowlisted.pathname !== "/" || allowlisted.search || allowlisted.hash) {
        throw new Error("Agent evaluation allowed origin must contain only an HTTPS origin");
    }
    if (candidate.search || candidate.hash) {
        throw new Error("Agent evaluation base URL must not contain a query or fragment");
    }
    if (candidate.origin !== allowlisted.origin) {
        throw new Error("Agent evaluation base URL is outside the protected allowlist");
    }
    return candidate.toString().replace(/\/$/, "");
}

/** Validate a non-preview evaluation endpoint without logging its value. */
export function validateEvaluationEndpoint(value: string | undefined, label: string): string {
    const parsed = parseHttpsUrl(value, label);
    if (parsed.search || parsed.hash) throw new Error(`${label} must not contain a query or fragment`);
    return parsed.toString().replace(/\/$/, "");
}

/**
 * Force undici/fetch to fail on redirects. This prevents bearer tokens from
 * being sent to an unvalidated redirect target.
 */
export function withEvaluationFetchPolicy(init: RequestInit = {}): RequestInit {
    if (init.redirect !== undefined && init.redirect !== "error") {
        throw new Error("Agent evaluation requests must reject redirects");
    }
    return { ...init, redirect: "error" };
}
