const API_ORIGIN = "https://api.vercel.com";
const DOMAIN = "babyjamjam.com";
const RECORD_NAME = "api";
const RECORD_TYPE = "A";
const EXPECTED_TTL = 60;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RECORD_PAGES = 10;
const LIST_LIMIT = 100;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const CONFIG_KEYS = new Set([
    "token",
    "vercelToken",
    "teamId",
    "recordId",
    "primaryIpv4",
    "fallbackIpv4",
    "baseUrl",
    "timeoutMs",
    "fetch",
    "clock",
]);

const ErrorCode = Object.freeze({
    CONFIG_INVALID: "CONFIG_INVALID",
    IP_INVALID: "IP_INVALID",
    IP_NOT_PUBLIC: "IP_NOT_PUBLIC",
    HTTP_ERROR: "HTTP_ERROR",
    NETWORK_ERROR: "NETWORK_ERROR",
    TIMEOUT: "TIMEOUT",
    RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
    RESPONSE_INVALID: "RESPONSE_INVALID",
    RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
    RECORD_AMBIGUOUS: "RECORD_AMBIGUOUS",
    DNS_DRIFT: "DNS_DRIFT",
    MANUAL_CHECK: "MANUAL_CHECK",
});

class VercelDnsClientError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "VercelDnsClientError";
        this.code = code;
        this.blocked = options.blocked === true;
        this.ambiguous = options.ambiguous === true;
        if (Number.isInteger(options.status)) {
            this.status = options.status;
        }
    }
}

class ManualCheckError extends VercelDnsClientError {
    constructor() {
        super(
            ErrorCode.MANUAL_CHECK,
            "Vercel DNS update requires manual reconciliation.",
            { blocked: true, ambiguous: true },
        );
        this.name = "ManualCheckError";
    }
}

export { ErrorCode, ManualCheckError, VercelDnsClientError };

function failConfig() {
    throw new VercelDnsClientError(
        ErrorCode.CONFIG_INVALID,
        "Invalid Vercel DNS client configuration.",
        { blocked: true },
    );
}

function assertKnownConfigKeys(config) {
    for (const key of Object.keys(config)) {
        if (!CONFIG_KEYS.has(key)) {
            failConfig();
        }
    }
}

function assertNonEmptyString(value) {
    return typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateToken(config) {
    const hasToken = Object.prototype.hasOwnProperty.call(config, "token");
    const hasVercelToken = Object.prototype.hasOwnProperty.call(config, "vercelToken");
    if (hasToken && hasVercelToken) {
        failConfig();
    }
    const token = hasToken ? config.token : config.vercelToken;
    if (!assertNonEmptyString(token) || token.length > 4096) {
        failConfig();
    }
    return token;
}

function validateIdentifier(value, pattern) {
    return typeof value === "string" && pattern.test(value);
}

function parseIpv4(value) {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(value)) {
        throw new VercelDnsClientError(ErrorCode.IP_INVALID, "Invalid IPv4 configuration.", { blocked: true });
    }
    const octets = value.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) {
        throw new VercelDnsClientError(ErrorCode.IP_INVALID, "Invalid IPv4 configuration.", { blocked: true });
    }
    return octets;
}

function isPublicIpv4(octets) {
    const [first, second] = octets;
    if (first === 0 || first === 10 || first === 127 || first >= 224) {
        return false;
    }
    if (first === 100 && second >= 64 && second <= 127) {
        return false;
    }
    if (first === 169 && second === 254) {
        return false;
    }
    if (first === 172 && second >= 16 && second <= 31) {
        return false;
    }
    if (first === 192 && (second === 0 || second === 168)) {
        return false;
    }
    if (first === 192 && second === 2) {
        return false;
    }
    if (first === 192 && second === 88 && octets[2] === 99) {
        return false;
    }
    if (first === 198 && (second === 18 || second === 19 || second === 51)) {
        return false;
    }
    if (first === 203 && second === 0 && octets[2] === 113) {
        return false;
    }
    return true;
}

function validatePublicIpv4(value) {
    const octets = parseIpv4(value);
    if (!isPublicIpv4(octets)) {
        throw new VercelDnsClientError(ErrorCode.IP_NOT_PUBLIC, "IPv4 value must be publicly routable.", { blocked: true });
    }
    return value;
}

function validateApiBaseUrl(value) {
    const candidate = value === undefined ? API_ORIGIN : value;
    if (!assertNonEmptyString(candidate)) {
        failConfig();
    }
    let parsed;
    try {
        parsed = new URL(candidate);
    } catch {
        failConfig();
    }
    if (
        candidate !== API_ORIGIN &&
        candidate !== `${API_ORIGIN}/`
    ) {
        failConfig();
    }
    if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "api.vercel.com" ||
        parsed.port !== "" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        (parsed.pathname !== "" && parsed.pathname !== "/") ||
        parsed.search !== "" ||
        parsed.hash !== ""
    ) {
        failConfig();
    }
    return API_ORIGIN;
}

function validateTimeout(value) {
    const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : value;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        failConfig();
    }
    return timeoutMs;
}

function validateConfig(config) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
        failConfig();
    }
    assertKnownConfigKeys(config);
    const token = validateToken(config);
    if (!validateIdentifier(config.teamId, /^team_[A-Za-z0-9_-]+$/u)) {
        failConfig();
    }
    if (!validateIdentifier(config.recordId, /^rec_[A-Za-z0-9_-]+$/u)) {
        failConfig();
    }
    const primaryIpv4 = validatePublicIpv4(config.primaryIpv4);
    const fallbackIpv4 = validatePublicIpv4(config.fallbackIpv4);
    if (primaryIpv4 === fallbackIpv4) {
        failConfig();
    }
    if (typeof config.fetch !== "undefined" && typeof config.fetch !== "function") {
        failConfig();
    }
    if (typeof config.clock !== "undefined" && typeof config.clock !== "function") {
        failConfig();
    }
    return Object.freeze({
        token,
        teamId: config.teamId,
        recordId: config.recordId,
        primaryIpv4,
        fallbackIpv4,
        baseUrl: validateApiBaseUrl(config.baseUrl),
        timeoutMs: validateTimeout(config.timeoutMs),
        fetchImpl: config.fetch ?? globalThis.fetch,
        clock: config.clock ?? Date.now,
    });
}

function responseHeader(response, name) {
    if (!response?.headers || typeof response.headers.get !== "function") {
        return undefined;
    }
    return response.headers.get(name) ?? undefined;
}

async function readBodyTextBounded(response) {
    const contentLength = responseHeader(response, "content-length");
    if (contentLength !== undefined && /^\d+$/u.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
        throw new VercelDnsClientError(
            ErrorCode.RESPONSE_TOO_LARGE,
            "Vercel DNS response exceeded the safety limit.",
            { blocked: true },
        );
    }
    if (response?.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
                total += chunk.byteLength;
                if (total > MAX_RESPONSE_BYTES) {
                    if (typeof reader.cancel === "function") {
                        await reader.cancel().catch(() => undefined);
                    }
                    throw new VercelDnsClientError(
                        ErrorCode.RESPONSE_TOO_LARGE,
                        "Vercel DNS response exceeded the safety limit.",
                        { blocked: true },
                    );
                }
                chunks.push(chunk);
            }
        } finally {
            if (typeof reader.releaseLock === "function") {
                reader.releaseLock();
            }
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return new TextDecoder().decode(bytes);
    }
    if (typeof response?.text === "function") {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
            throw new VercelDnsClientError(
                ErrorCode.RESPONSE_TOO_LARGE,
                "Vercel DNS response exceeded the safety limit.",
                { blocked: true },
            );
        }
        return text;
    }
    return "";
}

function parseJsonBody(text) {
    if (text.trim() === "") {
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new VercelDnsClientError(
            ErrorCode.RESPONSE_INVALID,
            "Vercel DNS response was not valid JSON.",
            { blocked: true },
        );
    }
}

function assertRecordEnvelope(payload) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.records)) {
        throw new VercelDnsClientError(
            ErrorCode.RESPONSE_INVALID,
            "Vercel DNS response did not match the expected shape.",
            { blocked: true },
        );
    }
    if (payload.pagination !== undefined) {
        if (payload.pagination === null || typeof payload.pagination !== "object" || Array.isArray(payload.pagination)) {
            throw new VercelDnsClientError(
                ErrorCode.RESPONSE_INVALID,
                "Vercel DNS pagination was invalid.",
                { blocked: true },
            );
        }
        if (payload.pagination.next !== undefined && payload.pagination.next !== null && (!Number.isInteger(payload.pagination.next) || payload.pagination.next < 0)) {
            throw new VercelDnsClientError(
                ErrorCode.RESPONSE_INVALID,
                "Vercel DNS pagination was invalid.",
                { blocked: true },
            );
        }
    }
}

function validateRecord(record, config) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
        throw new VercelDnsClientError(ErrorCode.RESPONSE_INVALID, "Vercel DNS record was invalid.", { blocked: true });
    }
    if (
        typeof record.id !== "string" ||
        typeof record.name !== "string" ||
        typeof record.type !== "string" ||
        typeof record.value !== "string" ||
        typeof record.ttl !== "number" ||
        !Number.isInteger(record.ttl)
    ) {
        throw new VercelDnsClientError(ErrorCode.RESPONSE_INVALID, "Vercel DNS record was invalid.", { blocked: true });
    }
    if (record.id !== config.recordId || record.name !== RECORD_NAME || record.type !== RECORD_TYPE || record.ttl !== EXPECTED_TTL) {
        throw new VercelDnsClientError(ErrorCode.DNS_DRIFT, "Vercel DNS record identity drifted.", { blocked: true });
    }
    if (record.value !== config.primaryIpv4 && record.value !== config.fallbackIpv4) {
        throw new VercelDnsClientError(ErrorCode.DNS_DRIFT, "Vercel DNS record value drifted.", { blocked: true });
    }
    return Object.freeze({
        id: record.id,
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl,
    });
}

function isAmbiguous(error) {
    return error instanceof VercelDnsClientError && error.ambiguous === true;
}

export class VercelDnsClient {
    #config;

    constructor(config) {
        this.#config = validateConfig(config);
        if (typeof this.#config.fetchImpl !== "function") {
            failConfig();
        }
    }

    async getCurrentRecord() {
        const records = await this.#listAllRecords();
        const byId = records.filter((record) => record !== null && typeof record === "object" && record.id === this.#config.recordId);
        if (byId.length === 0) {
            throw new VercelDnsClientError(ErrorCode.RECORD_NOT_FOUND, "Configured Vercel DNS record was not found.", { blocked: true });
        }
        if (byId.length !== 1) {
            throw new VercelDnsClientError(ErrorCode.RECORD_AMBIGUOUS, "Configured Vercel DNS record was ambiguous.", { blocked: true });
        }
        const targetRecords = records.filter(
            (record) => record !== null && typeof record === "object" && record.name === RECORD_NAME && record.type === RECORD_TYPE,
        );
        if (targetRecords.length !== 1 || targetRecords[0] !== byId[0]) {
            throw new VercelDnsClientError(ErrorCode.RECORD_AMBIGUOUS, "Vercel DNS target record was ambiguous.", { blocked: true });
        }
        return validateRecord(byId[0], this.#config);
    }

    async readCurrentRecord() {
        return this.getCurrentRecord();
    }

    async switchToFallback() {
        const before = await this.getCurrentRecord();
        if (before.value === this.#config.fallbackIpv4) {
            return Object.freeze({
                changed: false,
                route: "FALLBACK_ACTIVE",
                observedAt: this.#config.clock(),
                record: before,
            });
        }
        if (before.value !== this.#config.primaryIpv4) {
            throw new VercelDnsClientError(ErrorCode.DNS_DRIFT, "Vercel DNS current value is not the approved primary.", { blocked: true });
        }

        let patchSucceeded = false;
        try {
            const updatePath = `/v1/domains/records/${encodeURIComponent(this.#config.recordId)}?teamId=${encodeURIComponent(this.#config.teamId)}`;
            await this.#requestJson(updatePath, {
                method: "PATCH",
                body: JSON.stringify({ value: this.#config.fallbackIpv4 }),
                ambiguousOnFailure: true,
            });
            patchSucceeded = true;
        } catch (error) {
            if (!isAmbiguous(error)) {
                throw error;
            }
            return this.#reconcileAmbiguousPatch();
        }

        if (!patchSucceeded) {
            return this.#reconcileAmbiguousPatch();
        }
        const after = await this.getCurrentRecord();
        if (after.value !== this.#config.fallbackIpv4) {
            throw new VercelDnsClientError(ErrorCode.DNS_DRIFT, "Vercel DNS read-after-write verification failed.", { blocked: true });
        }
        return Object.freeze({
            changed: true,
            route: "FALLBACK_ACTIVE",
            observedAt: this.#config.clock(),
            record: after,
        });
    }

    async failoverToFallback() {
        return this.switchToFallback();
    }

    async #reconcileAmbiguousPatch() {
        try {
            const reconciled = await this.getCurrentRecord();
            if (reconciled.value === this.#config.fallbackIpv4) {
                return Object.freeze({
                    changed: true,
                    reconciled: true,
                    route: "FALLBACK_ACTIVE",
                    observedAt: this.#config.clock(),
                    record: reconciled,
                });
            }
        } catch {
            // An ambiguous provider response plus an unreadable record requires
            // operator reconciliation; never retry the mutation automatically.
        }
        throw new ManualCheckError();
    }

    async #listAllRecords() {
        const records = [];
        const seenCursors = new Set();
        let cursor;
        for (let page = 0; page < MAX_RECORD_PAGES; page += 1) {
            const query = new URLSearchParams();
            query.set("teamId", this.#config.teamId);
            query.set("limit", String(LIST_LIMIT));
            if (cursor !== undefined) {
                query.set("since", String(cursor));
            }
            const payload = await this.#requestJson(`/v5/domains/${DOMAIN}/records?${query.toString()}`, { method: "GET" });
            assertRecordEnvelope(payload);
            records.push(...payload.records);
            const next = payload.pagination?.next ?? null;
            if (next === null) {
                return records;
            }
            if (seenCursors.has(next)) {
                throw new VercelDnsClientError(ErrorCode.RESPONSE_INVALID, "Vercel DNS pagination repeated a cursor.", { blocked: true });
            }
            seenCursors.add(next);
            cursor = next;
        }
        throw new VercelDnsClientError(ErrorCode.RESPONSE_INVALID, "Vercel DNS pagination exceeded the safety limit.", { blocked: true });
    }

    async #requestJson(pathname, options) {
        const url = new URL(pathname, this.#config.baseUrl);
        if (
            url.origin !== API_ORIGIN ||
            url.username !== "" ||
            url.password !== "" ||
            url.protocol !== "https:"
        ) {
            failConfig();
        }
        const headers = new Headers({
            Accept: "application/json",
            Authorization: `Bearer ${this.#config.token}`,
        });
        if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
        }
        const controller = new AbortController();
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                controller.abort();
                reject(new VercelDnsClientError(
                    ErrorCode.TIMEOUT,
                    "Vercel DNS request timed out.",
                    { blocked: true, ambiguous: options.ambiguousOnFailure === true },
                ));
            }, this.#config.timeoutMs);
        });

        let response;
        try {
            const requestPromise = Promise.resolve().then(() => this.#config.fetchImpl(url, {
                method: options.method ?? "GET",
                headers,
                body: options.body,
                signal: controller.signal,
            }));
            response = await Promise.race([requestPromise, timeoutPromise]);
        } catch (error) {
            if (error instanceof VercelDnsClientError) {
                throw error;
            }
            throw new VercelDnsClientError(
                ErrorCode.NETWORK_ERROR,
                "Vercel DNS request failed.",
                { blocked: true, ambiguous: options.ambiguousOnFailure === true },
            );
        } finally {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
        }

        const status = Number(response?.status);
        if (!Number.isInteger(status) || status < 100 || status > 599) {
            throw new VercelDnsClientError(
                ErrorCode.RESPONSE_INVALID,
                "Vercel DNS response status was invalid.",
                { blocked: true, ambiguous: options.ambiguousOnFailure === true },
            );
        }
        let bodyText;
        try {
            bodyText = await readBodyTextBounded(response);
        } catch (error) {
            if (error instanceof VercelDnsClientError) {
                if (options.ambiguousOnFailure === true) {
                    error.ambiguous = true;
                }
                throw error;
            }
            throw new VercelDnsClientError(
                ErrorCode.NETWORK_ERROR,
                "Vercel DNS response could not be read.",
                { blocked: true, ambiguous: options.ambiguousOnFailure === true },
            );
        }
        if (status < 200 || status >= 300) {
            throw new VercelDnsClientError(
                ErrorCode.HTTP_ERROR,
                "Vercel DNS API request was rejected.",
                {
                    status,
                    blocked: true,
                    ambiguous: options.ambiguousOnFailure === true && RETRYABLE_STATUSES.has(status),
                },
            );
        }
        try {
            return parseJsonBody(bodyText);
        } catch (error) {
            if (error instanceof VercelDnsClientError) {
                if (options.ambiguousOnFailure === true) {
                    error.ambiguous = true;
                }
                throw error;
            }
            throw error;
        }
    }
}

export function createVercelDnsClient(config) {
    return new VercelDnsClient(config);
}

export const VercelDnsContract = Object.freeze({
    apiOrigin: API_ORIGIN,
    domain: DOMAIN,
    recordName: RECORD_NAME,
    recordType: RECORD_TYPE,
    ttl: EXPECTED_TTL,
    listPath: "/v5/domains/{domain}/records",
    updatePath: "/v1/domains/records/{recordId}",
});
