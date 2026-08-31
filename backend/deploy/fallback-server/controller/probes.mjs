const PRIMARY_HOST = 'api.babyjamjam.com';
const PRIMARY_PATH = '/health/ready';
const PRIMARY_SCHEME = 'https:';
const PRIMARY_PORT = '443';
const FALLBACK_URL = 'http://127.0.0.1:3101/health/ready';
const FALLBACK_HOST = '127.0.0.1';
const FALLBACK_PATH = '/health/ready';
const FALLBACK_SCHEME = 'http:';
const FALLBACK_PORT = '3101';

export const PRIMARY_READINESS_URL = `https://${PRIMARY_HOST}${PRIMARY_PATH}`;
export const FALLBACK_READINESS_URL = FALLBACK_URL;
export { FALLBACK_URL };
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_MAX_BODY_BYTES = 64 * 1024;
export const PROBE_INTERVAL_MS = 1_000;
export const VERIFICATION_MAX_DURATION_MS = 180_000;
export const REQUIRED_HEALTH_STATUS = 'ok';

export const PROBE_STATUS = Object.freeze({
  OK: 'ok',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

export const PROBE_REASONS = Object.freeze({
  CONFIG_INVALID: 'CONFIG_INVALID',
  FETCH_UNAVAILABLE: 'FETCH_UNAVAILABLE',
  ABORTED: 'ABORTED',
  TIMEOUT: 'TIMEOUT',
  REDIRECT_REJECTED: 'REDIRECT_REJECTED',
  REQUEST_FAILED: 'REQUEST_FAILED',
  HTTP_STATUS_NOT_OK: 'HTTP_STATUS_NOT_OK',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  BODY_MALFORMED: 'BODY_MALFORMED',
  BODY_NOT_EXACT: 'BODY_NOT_EXACT',
  CONTENT_TYPE_NOT_JSON: 'CONTENT_TYPE_NOT_JSON',
});

export const VERIFICATION_DECISION = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  BLOCKED: 'BLOCKED',
});

export const VERIFICATION_REASONS = Object.freeze({
  PRIMARY_NOT_FAILED: 'PRIMARY_NOT_FAILED',
  PRIMARY_PROBE_BLOCKED: 'PRIMARY_PROBE_BLOCKED',
  PRIMARY_PROBE_MALFORMED: 'PRIMARY_PROBE_MALFORMED',
  FALLBACK_NOT_READY: 'FALLBACK_NOT_READY',
  FALLBACK_PROBE_BLOCKED: 'FALLBACK_PROBE_BLOCKED',
  FALLBACK_PROBE_MALFORMED: 'FALLBACK_PROBE_MALFORMED',
  BOTH_ORIGINS_DOWN: 'BOTH_ORIGINS_DOWN',
  VERIFICATION_ABORTED: 'VERIFICATION_ABORTED',
  VERIFICATION_DEADLINE_EXCEEDED: 'VERIFICATION_DEADLINE_EXCEEDED',
  VERIFICATION_SLEEP_FAILED: 'VERIFICATION_SLEEP_FAILED',
});

const DEFAULT_FETCH = () => globalThis.fetch;

function invalidConfigError() {
  return new Error(PROBE_REASONS.CONFIG_INVALID);
}

function assertString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidConfigError();
  }
}

function parseUrl(value) {
  assertString(value);
  try {
    return new URL(value);
  } catch {
    throw invalidConfigError();
  }
}

function assertNoCredentialsOrDecorators(url) {
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw invalidConfigError();
  }
}

function assertPrimaryUrl(value) {
  const url = parseUrl(value);
  assertNoCredentialsOrDecorators(url);
  if (
    url.protocol !== PRIMARY_SCHEME ||
    url.hostname !== PRIMARY_HOST ||
    (url.port !== '' && url.port !== PRIMARY_PORT) ||
    url.pathname !== PRIMARY_PATH
  ) {
    throw invalidConfigError();
  }
  return url.href;
}

function assertFallbackUrl(value) {
  const url = parseUrl(value);
  assertNoCredentialsOrDecorators(url);
  if (
    url.href !== FALLBACK_URL ||
    url.protocol !== FALLBACK_SCHEME ||
    url.hostname !== FALLBACK_HOST ||
    url.port !== FALLBACK_PORT ||
    url.pathname !== FALLBACK_PATH
  ) {
    throw invalidConfigError();
  }
  return url.href;
}

/**
 * Validate the only two origins that the controller may probe.
 *
 * No defaults are inferred: callers must provide both URLs explicitly so a
 * missing production configuration cannot silently become a local probe.
 */
export function parseHealthConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw invalidConfigError();
  }
  const allowedKeys = new Set(['primaryReadinessUrl', 'primaryUrl', 'fallbackReadinessUrl', 'fallbackUrl']);
  if (Object.keys(config).some((key) => !allowedKeys.has(key))) {
    throw invalidConfigError();
  }
  const primaryReadinessUrl = config.primaryReadinessUrl ?? config.primaryUrl;
  const fallbackReadinessUrl = config.fallbackReadinessUrl ?? config.fallbackUrl;
  return Object.freeze({
    primaryReadinessUrl: assertPrimaryUrl(primaryReadinessUrl),
    fallbackReadinessUrl: assertFallbackUrl(fallbackReadinessUrl),
  });
}

export const assertHealthConfig = parseHealthConfig;

function classifyUrl(value) {
  const url = parseUrl(value);
  assertNoCredentialsOrDecorators(url);
  if (
    url.protocol === FALLBACK_SCHEME &&
    url.hostname === FALLBACK_HOST &&
    url.port === FALLBACK_PORT &&
    url.pathname === FALLBACK_PATH
  ) {
    return { href: url.href, role: 'fallback' };
  }
  if (
    url.protocol === PRIMARY_SCHEME &&
    url.hostname === PRIMARY_HOST &&
    (url.port === '' || url.port === PRIMARY_PORT) &&
    url.pathname === PRIMARY_PATH
  ) {
    return { href: url.href, role: 'primary' };
  }
  throw invalidConfigError();
}

function asByteLength(chunk) {
  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk).byteLength;
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  if (chunk instanceof ArrayBuffer) {
    return chunk.byteLength;
  }
  if (ArrayBuffer.isView(chunk)) {
    return chunk.byteLength;
  }
  return -1;
}

async function readBodyBounded(response, maxBytes) {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: PROBE_REASONS.BODY_TOO_LARGE };
    }
  }

  if (response.body?.getReader) {
    let reader;
    try {
      reader = response.body.getReader();
    } catch {
      return { ok: false, reason: PROBE_REASONS.REQUEST_FAILED };
    }
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        const chunkBytes = asByteLength(chunk);
        if (chunkBytes < 0) return { ok: false, reason: PROBE_REASONS.REQUEST_FAILED };
        totalBytes += chunkBytes;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Preserve the bounded-body refusal even when cancellation fails.
          }
          return { ok: false, reason: PROBE_REASONS.BODY_TOO_LARGE };
        }
        chunks.push(chunk);
      }
    } catch {
      return { ok: false, reason: PROBE_REASONS.REQUEST_FAILED };
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      const encoded = typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : ArrayBuffer.isView(chunk)
          ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : new Uint8Array(chunk);
      bytes.set(encoded, offset);
      offset += encoded.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(bytes) };
  }

  let text;
  try {
    text = await response.text();
  } catch {
    return { ok: false, reason: PROBE_REASONS.REQUEST_FAILED };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, reason: PROBE_REASONS.BODY_TOO_LARGE };
  }
  return { ok: true, text };
}

function result(status, reason, statusCode) {
  const value = { status };
  if (reason !== undefined) value.reason = reason;
  if (statusCode !== undefined) value.statusCode = statusCode;
  return Object.freeze(value);
}

function combineAbortSignals(externalSignal, controller) {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  externalSignal.addEventListener('abort', onAbort, { once: true });
  return () => externalSignal.removeEventListener('abort', onAbort);
}

/**
 * Probe an allowlisted readiness URL. The result intentionally contains no
 * URL, response body, headers, or exception text.
 */
export async function probeReadiness(value, options = {}) {
  options = options ?? {};
  let target;
  try {
    target = classifyUrl(value);
  } catch {
    return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.CONFIG_INVALID);
  }

  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROBE_TIMEOUT_MS) {
    return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.CONFIG_INVALID);
  }

  const fetchImpl = options.fetch ?? DEFAULT_FETCH();
  if (typeof fetchImpl !== 'function') {
    return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.FETCH_UNAVAILABLE);
  }

  const externalSignal = options.signal;
  if (externalSignal?.aborted) {
    return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.ABORTED);
  }

  const controller = new AbortController();
  const removeAbortListener = combineAbortSignals(externalSignal, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetchImpl(target.href, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    clearTimeout(timer);
    removeAbortListener();
    if (timedOut) return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.TIMEOUT);
    if (externalSignal?.aborted || error?.name === 'AbortError') {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.ABORTED);
    }
    if (error?.name === 'RedirectError' || error?.code === 'ERR_FR_REDIRECT' || /redirect/i.test(String(error?.message ?? ''))) {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.REDIRECT_REJECTED);
    }
    return result(PROBE_STATUS.FAILED, PROBE_REASONS.REQUEST_FAILED);
  }
  try {
    if (timedOut) return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.TIMEOUT);
    if (externalSignal?.aborted) return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.ABORTED);
    if (response?.redirected || (response?.status >= 300 && response?.status < 400)) {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.REDIRECT_REJECTED, response.status);
    }
    if (!response || response.status !== 200) {
      return result(PROBE_STATUS.FAILED, PROBE_REASONS.HTTP_STATUS_NOT_OK, response?.status);
    }

    const contentType = response.headers?.get?.('content-type');
    if (contentType && !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.CONTENT_TYPE_NOT_JSON, response.status);
    }

    const body = await readBodyBounded(response, PROBE_MAX_BODY_BYTES);
    if (timedOut) return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.TIMEOUT);
    if (externalSignal?.aborted) return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.ABORTED);
    if (!body.ok) return result(PROBE_STATUS.BLOCKED, body.reason, response.status);

    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_MALFORMED, response.status);
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      parsed.status !== REQUIRED_HEALTH_STATUS
    ) {
      return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_NOT_EXACT, response.status);
    }
    return result(PROBE_STATUS.OK, undefined, response.status);
  } catch {
    return result(PROBE_STATUS.BLOCKED, PROBE_REASONS.REQUEST_FAILED);
  } finally {
    clearTimeout(timer);
    removeAbortListener();
  }
}

export const probe = probeReadiness;

function isAbortSignalAborted(signal) {
  return signal?.aborted === true;
}

function isProbeResult(value) {
  if (value === null || typeof value !== 'object' || typeof value.status !== 'string') return false;
  const allowedKeys = new Set(['status', 'reason', 'statusCode']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (!Object.values(PROBE_STATUS).includes(value.status)) return false;
  if (value.status === PROBE_STATUS.OK && value.reason !== undefined) return false;
  if (value.status === PROBE_STATUS.OK && value.statusCode !== undefined && value.statusCode !== 200) return false;
  if (
    value.status !== PROBE_STATUS.OK &&
    (typeof value.reason !== 'string' || !Object.values(PROBE_REASONS).includes(value.reason))
  ) return false;
  return true;
}

function nowMs(clock) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function waitBetweenAttempts(sleep, intervalMs, signal) {
  if (isAbortSignalAborted(signal)) return false;
  if (intervalMs <= 0) return true;
  try {
    await sleep(intervalMs, signal);
    return !isAbortSignalAborted(signal);
  } catch {
    return false;
  }
}

function blocked(reason, primaryFailures, fallbackSuccesses) {
  return Object.freeze({
    decision: VERIFICATION_DECISION.BLOCKED,
    reason,
    primaryFailures,
    fallbackSuccesses,
  });
}

/**
 * Run the one-shot 3-failure/3-success verification. This is deliberately a
 * bounded operation; it is not a scheduler or a polling loop.
 */
export async function verifyBoundedHealth(options = {}) {
  options = options ?? {};
  let probePrimary = options.probePrimary;
  let probeFallback = options.probeFallback;
  if (typeof probePrimary !== 'function' || typeof probeFallback !== 'function') {
    try {
      const config = parseHealthConfig(options.config ?? {
        primaryReadinessUrl: options.primaryReadinessUrl,
        fallbackReadinessUrl: options.fallbackReadinessUrl,
      });
      probePrimary = ({ signal } = {}) => probeReadiness(config.primaryReadinessUrl, {
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        signal,
      });
      probeFallback = ({ signal } = {}) => probeReadiness(config.fallbackReadinessUrl, {
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        signal,
      });
    } catch {
      return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_MALFORMED, 0, 0);
    }
  }
  if (typeof probePrimary !== 'function' || typeof probeFallback !== 'function') {
    return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_MALFORMED, 0, 0);
  }

  const sleep = options.sleep ?? (async (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const clock = options.clock ?? (() => Date.now());
  const intervalMs = options.intervalMs ?? PROBE_INTERVAL_MS;
  const maxDurationMs = options.maxDurationMs ?? VERIFICATION_MAX_DURATION_MS;
  const signal = options.signal;
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || !Number.isInteger(maxDurationMs) || maxDurationMs < 1) {
    return blocked(VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED, 0, 0);
  }
  const startedAt = nowMs(clock);
  if (startedAt === null) return blocked(VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED, 0, 0);
  let primaryFailures = 0;
  let fallbackSuccesses = 0;

  const deadlineExceeded = () => {
    const current = nowMs(clock);
    return current === null || current - startedAt > maxDurationMs;
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isAbortSignalAborted(signal)) return blocked(VERIFICATION_REASONS.VERIFICATION_ABORTED, primaryFailures, fallbackSuccesses);
    if (deadlineExceeded()) return blocked(VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED, primaryFailures, fallbackSuccesses);
    if (attempt > 0 && !(await waitBetweenAttempts(sleep, intervalMs, signal))) {
      return blocked(
        isAbortSignalAborted(signal) ? VERIFICATION_REASONS.VERIFICATION_ABORTED : VERIFICATION_REASONS.VERIFICATION_SLEEP_FAILED,
        primaryFailures,
        fallbackSuccesses,
      );
    }
    let value;
    try {
      value = await probePrimary({ attempt, signal });
    } catch {
      return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_BLOCKED, primaryFailures, fallbackSuccesses);
    }
    if (!isProbeResult(value)) return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_MALFORMED, primaryFailures, fallbackSuccesses);
    if (value.status === PROBE_STATUS.OK) {
      return blocked(VERIFICATION_REASONS.PRIMARY_NOT_FAILED, primaryFailures, fallbackSuccesses);
    }
    if (value.status === PROBE_STATUS.BLOCKED) {
      return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_BLOCKED, primaryFailures, fallbackSuccesses);
    }
    if (value.status !== PROBE_STATUS.FAILED) {
      return blocked(VERIFICATION_REASONS.PRIMARY_PROBE_MALFORMED, primaryFailures, fallbackSuccesses);
    }
    primaryFailures += 1;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isAbortSignalAborted(signal)) return blocked(VERIFICATION_REASONS.VERIFICATION_ABORTED, primaryFailures, fallbackSuccesses);
    if (deadlineExceeded()) return blocked(VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED, primaryFailures, fallbackSuccesses);
    if (attempt > 0 && !(await waitBetweenAttempts(sleep, intervalMs, signal))) {
      return blocked(
        isAbortSignalAborted(signal) ? VERIFICATION_REASONS.VERIFICATION_ABORTED : VERIFICATION_REASONS.VERIFICATION_SLEEP_FAILED,
        primaryFailures,
        fallbackSuccesses,
      );
    }
    let value;
    try {
      value = await probeFallback({ attempt, signal });
    } catch {
      return blocked(VERIFICATION_REASONS.FALLBACK_PROBE_BLOCKED, primaryFailures, fallbackSuccesses);
    }
    if (!isProbeResult(value)) return blocked(VERIFICATION_REASONS.FALLBACK_PROBE_MALFORMED, primaryFailures, fallbackSuccesses);
    if (value.status === PROBE_STATUS.BLOCKED) {
      return blocked(VERIFICATION_REASONS.FALLBACK_PROBE_BLOCKED, primaryFailures, fallbackSuccesses);
    }
    if (value.status !== PROBE_STATUS.OK && value.status !== PROBE_STATUS.FAILED) {
      return blocked(VERIFICATION_REASONS.FALLBACK_PROBE_MALFORMED, primaryFailures, fallbackSuccesses);
    }
    if (value.status === PROBE_STATUS.FAILED) {
      return blocked(
        primaryFailures === 3 ? VERIFICATION_REASONS.BOTH_ORIGINS_DOWN : VERIFICATION_REASONS.FALLBACK_NOT_READY,
        primaryFailures,
        fallbackSuccesses,
      );
    }
    fallbackSuccesses += 1;
  }

  return Object.freeze({
    decision: VERIFICATION_DECISION.ELIGIBLE,
    reason: null,
    primaryFailures,
    fallbackSuccesses,
  });
}

export const verifyHealth = verifyBoundedHealth;
