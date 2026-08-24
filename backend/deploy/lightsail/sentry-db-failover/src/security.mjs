import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  ELIGIBLE_ACTION,
  ELIGIBLE_ISSUE_CODES,
  ELIGIBLE_RESOURCE,
  EXPECTED_METRIC_AGGREGATE,
  EXPECTED_METRIC_THRESHOLD,
  EXPECTED_METRIC_TIME_WINDOW_MINUTES,
  FAILOVER_SIGNAL_CLASS,
  MAX_WEBHOOK_BYTES,
  REQUIRED_QUERY_MARKERS,
  ROUTES,
  UUID_PATTERN,
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  parseBoolean,
  parseCsv,
} from './constants.mjs';

const TIMESTAMP_HEADERS = Object.freeze([
  'sentry-hook-timestamp',
  'x-sentry-hook-timestamp',
]);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  const wanted = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

export function getRequestHeader(headers, ...names) {
  for (const name of names) {
    const value = getHeader(headers, name);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function extractRawBody(event) {
  if (!event || typeof event.body !== 'string') {
    throw new WebhookValidationError('raw_body_required', 400);
  }

  if (event.isBase64Encoded === true) {
    const maxEncodedBodyChars = Math.ceil(MAX_WEBHOOK_BYTES / 3) * 4;
    if (event.body.length > maxEncodedBodyChars) {
      throw new WebhookValidationError('body_too_large', 413);
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body)) {
      throw new WebhookValidationError('invalid_base64_body', 400);
    }
    let decoded;
    try {
      decoded = Buffer.from(event.body, 'base64');
    } catch {
      throw new WebhookValidationError('invalid_base64_body', 400);
    }
    if (decoded.length > MAX_WEBHOOK_BYTES) {
      throw new WebhookValidationError('body_too_large', 413);
    }
    return decoded;
  }

  if (Buffer.byteLength(event.body, 'utf8') > MAX_WEBHOOK_BYTES) {
    throw new WebhookValidationError('body_too_large', 413);
  }
  return Buffer.from(event.body, 'utf8');
}

export function normalizeSignatureHeader(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^(?:sha256|v1)=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(withoutPrefix)) return null;
  return withoutPrefix.toLowerCase();
}

export function constantTimeHexEqual(actualHex, expectedHex) {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = normalizeSignatureHeader(actualHex);
  const candidate = Buffer.alloc(expected.length);
  if (actual) Buffer.from(actual, 'hex').copy(candidate);
  const equal = timingSafeEqual(candidate, expected);
  return equal && actual !== null;
}

export function verifySignature(rawBody, signatureHeader, clientSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof clientSecret !== 'string' || clientSecret.length === 0) {
    return false;
  }
  const expected = createHmac('sha256', clientSecret).update(rawBody).digest('hex');
  return constantTimeHexEqual(signatureHeader, expected);
}

export function parseWebhookJson(rawBody) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new WebhookValidationError('raw_body_required', 400);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new WebhookValidationError('invalid_json', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebhookValidationError('invalid_json_shape', 400);
  }
  return parsed;
}

function readPath(object, path) {
  let value = object;
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

function firstString(object, paths) {
  for (const path of paths) {
    const value = readPath(object, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function scalarIdentifier(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function projectIdentifiers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((project) => (
      project && typeof project === 'object'
        ? scalarIdentifier(project.id)
        : scalarIdentifier(project)
    ));
}

function queryContainsMarker(query, marker) {
  if (typeof query !== 'string') return false;
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_.:-])${escapedMarker}(?=$|[^A-Za-z0-9_.:-])`).test(query);
}

function isFailoverEligibleQuery(query) {
  if (typeof query !== 'string' || query.trim() === '') return false;
  if (!REQUIRED_QUERY_MARKERS.every((marker) => queryContainsMarker(query, marker))) return false;

  const prismaCodes = [...query.matchAll(/\bP[0-9]{4}\b/gi)].map(([code]) => code.toUpperCase());
  return prismaCodes.length > 0
    && prismaCodes.every((code) => ELIGIBLE_ISSUE_CODES.includes(code));
}

function consistentScopeValue(objects, key) {
  const values = objects
    .map((object) => object?.[key])
    .filter((value) => value !== undefined && value !== null);
  if (values.length === 0) return { value: undefined, conflict: false };
  return {
    value: values[0],
    conflict: values.some((value) => value !== values[0]),
  };
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function consistentScopeArray(objects, key) {
  const values = objects
    .map((object) => object?.[key])
    .filter((value) => value !== undefined && value !== null);
  if (values.length === 0) return { value: undefined, conflict: false };
  return {
    value: values[0],
    conflict: values.some((value) => !sameJson(value, values[0])),
  };
}

export function normalizeSentryEvent(payload, rawBody) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const metricAlert = data.metric_alert && typeof data.metric_alert === 'object'
    ? data.metric_alert
    : {};
  const alertRule = metricAlert.alert_rule && typeof metricAlert.alert_rule === 'object'
    ? metricAlert.alert_rule
    : {};
  const scopeObjects = [metricAlert, alertRule];
  const aggregate = consistentScopeValue(scopeObjects, 'aggregate');
  const timeWindow = consistentScopeValue(scopeObjects, 'time_window');
  const triggers = consistentScopeArray(scopeObjects, 'triggers');
  const bodyFingerprint = createHash('sha256').update(rawBody).digest('hex');
  const signedTimestamp = firstString(payload, [
    ['timestamp'],
    ['sent_at'],
    ['sentAt'],
  ]);

  return {
    eventId: bodyFingerprint,
    bodyFingerprint,
    metricAlertId: scalarIdentifier(metricAlert.id),
    installationId: scalarIdentifier(readPath(payload, ['installation', 'uuid'])),
    organizationId: scalarIdentifier(metricAlert.organization_id),
    alertRuleOrganizationId: scalarIdentifier(alertRule.organization_id),
    projectIds: projectIdentifiers(metricAlert.projects),
    alertRuleProjectIds: projectIdentifiers(alertRule.projects),
    environment: typeof alertRule.environment === 'string' ? alertRule.environment.trim() : undefined,
    ruleId: scalarIdentifier(alertRule.id),
    query: typeof alertRule.query === 'string' ? alertRule.query.trim() : undefined,
    metricAggregate: aggregate.value,
    metricTimeWindowMinutes: timeWindow.value,
    metricTriggers: triggers.value,
    metricScopeConflict: aggregate.conflict || timeWindow.conflict || triggers.conflict,
    action: typeof payload.action === 'string' ? payload.action.trim() : undefined,
    signedTimestamp,
    timestamp: signedTimestamp,
  };
}

export function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10 ** 11 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10 ** 11 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function getEventTimestamp(payload, headers) {
  const headerValue = TIMESTAMP_HEADERS
    .map((name) => getHeader(headers, name))
    .find((value) => typeof value === 'string' && value.trim());
  const payloadValue = firstString(payload, [
    ['timestamp'],
    ['sent_at'],
    ['sentAt'],
    ['data', 'timestamp'],
  ]);
  return parseTimestamp(headerValue ?? payloadValue);
}

export function isTimestampFresh(timestampMs, nowMs = Date.now()) {
  return Number.isFinite(timestampMs)
    && Math.abs(nowMs - timestampMs) <= WEBHOOK_TIMESTAMP_TOLERANCE_MS;
}

export function readReceiverConfig(env = process.env) {
  const environment = env.SENTRY_ENVIRONMENT?.trim();
  const allowedResources = parseCsv(env.SENTRY_ALLOWED_RESOURCES, [ELIGIBLE_RESOURCE]);
  const allowedActions = parseCsv(env.SENTRY_ALLOWED_ACTIONS, [ELIGIBLE_ACTION]);
  const allowedRoutes = parseCsv(env.SENTRY_ALLOWED_ROUTES, [ROUTES.SHARED]);
  return {
    enabled: parseBoolean(env.FAILOVER_ENABLED, false),
    installationId: env.SENTRY_INSTALLATION_ID?.trim(),
    organizationId: env.SENTRY_ORGANIZATION_ID?.trim() ?? env.SENTRY_ORG_ID?.trim(),
    projectId: env.SENTRY_PROJECT_ID?.trim(),
    environment,
    ruleIds: parseCsv(env.SENTRY_RULE_IDS),
    allowedResources,
    allowedActions,
    allowedRoutes,
  };
}

export function isAllowedSentryEvent(event, config) {
  if (!event || !config) return { allowed: false, reason: 'invalid_event' };
  if (!event.bodyFingerprint || !SHA256_HEX_PATTERN.test(event.bodyFingerprint)) {
    return { allowed: false, reason: 'event_fingerprint_missing' };
  }
  if (!event.metricAlertId) {
    return { allowed: false, reason: 'metric_alert_id_missing' };
  }
  if (!config.installationId || event.installationId !== config.installationId) {
    return { allowed: false, reason: 'installation_not_allowed' };
  }
  if (
    !config.organizationId
    || event.organizationId !== config.organizationId
    || event.alertRuleOrganizationId !== config.organizationId
  ) {
    return { allowed: false, reason: 'organization_not_allowed' };
  }
  if (
    !config.projectId
    || !Array.isArray(event.projectIds)
    || event.projectIds.length !== 1
    || event.projectIds[0] !== config.projectId
    || !Array.isArray(event.alertRuleProjectIds)
    || event.alertRuleProjectIds.length !== 1
    || event.alertRuleProjectIds[0] !== config.projectId
  ) {
    return { allowed: false, reason: 'project_not_allowed' };
  }
  if (!config.environment || event.environment !== config.environment) {
    return { allowed: false, reason: 'environment_not_allowed' };
  }
  if (!Array.isArray(config.ruleIds) || !config.ruleIds.includes(event.ruleId)) {
    return { allowed: false, reason: 'rule_not_allowed' };
  }
  if (event.resource !== ELIGIBLE_RESOURCE) {
    return { allowed: false, reason: 'resource_not_eligible' };
  }
  if (!Array.isArray(config.allowedResources) || !config.allowedResources.includes(ELIGIBLE_RESOURCE)) {
    return { allowed: false, reason: 'resource_not_allowed' };
  }
  if (!Array.isArray(config.allowedActions) || !config.allowedActions.includes(event.action)) {
    return { allowed: false, reason: 'action_not_allowed' };
  }
  if (event.action !== ELIGIBLE_ACTION) {
    return { allowed: false, reason: 'action_not_eligible' };
  }
  if (event.metricScopeConflict) {
    return { allowed: false, reason: 'metric_scope_conflict' };
  }
  if (event.metricAggregate !== EXPECTED_METRIC_AGGREGATE) {
    return { allowed: false, reason: 'metric_aggregate_not_allowed' };
  }
  if (event.metricTimeWindowMinutes !== EXPECTED_METRIC_TIME_WINDOW_MINUTES) {
    return { allowed: false, reason: 'metric_time_window_not_allowed' };
  }
  if (!Array.isArray(event.metricTriggers)) {
    return { allowed: false, reason: 'metric_triggers_missing' };
  }
  const criticalTriggers = event.metricTriggers.filter((trigger) => (
    trigger && typeof trigger === 'object' && trigger.label === ELIGIBLE_ACTION
  ));
  if (criticalTriggers.length !== 1) {
    return { allowed: false, reason: 'critical_trigger_missing' };
  }
  if (criticalTriggers[0].alert_threshold !== EXPECTED_METRIC_THRESHOLD) {
    return { allowed: false, reason: 'critical_threshold_not_allowed' };
  }
  const sharedRouteConfigured = !Array.isArray(config.allowedRoutes)
    || config.allowedRoutes.some((route) => String(route).toUpperCase() === ROUTES.SHARED);
  if (!sharedRouteConfigured) {
    return { allowed: false, reason: 'route_not_allowed' };
  }
  if (!isFailoverEligibleQuery(event.query)) {
    return { allowed: false, reason: 'query_not_eligible' };
  }
  return { allowed: true, reason: 'eligible' };
}

export function isEligibleAlert(message, config = {}) {
  const action = message?.action;
  const resource = message?.resource;
  const environment = message?.environment;
  const allowedEnvironment = config.environment;
  const resources = config.allowedResources ?? [ELIGIBLE_RESOURCE];
  const actions = config.allowedActions ?? [ELIGIBLE_ACTION];
  const ruleIds = config.ruleIds ?? [];
  const routes = config.allowedRoutes ?? [ROUTES.SHARED];
  return Boolean(
    message?.failoverEligible === true
    && message?.signalClass === FAILOVER_SIGNAL_CLASS
    && typeof message?.bodyFingerprint === 'string'
    && SHA256_HEX_PATTERN.test(message.bodyFingerprint)
    && action === ELIGIBLE_ACTION
    && Array.isArray(actions)
    && actions.includes(ELIGIBLE_ACTION)
    && resource === ELIGIBLE_RESOURCE
    && Array.isArray(resources)
    && resources.includes(ELIGIBLE_RESOURCE)
    && environment === allowedEnvironment
    && Array.isArray(ruleIds)
    && ruleIds.includes(message?.ruleId)
    && Array.isArray(routes)
    && routes.some((route) => String(route).toUpperCase() === ROUTES.SHARED),
  );
}

export function isBodyFingerprint(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

export function isOpaqueUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value);
}

export class WebhookValidationError extends Error {
  constructor(code, statusCode) {
    super(code);
    this.name = 'WebhookValidationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
