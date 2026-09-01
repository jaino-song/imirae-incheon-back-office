import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
export const WEBHOOK_RESOURCE = 'event_alert';
export const WEBHOOK_ACTION = 'triggered';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^\d{1,12}(?:\.\d+)?$/;

const ERROR_STATUS = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SERVICE_UNAVAILABLE: 503,
});

export const SECURITY_ERROR_CODES = Object.freeze({
  RAW_BODY_REQUIRED: 'RAW_BODY_REQUIRED',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  CONTENT_TYPE_REQUIRED: 'CONTENT_TYPE_REQUIRED',
  REQUEST_ID_REQUIRED: 'REQUEST_ID_REQUIRED',
  REQUEST_ID_INVALID: 'REQUEST_ID_INVALID',
  HOOK_RESOURCE_REQUIRED: 'HOOK_RESOURCE_REQUIRED',
  HOOK_RESOURCE_NOT_ALLOWED: 'HOOK_RESOURCE_NOT_ALLOWED',
  HOOK_TIMESTAMP_REQUIRED: 'HOOK_TIMESTAMP_REQUIRED',
  HOOK_TIMESTAMP_INVALID: 'HOOK_TIMESTAMP_INVALID',
  SIGNATURE_REQUIRED: 'SIGNATURE_REQUIRED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  LEGACY_SERVICE_HOOK_REJECTED: 'LEGACY_SERVICE_HOOK_REJECTED',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_PAYLOAD_SHAPE: 'INVALID_PAYLOAD_SHAPE',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  INSTALLATION_REQUIRED: 'INSTALLATION_REQUIRED',
  INSTALLATION_NOT_ALLOWED: 'INSTALLATION_NOT_ALLOWED',
  ACTOR_REQUIRED: 'ACTOR_REQUIRED',
  ACTOR_NOT_ALLOWED: 'ACTOR_NOT_ALLOWED',
  DATA_REQUIRED: 'DATA_REQUIRED',
  EVENT_REQUIRED: 'EVENT_REQUIRED',
  EVENT_ID_REQUIRED: 'EVENT_ID_REQUIRED',
  PROJECT_REQUIRED: 'PROJECT_REQUIRED',
  PROJECT_NOT_ALLOWED: 'PROJECT_NOT_ALLOWED',
  ORGANIZATION_NOT_ALLOWED: 'ORGANIZATION_NOT_ALLOWED',
  TRIGGERED_RULE_REQUIRED: 'TRIGGERED_RULE_REQUIRED',
  ALERT_ID_REQUIRED: 'ALERT_ID_REQUIRED',
  ALERT_ID_NOT_ALLOWED: 'ALERT_ID_NOT_ALLOWED',
  SOURCE_IDENTITY_REQUIRED: 'SOURCE_IDENTITY_REQUIRED',
  UNSUPPORTED_SOURCE_IDENTITY: 'UNSUPPORTED_SOURCE_IDENTITY',
  SIGNED_TIMESTAMP_REQUIRED: 'SIGNED_TIMESTAMP_REQUIRED',
  SIGNED_TIMESTAMP_INVALID: 'SIGNED_TIMESTAMP_INVALID',
  SIGNED_TIMESTAMP_STALE: 'SIGNED_TIMESTAMP_STALE',
  SIGNED_TIMESTAMP_FUTURE: 'SIGNED_TIMESTAMP_FUTURE',
  SIGNED_TIMESTAMP_CONFLICT: 'SIGNED_TIMESTAMP_CONFLICT',
  CONFIGURATION_BLOCKED: 'CONFIGURATION_BLOCKED',
});

const ERROR_DEFINITIONS = Object.freeze({
  [SECURITY_ERROR_CODES.RAW_BODY_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.BODY_TOO_LARGE]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.CONTENT_TYPE_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.REQUEST_ID_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.REQUEST_ID_INVALID]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.HOOK_RESOURCE_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.HOOK_RESOURCE_NOT_ALLOWED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.HOOK_TIMESTAMP_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.HOOK_TIMESTAMP_INVALID]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.SIGNATURE_REQUIRED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.SIGNATURE_INVALID]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.LEGACY_SERVICE_HOOK_REJECTED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.INVALID_JSON]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.INVALID_PAYLOAD_SHAPE]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.ACTION_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.ACTION_NOT_ALLOWED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.INSTALLATION_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.INSTALLATION_NOT_ALLOWED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.ACTOR_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.ACTOR_NOT_ALLOWED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.DATA_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.EVENT_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.EVENT_ID_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.PROJECT_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.PROJECT_NOT_ALLOWED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.ORGANIZATION_NOT_ALLOWED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.TRIGGERED_RULE_REQUIRED]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.ALERT_ID_REQUIRED]: ERROR_STATUS.SERVICE_UNAVAILABLE,
  [SECURITY_ERROR_CODES.ALERT_ID_NOT_ALLOWED]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.SOURCE_IDENTITY_REQUIRED]: ERROR_STATUS.SERVICE_UNAVAILABLE,
  [SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY]: ERROR_STATUS.SERVICE_UNAVAILABLE,
  [SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_REQUIRED]: ERROR_STATUS.SERVICE_UNAVAILABLE,
  [SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_INVALID]: ERROR_STATUS.BAD_REQUEST,
  [SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_STALE]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_FUTURE]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_CONFLICT]: ERROR_STATUS.UNAUTHORIZED,
  [SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED]: ERROR_STATUS.SERVICE_UNAVAILABLE,
});

export class WebhookSecurityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WebhookSecurityError';
    this.code = code;
    this.statusCode = ERROR_DEFINITIONS[code] ?? ERROR_STATUS.BAD_REQUEST;
  }
}

function fail(code) {
  throw new WebhookSecurityError(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value);
}

function scalarIdentifier(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  return undefined;
}

function getHeaderEntries(headers, name) {
  if (!isRecord(headers)) return [];
  const wanted = name.toLowerCase();
  return Object.entries(headers).filter(([key]) => key.toLowerCase() === wanted);
}

export function getRequestHeader(headers, name) {
  const entries = getHeaderEntries(headers, name);
  if (entries.length !== 1) return undefined;
  const value = entries[0][1];
  return typeof value === 'string' ? value : undefined;
}

function requireHeader(headers, name, code) {
  const entries = getHeaderEntries(headers, name);
  if (entries.length !== 1 || typeof entries[0][1] !== 'string' || entries[0][1].trim() === '') {
    fail(code);
  }
  return entries[0][1].trim();
}

function hasHeaderPrefix(headers, prefix) {
  if (!isRecord(headers)) return false;
  const wanted = prefix.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase().startsWith(wanted));
}

/**
 * Keep the provider body as a string. Parsing or reserializing before HMAC
 * verification can change whitespace/escaping and invalidate the signature.
 */
export function extractRawBody(body) {
  if (typeof body !== 'string') fail(SECURITY_ERROR_CODES.RAW_BODY_REQUIRED);
  if (Buffer.byteLength(body, 'utf8') > MAX_WEBHOOK_BYTES) {
    fail(SECURITY_ERROR_CODES.BODY_TOO_LARGE);
  }
  return body;
}

export function normalizeSignatureHeader(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return SHA256_HEX_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

/**
 * Compare two fixed 32-byte digests. The size check occurs before
 * timingSafeEqual so that timingSafeEqual always receives equal-length input.
 */
export function constantTimeHexEqual(actualHex, expectedHex) {
  const actual = normalizeSignatureHeader(actualHex);
  const expected = normalizeSignatureHeader(expectedHex);
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

export function verifySignature(rawBody, signatureHeader, clientSecret) {
  if (typeof rawBody !== 'string' || typeof clientSecret !== 'string' || clientSecret.length === 0) {
    return false;
  }
  const expected = createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest('hex');
  return constantTimeHexEqual(signatureHeader, expected);
}

/**
 * Parse only after verifySignature has succeeded. This function is exported
 * for receiver composition, but callers should prefer authenticateWebhook.
 */
export function parseWebhookJson(rawBody) {
  if (typeof rawBody !== 'string') fail(SECURITY_ERROR_CODES.RAW_BODY_REQUIRED);
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    fail(SECURITY_ERROR_CODES.INVALID_JSON);
  }
  if (!isRecord(payload)) fail(SECURITY_ERROR_CODES.INVALID_PAYLOAD_SHAPE);
  return payload;
}

export function deriveBodyFingerprint(rawBody) {
  const body = extractRawBody(rawBody);
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function deriveRequestCorrelation(rawBody) {
  const fingerprint = deriveBodyFingerprint(rawBody);
  return `fallback-${fingerprint.slice(0, 32)}`;
}

function parseUnixSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 1000);
  }
  if (typeof value !== 'string' || !UNIX_SECONDS_PATTERN.test(value.trim())) return NaN;
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : NaN;
}

export function parseSignedTimestamp(value) {
  if (typeof value === 'number' || (typeof value === 'string' && UNIX_SECONDS_PATTERN.test(value.trim()))) {
    return parseUnixSeconds(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export function getHookTimestamp(headers) {
  const value = getRequestHeader(headers, 'sentry-hook-timestamp');
  return parseUnixSeconds(value);
}

export function isTimestampFresh(timestampMs, nowMs = Date.now(), toleranceMs = WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return false;
  if (!Number.isInteger(toleranceMs) || toleranceMs < 0) return false;
  return Math.abs(nowMs - timestampMs) <= toleranceMs;
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

export function assertFreshSignedTimestamp(timestampMs, {
  now = Date.now(),
  toleranceMs = WEBHOOK_TIMESTAMP_TOLERANCE_MS,
} = {}) {
  const nowMs = resolveNow(now);
  if (!Number.isFinite(timestampMs)) fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_INVALID);
  if (!Number.isInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 60 * 60 * 1000) {
    fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);
  }
  if (timestampMs > nowMs + toleranceMs) fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_FUTURE);
  if (timestampMs < nowMs - toleranceMs) fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_STALE);
  return true;
}

function collectSignedEventTimestamps(event) {
  const candidates = [];
  if (event.timestamp !== undefined && event.timestamp !== null) {
    candidates.push({ value: event.timestamp, source: 'timestamp' });
  }
  if (event.datetime !== undefined && event.datetime !== null) {
    candidates.push({ value: event.datetime, source: 'datetime' });
  }
  return candidates;
}

export function getSignedEventTimestamp(payload) {
  const event = payload?.data?.event;
  if (!isRecord(event)) fail(SECURITY_ERROR_CODES.EVENT_REQUIRED);
  const candidates = collectSignedEventTimestamps(event);
  if (candidates.length === 0) fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_REQUIRED);

  const parsed = candidates.map(({ value, source }) => {
    const timestampMs = parseSignedTimestamp(value);
    if (!Number.isFinite(timestampMs)) fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_INVALID);
    return { timestampMs, source };
  });
  const first = parsed[0].timestampMs;
  if (parsed.slice(1).some(({ timestampMs }) => Math.abs(timestampMs - first) > WEBHOOK_TIMESTAMP_TOLERANCE_MS)) {
    fail(SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_CONFLICT);
  }
  return first;
}

function normalizeSecurityConfig(config = {}) {
  if (!isRecord(config)) fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);

  const installationId = typeof config.installationId === 'string' ? config.installationId.trim() : '';
  const organizationId = typeof config.organizationId === 'string' ? config.organizationId.trim() : '';
  const projectId = scalarIdentifier(config.projectId);
  const alertId = scalarIdentifier(config.alertId);
  const monitorId = scalarIdentifier(config.monitorId);

  if (!UUID_PATTERN.test(installationId) || !isSafeIdentifier(organizationId) || !isSafeIdentifier(projectId)) {
    fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);
  }
  if (alertId && !isSafeIdentifier(alertId)) fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);
  if (monitorId && !isSafeIdentifier(monitorId)) fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);
  if (!alertId && !monitorId) fail(SECURITY_ERROR_CODES.SOURCE_IDENTITY_REQUIRED);

  // The public event_alert payload does not guarantee a monitor ID. Arming a
  // monitor allowlist without a captured provider field is fail-closed.
  if (monitorId) fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);

  const toleranceMs = config.timestampToleranceMs ?? WEBHOOK_TIMESTAMP_TOLERANCE_MS;
  if (!Number.isInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 60 * 60 * 1000) {
    fail(SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED);
  }
  return {
    installationId,
    organizationId,
    projectId,
    alertId,
    monitorId: null,
    timestampToleranceMs: toleranceMs,
  };
}

export function validateSecurityConfig(config = {}) {
  return normalizeSecurityConfig(config);
}

function readSignedOrganizationId(data, event) {
  const values = [
    scalarIdentifier(data.organization_id),
    scalarIdentifier(event.organization_id),
  ].filter(Boolean);
  if (values.length > 1 && values.some((value) => value !== values[0])) {
    fail(SECURITY_ERROR_CODES.ORGANIZATION_NOT_ALLOWED);
  }
  return values[0];
}

function readEventProjectId(event) {
  const value = isRecord(event.project) ? event.project.id : event.project;
  return scalarIdentifier(value);
}

function readEventAlertId(data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'issue_alert')) return undefined;
  if (!isRecord(data.issue_alert)) fail(SECURITY_ERROR_CODES.INVALID_PAYLOAD_SHAPE);
  return scalarIdentifier(data.issue_alert.id);
}

function rejectUnsupportedSourceIdentity(data, event) {
  const unsupportedKeys = ['monitor', 'monitor_id', 'monitorId', 'source', 'source_id', 'sourceId'];
  if (unsupportedKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) {
    fail(SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY);
  }
  if (unsupportedKeys.some((key) => Object.prototype.hasOwnProperty.call(event, key))) {
    fail(SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY);
  }
}

export function normalizeIssueAlertPayload(payload, rawBody) {
  if (!isRecord(payload)) fail(SECURITY_ERROR_CODES.INVALID_PAYLOAD_SHAPE);
  if (Object.prototype.hasOwnProperty.call(payload, 'resource')) {
    fail(SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY);
  }
  const data = payload.data;
  const event = data?.event;
  if (!isRecord(data)) fail(SECURITY_ERROR_CODES.DATA_REQUIRED);
  if (!isRecord(event)) fail(SECURITY_ERROR_CODES.EVENT_REQUIRED);
  rejectUnsupportedSourceIdentity(data, event);

  const installationId = scalarIdentifier(payload.installation?.uuid);
  if (!installationId) fail(SECURITY_ERROR_CODES.INSTALLATION_REQUIRED);
  const eventId = scalarIdentifier(event.event_id);
  const issueId = scalarIdentifier(event.issue_id);
  if (!eventId && !issueId) fail(SECURITY_ERROR_CODES.EVENT_ID_REQUIRED);
  const projectId = readEventProjectId(event);
  if (!projectId) fail(SECURITY_ERROR_CODES.PROJECT_REQUIRED);
  const triggeredRule = typeof data.triggered_rule === 'string' ? data.triggered_rule.trim() : '';
  if (!triggeredRule) fail(SECURITY_ERROR_CODES.TRIGGERED_RULE_REQUIRED);

  const signedTimestampMs = getSignedEventTimestamp(payload);
  const alertId = readEventAlertId(data);
  const organizationId = readSignedOrganizationId(data, event);
  const bodyFingerprint = deriveBodyFingerprint(rawBody);

  return {
    action: payload.action,
    resource: WEBHOOK_RESOURCE,
    installationId,
    organizationId,
    projectId,
    alertId,
    monitorId: undefined,
    eventId: eventId ?? issueId,
    issueId,
    triggeredRule,
    signedTimestampMs,
    bodyFingerprint,
    requestCorrelation: `fallback-${bodyFingerprint.slice(0, 32)}`,
  };
}

export function validateIssueAlertEvent(event, config = {}) {
  const expected = normalizeSecurityConfig(config);
  if (event?.installationId !== expected.installationId) {
    fail(SECURITY_ERROR_CODES.INSTALLATION_NOT_ALLOWED);
  }
  // Internal Integration installations are organization-scoped. The signed
  // installation UUID is the authoritative organization boundary when an
  // event_alert payload omits an explicit organization field.
  if (event?.organizationId && event.organizationId !== expected.organizationId) {
    fail(SECURITY_ERROR_CODES.ORGANIZATION_NOT_ALLOWED);
  }
  if (event?.projectId !== expected.projectId) {
    fail(SECURITY_ERROR_CODES.PROJECT_NOT_ALLOWED);
  }
  if (!event?.alertId) fail(SECURITY_ERROR_CODES.ALERT_ID_REQUIRED);
  if (event.alertId !== expected.alertId) fail(SECURITY_ERROR_CODES.ALERT_ID_NOT_ALLOWED);
  if (event?.monitorId) fail(SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY);
  return {
    ...event,
    organizationId: expected.organizationId,
    sourceId: event.alertId,
  };
}

export function isAllowedSentryEvent(event, config = {}) {
  try {
    validateIssueAlertEvent(event, config);
    return { allowed: true, reason: 'eligible' };
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof WebhookSecurityError ? error.code : SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED,
    };
  }
}

export function validateIssueAlertPayload(payload, config = {}, {
  rawBody,
  now = Date.now(),
} = {}) {
  if (typeof rawBody !== 'string') fail(SECURITY_ERROR_CODES.RAW_BODY_REQUIRED);
  if (payload?.action !== WEBHOOK_ACTION) {
    if (payload?.action === undefined) fail(SECURITY_ERROR_CODES.ACTION_REQUIRED);
    fail(SECURITY_ERROR_CODES.ACTION_NOT_ALLOWED);
  }
  const actor = payload.actor;
  if (!isRecord(actor)) fail(SECURITY_ERROR_CODES.ACTOR_REQUIRED);
  if (actor.type !== 'application' || actor.id !== 'sentry' || actor.name !== 'Sentry') {
    fail(SECURITY_ERROR_CODES.ACTOR_NOT_ALLOWED);
  }
  const event = normalizeIssueAlertPayload(payload, rawBody);
  const validated = validateIssueAlertEvent(event, config);
  const expected = normalizeSecurityConfig(config);
  assertFreshSignedTimestamp(event.signedTimestampMs, {
    now,
    toleranceMs: expected.timestampToleranceMs,
  });
  return validated;
}

function validateHeaders(headers) {
  if (hasHeaderPrefix(headers, 'x-servicehook-')) {
    fail(SECURITY_ERROR_CODES.LEGACY_SERVICE_HOOK_REJECTED);
  }
  const contentType = requireHeader(headers, 'content-type', SECURITY_ERROR_CODES.CONTENT_TYPE_REQUIRED);
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    fail(SECURITY_ERROR_CODES.CONTENT_TYPE_REQUIRED);
  }
  const requestId = requireHeader(headers, 'request-id', SECURITY_ERROR_CODES.REQUEST_ID_REQUIRED);
  if (!isSafeIdentifier(requestId)) fail(SECURITY_ERROR_CODES.REQUEST_ID_INVALID);
  const resource = requireHeader(headers, 'sentry-hook-resource', SECURITY_ERROR_CODES.HOOK_RESOURCE_REQUIRED);
  if (resource !== WEBHOOK_RESOURCE) fail(SECURITY_ERROR_CODES.HOOK_RESOURCE_NOT_ALLOWED);
  const timestamp = requireHeader(headers, 'sentry-hook-timestamp', SECURITY_ERROR_CODES.HOOK_TIMESTAMP_REQUIRED);
  const headerTimestampMs = parseUnixSeconds(timestamp);
  if (!Number.isFinite(headerTimestampMs)) fail(SECURITY_ERROR_CODES.HOOK_TIMESTAMP_INVALID);
  const signature = requireHeader(headers, 'sentry-hook-signature', SECURITY_ERROR_CODES.SIGNATURE_REQUIRED);
  if (!normalizeSignatureHeader(signature)) fail(SECURITY_ERROR_CODES.SIGNATURE_INVALID);
  return { requestId, resource, timestamp, headerTimestampMs, signature };
}

/**
 * Authenticate one Internal Integration issue-alert delivery. The function
 * intentionally performs HMAC verification before JSON parsing and never logs
 * request data, signatures, secrets, or provider identifiers.
 */
export function authenticateWebhook({
  body,
  headers,
  clientSecret,
  config,
  now = Date.now(),
} = {}) {
  const rawBody = extractRawBody(body);
  const headerMeta = validateHeaders(headers);
  if (!verifySignature(rawBody, headerMeta.signature, clientSecret)) {
    fail(SECURITY_ERROR_CODES.SIGNATURE_INVALID);
  }
  const payload = parseWebhookJson(rawBody);
  const normalized = validateIssueAlertPayload(payload, config, { rawBody, now });
  return {
    ...normalized,
    requestId: normalized.requestCorrelation,
    providerRequestId: headerMeta.requestId,
    resource: headerMeta.resource,
    action: WEBHOOK_ACTION,
    headerTimestampMs: headerMeta.headerTimestampMs,
    payload,
  };
}

export const authenticateIssueAlertWebhook = authenticateWebhook;
export const normalizeSentryEvent = normalizeIssueAlertPayload;

export function isBodyFingerprint(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

export function isOpaqueUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function toPublicError(error) {
  if (error instanceof WebhookSecurityError) {
    return { statusCode: error.statusCode, body: { accepted: false } };
  }
  return { statusCode: 500, body: { accepted: false } };
}
