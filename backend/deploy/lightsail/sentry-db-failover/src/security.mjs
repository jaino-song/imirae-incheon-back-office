import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  ELIGIBLE_ACTION,
  ELIGIBLE_ISSUE_CODES,
  ELIGIBLE_RESOURCE,
  MAX_WEBHOOK_BYTES,
  REJECTED_ISSUE_CODES,
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

  const rawBody = Buffer.from(event.body, 'utf8');
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    throw new WebhookValidationError('body_too_large', 413);
  }
  return rawBody;
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

export function normalizeSentryEvent(payload, rawBody) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const alert = payload.alert && typeof payload.alert === 'object' ? payload.alert : {};
  const event = payload.event && typeof payload.event === 'object' ? payload.event : {};
  const metricAlert = data.metric_alert && typeof data.metric_alert === 'object'
    ? data.metric_alert
    : (payload.metric_alert && typeof payload.metric_alert === 'object' ? payload.metric_alert : {});
  const alertRule = metricAlert.alert_rule && typeof metricAlert.alert_rule === 'object'
    ? metricAlert.alert_rule
    : {};
  const incident = metricAlert.incident && typeof metricAlert.incident === 'object'
    ? metricAlert.incident
    : (data.incident && typeof data.incident === 'object' ? data.incident : {});
  const sources = [payload, data, metricAlert, alertRule, incident, alert, event];
  const fromSources = (paths) => {
    for (const source of sources) {
      const value = firstString(source, paths);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const candidateEventId = fromSources([
    ['event_id'],
    ['eventId'],
    ['id'],
    ['alert_id'],
    ['alertId'],
  ]);
  const eventId = candidateEventId && SAFE_IDENTIFIER_PATTERN.test(candidateEventId)
    ? candidateEventId
    : createHash('sha256').update(rawBody).digest('hex');

  return {
    eventId,
    installationId: fromSources([
      ['installation_id'],
      ['installationId'],
      ['installation', 'id'],
      ['metric_alert', 'installation_id'],
    ]),
    organizationId: fromSources([
      ['organization_id'],
      ['organizationId'],
      ['organization', 'id'],
      ['org_id'],
      ['orgId'],
      ['metric_alert', 'organization', 'id'],
      ['alert_rule', 'organization', 'id'],
    ]),
    projectId: fromSources([
      ['project_id'],
      ['projectId'],
      ['project', 'id'],
      ['metric_alert', 'project', 'id'],
      ['alert_rule', 'project', 'id'],
    ]),
    environment: fromSources([
      ['environment'],
      ['data', 'environment'],
      ['tags', 'environment'],
      ['metric_alert', 'environment'],
      ['alert_rule', 'environment'],
    ]),
    ruleId: fromSources([
      ['rule_id'],
      ['ruleId'],
      ['rule', 'id'],
      ['alert_rule_id'],
      ['alertRuleId'],
      ['metric_alert', 'alert_rule', 'id'],
      ['alert_rule', 'id'],
    ]),
    resource: fromSources([
      ['resource'],
      ['resource_type'],
      ['resourceType'],
      ['alert', 'resource'],
      ['metric_alert', 'resource'],
    ]),
    action: fromSources([
      ['action'],
      ['alert_action'],
      ['alertAction'],
      ['metric_alert', 'action'],
    ]),
    issueCode: fromSources([
      ['issue_code'],
      ['issueCode'],
      ['short_id'],
      ['shortId'],
      ['issue', 'short_id'],
      ['issue', 'shortId'],
      ['alert', 'short_id'],
      ['alert', 'shortId'],
      ['metric_alert', 'incident', 'short_id'],
      ['metric_alert', 'incident', 'shortId'],
      ['metric_alert', 'incident', 'issue', 'short_id'],
      ['metric_alert', 'incident', 'issue', 'shortId'],
      ['incident', 'short_id'],
      ['incident', 'shortId'],
      ['incident', 'issue', 'short_id'],
      ['incident', 'issue', 'shortId'],
    ]),
    route: fromSources([
      ['route'],
      ['active_route'],
      ['activeRoute'],
      ['tags', 'route'],
    ]),
    timestamp: fromSources([
      ['timestamp'],
      ['sent_at'],
      ['sentAt'],
      ['alert', 'timestamp'],
    ]),
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
    issueCodes: [...ELIGIBLE_ISSUE_CODES],
  };
}

export function isAllowedSentryEvent(event, config) {
  if (!event || !config) return { allowed: false, reason: 'invalid_event' };
  if (!config.installationId || event.installationId !== config.installationId) {
    return { allowed: false, reason: 'installation_not_allowed' };
  }
  if (!config.organizationId || event.organizationId !== config.organizationId) {
    return { allowed: false, reason: 'organization_not_allowed' };
  }
  if (!config.projectId || event.projectId !== config.projectId) {
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
  const sharedRouteConfigured = !Array.isArray(config.allowedRoutes)
    || config.allowedRoutes.some((route) => String(route).toUpperCase() === ROUTES.SHARED);
  const routeAllowed = sharedRouteConfigured && (
    event.route === undefined
    || event.route === null
    || event.route === ''
    || String(event.route).toUpperCase() === ROUTES.SHARED
  );
  if (!routeAllowed) {
    return { allowed: false, reason: 'route_not_allowed' };
  }
  if (!ELIGIBLE_ISSUE_CODES.includes(event.issueCode)
    || !Array.isArray(config.issueCodes)
    || !config.issueCodes.includes(event.issueCode)) {
    return {
      allowed: false,
      reason: REJECTED_ISSUE_CODES.includes(event.issueCode) ? 'issue_not_eligible' : 'issue_not_allowed',
    };
  }
  return { allowed: true, reason: 'eligible' };
}

export function isEligibleAlert(message, config = {}) {
  const issueCode = message?.issueCode ?? message?.issue_code;
  const action = message?.action;
  const resource = message?.resource;
  const environment = message?.environment;
  const route = String(message?.route ?? '').toUpperCase();
  const allowedEnvironment = config.environment;
  const resources = config.allowedResources ?? [ELIGIBLE_RESOURCE];
  return Boolean(
    (ELIGIBLE_ISSUE_CODES.includes(issueCode))
    && !REJECTED_ISSUE_CODES.includes(issueCode)
    && action === ELIGIBLE_ACTION
    && resource === ELIGIBLE_RESOURCE
    && resources.includes(ELIGIBLE_RESOURCE)
    && environment === allowedEnvironment
    && (route === '' || route === ROUTES.SHARED),
  );
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
