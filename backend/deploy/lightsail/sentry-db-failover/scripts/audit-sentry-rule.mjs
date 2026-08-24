import { pathToFileURL } from 'node:url';

import { isFailoverEligibleQuery } from '../src/security.mjs';

const SENTRY_API_ORIGIN = 'https://sentry.io';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const ALLOWED_ENVIRONMENTS = new Set(['preview', 'production']);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(reason) {
  throw new Error(`Sentry metric alert rule audit failed: ${reason}`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSafeIdentifier(value, name, pattern = SAFE_IDENTIFIER_PATTERN) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`${name} is missing or invalid`);
  }
  return value;
}

export function parseAuditConfig(env = process.env) {
  const authToken = typeof env.SENTRY_API_TOKEN === 'string'
    ? env.SENTRY_API_TOKEN.trim()
    : '';
  if (!authToken) {
    fail('SENTRY_API_TOKEN is required');
  }

  const organizationId = requireSafeIdentifier(
    env.SENTRY_ORGANIZATION_ID,
    'SENTRY_ORGANIZATION_ID',
    NUMERIC_IDENTIFIER_PATTERN,
  );
  const projectSlug = requireSafeIdentifier(env.SENTRY_PROJECT_SLUG, 'SENTRY_PROJECT_SLUG');
  const projectId = requireSafeIdentifier(
    env.SENTRY_PROJECT_ID,
    'SENTRY_PROJECT_ID',
    NUMERIC_IDENTIFIER_PATTERN,
  );
  const installationId = requireSafeIdentifier(
    env.SENTRY_INSTALLATION_ID,
    'SENTRY_INSTALLATION_ID',
    UUID_PATTERN,
  );
  const environment = requireSafeIdentifier(
    env.SENTRY_EXPECTED_ENVIRONMENT,
    'SENTRY_EXPECTED_ENVIRONMENT',
  );
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail('SENTRY_EXPECTED_ENVIRONMENT must be preview or production');
  }

  const rawRuleIds = typeof env.SENTRY_RULE_IDS === 'string'
    ? env.SENTRY_RULE_IDS.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  if (rawRuleIds.length === 0 || rawRuleIds.some((value) => !NUMERIC_IDENTIFIER_PATTERN.test(value))) {
    fail('SENTRY_RULE_IDS must contain numeric rule IDs');
  }
  if (new Set(rawRuleIds).size !== rawRuleIds.length) {
    fail('SENTRY_RULE_IDS must not contain duplicates');
  }

  return {
    authToken,
    organizationId,
    installationId,
    projectId,
    projectSlug,
    environment,
    ruleIds: rawRuleIds,
  };
}

function requireExactProjects(projects, expectedProjectSlug) {
  if (
    !Array.isArray(projects)
    || projects.length !== 1
    || projects[0] !== expectedProjectSlug
  ) {
    fail('project scope does not match the protected environment');
  }
}

function requireCriticalTrigger(triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    fail('triggers are missing');
  }
  if (triggers.some((trigger) => !isRecord(trigger) || !['critical', 'warning'].includes(trigger.label))) {
    fail('trigger scope is invalid');
  }

  const criticalTriggers = triggers.filter((trigger) => trigger.label === 'critical');
  if (criticalTriggers.length !== 1 || criticalTriggers[0].alertThreshold !== 5) {
    fail('the critical trigger must have threshold 5');
  }
  return criticalTriggers[0];
}

function requireSentryAppInstallation(criticalTrigger, installationId) {
  if (!Array.isArray(criticalTrigger.actions)) {
    fail('critical trigger actions are missing');
  }
  const matchingActions = criticalTrigger.actions.filter((action) => (
    isRecord(action)
    && action.type === 'sentry_app'
    && action.sentryAppInstallationUuid === installationId
  ));
  if (matchingActions.length !== 1) {
    fail('critical trigger Sentry App installation does not match');
  }
}

export function validateLiveProject(project, expected) {
  if (!isRecord(project)) {
    fail('project response is not an object');
  }
  if (String(project.id ?? '') !== expected.projectId || project.slug !== expected.projectSlug) {
    fail('project identity does not match');
  }
  if (!isRecord(project.organization) || String(project.organization.id ?? '') !== expected.organizationId) {
    fail('project organization does not match');
  }
  if (project.status !== 'active') {
    fail('project is not active');
  }

  return {
    projectId: expected.projectId,
    projectSlug: expected.projectSlug,
  };
}

export function validateLiveMetricAlertRule(rule, expected) {
  if (!isRecord(rule)) {
    fail('response is not an object');
  }
  if (String(rule.id ?? '') !== expected.ruleId) {
    fail('rule identity does not match');
  }
  if (String(rule.organizationId ?? '') !== expected.organizationId) {
    fail('organization scope does not match');
  }
  requireExactProjects(rule.projects, expected.projectSlug);
  if (rule.environment !== expected.environment) {
    fail('environment scope does not match');
  }
  if (rule.snooze !== false) {
    fail('rule is disabled or snoozed');
  }
  if (rule.aggregate !== 'count()') {
    fail('aggregate must be count()');
  }
  if (rule.timeWindow !== 1) {
    fail('time window must be one minute');
  }
  const criticalTrigger = requireCriticalTrigger(rule.triggers);
  requireSentryAppInstallation(criticalTrigger, expected.installationId);
  if (typeof rule.query !== 'string' || !isFailoverEligibleQuery(rule.query)) {
    fail('query is not failover eligible');
  }

  return {
    ruleId: expected.ruleId,
    environment: expected.environment,
  };
}

async function fetchBoundedJson({
  authToken,
  endpoint,
  fetchImpl,
  timeoutMs,
}) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response || response.ok !== true) {
        throw new Error('non-2xx');
      }
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error('oversized');
      }
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('oversized');
      }
      return JSON.parse(body);
    })();
    return await Promise.race([request, timeout]);
  } catch {
    fail('live Sentry API request did not return a valid bounded response');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function auditLiveMetricAlertRules({
  config,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') {
    fail('fetch is unavailable');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
    fail('request timeout is invalid');
  }

  const results = [];
  const projectEndpoint = new URL(
    `/api/0/projects/${encodeURIComponent(config.organizationId)}/${encodeURIComponent(config.projectSlug)}/`,
    SENTRY_API_ORIGIN,
  );
  const project = await fetchBoundedJson({
    authToken: config.authToken,
    endpoint: projectEndpoint,
    fetchImpl,
    timeoutMs,
  });
  validateLiveProject(project, {
    organizationId: config.organizationId,
    projectId: config.projectId,
    projectSlug: config.projectSlug,
  });

  for (const ruleId of config.ruleIds) {
    const ruleEndpoint = new URL(
      `/api/0/organizations/${encodeURIComponent(config.organizationId)}/alert-rules/${encodeURIComponent(ruleId)}/`,
      SENTRY_API_ORIGIN,
    );
    const rule = await fetchBoundedJson({
      authToken: config.authToken,
      endpoint: ruleEndpoint,
      fetchImpl,
      timeoutMs,
    });
    results.push(validateLiveMetricAlertRule(rule, {
      environment: config.environment,
      installationId: config.installationId,
      organizationId: config.organizationId,
      projectSlug: config.projectSlug,
      ruleId,
    }));
  }
  return results;
}

async function main() {
  const config = parseAuditConfig();
  const results = await auditLiveMetricAlertRules({ config });
  process.stdout.write(`Sentry metric alert rule audit passed for ${results.length} rule(s).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Sentry metric alert rule audit failed.\n');
    process.exitCode = 1;
  });
}
