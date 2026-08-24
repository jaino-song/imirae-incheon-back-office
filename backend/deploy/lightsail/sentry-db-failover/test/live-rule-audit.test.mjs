import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditLiveMetricAlertRules,
  parseAuditConfig,
  validateLiveMetricAlertRule,
  validateLiveProject,
} from '../scripts/audit-sentry-rule.mjs';

const INSTALLATION_ID = '11111111-2222-3333-4444-555555555555';
const config = Object.freeze({
  authToken: 'test-token',
  environment: 'production',
  installationId: INSTALLATION_ID,
  organizationId: '1234',
  projectId: '4321',
  projectSlug: 'babyjamjam-admin',
  ruleIds: ['5678'],
});

function validRule(overrides = {}) {
  return {
    id: '5678',
    organizationId: '1234',
    projects: ['babyjamjam-admin'],
    environment: 'production',
    snooze: false,
    aggregate: 'count()',
    timeWindow: 1,
    query: 'event.type:error db.failover_eligible:true db.route:shared prisma.code:P1001 OR prisma.code:P1017',
    triggers: [{
      label: 'critical',
      alertThreshold: 5,
      actions: [{ type: 'sentry_app', sentryAppInstallationUuid: INSTALLATION_ID }],
    }],
    ...overrides,
  };
}

function expected() {
  return {
    environment: config.environment,
    installationId: config.installationId,
    organizationId: config.organizationId,
    projectSlug: config.projectSlug,
    ruleId: config.ruleIds[0],
  };
}

function validProject(overrides = {}) {
  return {
    id: config.projectId,
    slug: config.projectSlug,
    status: 'active',
    organization: { id: config.organizationId },
    ...overrides,
  };
}

function response(body, { ok = true, contentLength } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    headers: {
      get(name) {
        return name === 'content-length' && contentLength !== undefined
          ? String(contentLength)
          : null;
      },
    },
    async text() {
      return text;
    },
  };
}

test('parses only bounded production or preview audit configuration', () => {
  assert.deepEqual(parseAuditConfig({
    SENTRY_API_TOKEN: 'token',
    SENTRY_EXPECTED_ENVIRONMENT: 'preview',
    SENTRY_INSTALLATION_ID: INSTALLATION_ID,
    SENTRY_ORGANIZATION_ID: '1234',
    SENTRY_PROJECT_ID: '4321',
    SENTRY_PROJECT_SLUG: 'babyjamjam-admin',
    SENTRY_RULE_IDS: '5678,9012',
  }), {
    authToken: 'token',
    environment: 'preview',
    installationId: INSTALLATION_ID,
    organizationId: '1234',
    projectId: '4321',
    projectSlug: 'babyjamjam-admin',
    ruleIds: ['5678', '9012'],
  });

  for (const env of [
    {},
    { ...process.env, SENTRY_API_TOKEN: '', SENTRY_EXPECTED_ENVIRONMENT: 'production', SENTRY_INSTALLATION_ID: INSTALLATION_ID, SENTRY_ORGANIZATION_ID: '1', SENTRY_PROJECT_ID: '3', SENTRY_PROJECT_SLUG: 'p', SENTRY_RULE_IDS: '2' },
    { ...process.env, SENTRY_API_TOKEN: 't', SENTRY_EXPECTED_ENVIRONMENT: 'other', SENTRY_INSTALLATION_ID: INSTALLATION_ID, SENTRY_ORGANIZATION_ID: '1', SENTRY_PROJECT_ID: '3', SENTRY_PROJECT_SLUG: 'p', SENTRY_RULE_IDS: '2' },
    { ...process.env, SENTRY_API_TOKEN: 't', SENTRY_EXPECTED_ENVIRONMENT: 'production', SENTRY_INSTALLATION_ID: INSTALLATION_ID, SENTRY_ORGANIZATION_ID: 'org', SENTRY_PROJECT_ID: '3', SENTRY_PROJECT_SLUG: 'p', SENTRY_RULE_IDS: '2' },
    { ...process.env, SENTRY_API_TOKEN: 't', SENTRY_EXPECTED_ENVIRONMENT: 'production', SENTRY_INSTALLATION_ID: 'invalid', SENTRY_ORGANIZATION_ID: '1', SENTRY_PROJECT_ID: '3', SENTRY_PROJECT_SLUG: 'p', SENTRY_RULE_IDS: '2' },
    { ...process.env, SENTRY_API_TOKEN: 't', SENTRY_EXPECTED_ENVIRONMENT: 'production', SENTRY_INSTALLATION_ID: INSTALLATION_ID, SENTRY_ORGANIZATION_ID: '1', SENTRY_PROJECT_ID: '3', SENTRY_PROJECT_SLUG: 'p', SENTRY_RULE_IDS: '2,2' },
  ]) {
    assert.throws(() => parseAuditConfig(env), /audit failed/);
  }
});

test('accepts the exact live metric alert rule contract', () => {
  assert.deepEqual(validateLiveMetricAlertRule(validRule(), expected()), {
    environment: 'production',
    ruleId: '5678',
  });
  assert.doesNotThrow(() => validateLiveMetricAlertRule(validRule({
    triggers: [
      { label: 'critical', alertThreshold: 5, actions: [{ type: 'sentry_app', sentryAppInstallationUuid: INSTALLATION_ID }] },
      { label: 'warning', alertThreshold: 3 },
    ],
  }), expected()));
});

test('fails closed on identity, scope, enabled state, metric, trigger, and query drift', async (t) => {
  const cases = [
    ['wrong id', { id: '9999' }],
    ['wrong organization', { organizationId: '9999' }],
    ['multiple projects', { projects: ['babyjamjam-admin', 'other'] }],
    ['wrong project', { projects: ['other'] }],
    ['wrong environment', { environment: 'preview' }],
    ['snoozed', { snooze: true }],
    ['missing snooze', { snooze: undefined }],
    ['wrong aggregate', { aggregate: 'sum(quantity)' }],
    ['wrong window', { timeWindow: 5 }],
    ['wrong threshold', { triggers: [{ label: 'critical', alertThreshold: 4, actions: [] }] }],
    ['multiple critical triggers', { triggers: [{ label: 'critical', alertThreshold: 5, actions: [] }, { label: 'critical', alertThreshold: 5, actions: [] }] }],
    ['unknown trigger', { triggers: [{ label: 'critical', alertThreshold: 5, actions: [] }, { label: 'other', alertThreshold: 3 }] }],
    ['missing Sentry App action', { triggers: [{ label: 'critical', alertThreshold: 5, actions: [] }] }],
    ['wrong installation', { triggers: [{ label: 'critical', alertThreshold: 5, actions: [{ type: 'sentry_app', sentryAppInstallationUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] }] }],
    ['P2024', { query: 'db.failover_eligible:true db.route:shared prisma.code:P2024' }],
    ['free text P1001', { query: 'db.failover_eligible:true db.route:shared message:P1001' }],
    ['aliased P1001', { query: 'db.failover_eligible:true db.route:shared not_prisma_code:P1001' }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, () => {
      assert.throws(() => validateLiveMetricAlertRule(validRule(overrides), expected()), /audit failed/);
    });
  }
});

test('requires the project slug to map to the exact active project and organization', () => {
  assert.deepEqual(validateLiveProject(validProject(), {
    organizationId: config.organizationId,
    projectId: config.projectId,
    projectSlug: config.projectSlug,
  }), {
    projectId: config.projectId,
    projectSlug: config.projectSlug,
  });
  for (const overrides of [
    { id: '9999' },
    { slug: 'other' },
    { status: 'disabled' },
    { organization: { id: '9999' } },
  ]) {
    assert.throws(() => validateLiveProject(validProject(overrides), {
      organizationId: config.organizationId,
      projectId: config.projectId,
      projectSlug: config.projectSlug,
    }), /audit failed/);
  }
});

test('performs a bounded authenticated read-only GET without leaking the token', async () => {
  const calls = [];
  const results = await auditLiveMetricAlertRules({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(url.pathname.includes('/projects/') ? validProject() : validRule());
    },
  });

  assert.deepEqual(results, [{ environment: 'production', ruleId: '5678' }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/0/projects/1234/babyjamjam-admin/',
    '/api/0/organizations/1234/alert-rules/5678/',
  ]);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://sentry.io');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
  }
  assert.equal(JSON.stringify(results).includes(config.authToken), false);
});

test('fails closed on timeout, non-2xx, malformed JSON, and oversized responses', async (t) => {
  const cases = [
    ['timeout', () => new Promise(() => {}), 5],
    ['non-2xx', async () => response({}, { ok: false }), 100],
    ['malformed JSON', async () => response('{'), 100],
    ['oversized declared body', async () => response('{}', { contentLength: 200_000 }), 100],
    ['oversized actual body', async () => response('x'.repeat(200_000)), 100],
  ];
  for (const [name, fetchImpl, timeoutMs] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        auditLiveMetricAlertRules({ config, fetchImpl, timeoutMs }),
        /audit failed/,
      );
    });
  }
});
