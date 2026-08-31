import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  MAX_WEBHOOK_BYTES,
  SECURITY_ERROR_CODES,
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  WebhookSecurityError,
  authenticateWebhook,
  constantTimeHexEqual,
  deriveBodyFingerprint,
  deriveRequestCorrelation,
  extractRawBody,
  getSignedEventTimestamp,
  normalizeSignatureHeader,
  parseWebhookJson,
  toPublicError,
  validateIssueAlertEvent,
  validateSecurityConfig,
  verifySignature,
} from '../security.mjs';

const NOW = Date.parse('2026-08-31T00:00:00.000Z');
const TEST_SIGNING_KEY = 'unit-test-signing-key';
const INSTALLATION_ID = '00000000-0000-4000-8000-000000000010';
const CONFIG = {
  installationId: INSTALLATION_ID,
  organizationId: '1234',
  projectId: '5678',
  alertId: '91011',
};

function payload(overrides = {}) {
  return {
    action: 'triggered',
    actor: {
      type: 'application',
      id: 'sentry',
      name: 'Sentry',
    },
    data: {
      event: {
        event_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        issue_id: '424242',
        project: 5678,
        timestamp: NOW / 1000,
        datetime: new Date(NOW).toISOString(),
      },
      triggered_rule: 'Fallback Server Uptime outage',
      issue_alert: {
        id: 91011,
        title: 'Fallback Server Uptime outage',
        settings: [],
      },
    },
    installation: {
      uuid: INSTALLATION_ID,
    },
    ...overrides,
  };
}

function request(body = payload(), overrides = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = createHmac('sha256', TEST_SIGNING_KEY).update(rawBody, 'utf8').digest('hex');
  return {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'Request-ID': 'provider-request-1',
      'Sentry-Hook-Resource': 'event_alert',
      'Sentry-Hook-Timestamp': String(Math.floor(NOW / 1000)),
      'Sentry-Hook-Signature': signature,
      ...overrides,
    },
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof WebhookSecurityError);
    assert.equal(error.code, code);
    return true;
  });
}

test('accepts a signed synthetic documented issue-alert payload', () => {
  const result = authenticateWebhook({
    ...request(),
    clientSecret: TEST_SIGNING_KEY,
    config: CONFIG,
    now: NOW,
  });

  assert.equal(result.action, 'triggered');
  assert.equal(result.resource, 'event_alert');
  assert.equal(result.installationId, INSTALLATION_ID);
  assert.equal(result.projectId, '5678');
  assert.equal(result.alertId, '91011');
  assert.equal(result.organizationId, '1234');
  assert.equal(result.signedTimestampMs, NOW);
  assert.equal(result.headerTimestampMs, NOW);
  assert.equal(result.providerRequestId, 'provider-request-1');
  assert.match(result.requestId, /^fallback-[0-9a-f]{32}$/);
  assert.match(result.bodyFingerprint, /^[0-9a-f]{64}$/);
});

test('verifies raw-body HMAC with fixed-size constant-time comparison', () => {
  const rawBody = JSON.stringify(payload());
  const signature = createHmac('sha256', TEST_SIGNING_KEY).update(rawBody, 'utf8').digest('hex');

  assert.equal(verifySignature(rawBody, signature, TEST_SIGNING_KEY), true);
  assert.equal(verifySignature(`${rawBody} `, signature, TEST_SIGNING_KEY), false);
  assert.equal(verifySignature(rawBody, signature.slice(0, -1), TEST_SIGNING_KEY), false);
  assert.equal(verifySignature(rawBody, `sha256=${signature}`, TEST_SIGNING_KEY), false);
  assert.equal(constantTimeHexEqual(signature, signature.toUpperCase()), true);
  assert.equal(normalizeSignatureHeader('not-a-signature'), null);
});

test('rejects missing, malformed, and tampered signatures without exposing secret details', () => {
  const valid = request();
  const cases = [
    ['missing', { 'Sentry-Hook-Signature': undefined }, SECURITY_ERROR_CODES.SIGNATURE_REQUIRED],
    ['malformed', { 'Sentry-Hook-Signature': 'nope' }, SECURITY_ERROR_CODES.SIGNATURE_INVALID],
    ['tampered', { 'Sentry-Hook-Signature': '0'.repeat(64) }, SECURITY_ERROR_CODES.SIGNATURE_INVALID],
  ];

  for (const [label, headers, code] of cases) {
    assert.throws(
      () => authenticateWebhook({ ...valid, headers: { ...valid.headers, ...headers }, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
      (error) => {
        assert.equal(error.code, code, label);
        assert.doesNotMatch(error.message, /synthetic|secret|provider-request-1|5678|91011/);
        return true;
      },
    );
  }
  expectCode(() => authenticateWebhook({ ...valid, clientSecret: 'wrong-signing-key', config: CONFIG, now: NOW }), SECURITY_ERROR_CODES.SIGNATURE_INVALID);

  const malformedBody = '{"action":"triggered"';
  const malformedSignature = createHmac('sha256', TEST_SIGNING_KEY).update(malformedBody, 'utf8').digest('hex');
  expectCode(
    () => authenticateWebhook({
      body: malformedBody,
      headers: { ...valid.headers, 'Sentry-Hook-Signature': malformedSignature },
      clientSecret: TEST_SIGNING_KEY,
      config: CONFIG,
      now: NOW,
    }),
    SECURITY_ERROR_CODES.INVALID_JSON,
  );
});

test('accepts only a raw string body within the 64 KiB limit', () => {
  assert.equal(extractRawBody('ok'), 'ok');
  expectCode(() => extractRawBody({ action: 'triggered' }), SECURITY_ERROR_CODES.RAW_BODY_REQUIRED);
  expectCode(() => extractRawBody('x'.repeat(MAX_WEBHOOK_BYTES + 1)), SECURITY_ERROR_CODES.BODY_TOO_LARGE);
  expectCode(() => parseWebhookJson('not-json'), SECURITY_ERROR_CODES.INVALID_JSON);
});

test('rejects legacy service-hook and metric-alert resources', () => {
  const valid = request();
  expectCode(
      () => authenticateWebhook({ ...valid, headers: { ...valid.headers, 'Sentry-Hook-Resource': 'metric_alert' }, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
    SECURITY_ERROR_CODES.HOOK_RESOURCE_NOT_ALLOWED,
  );
  expectCode(
      () => authenticateWebhook({ ...valid, headers: { ...valid.headers, 'Sentry-Hook-Resource': 'event.alert' }, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
    SECURITY_ERROR_CODES.HOOK_RESOURCE_NOT_ALLOWED,
  );
  expectCode(
    () => authenticateWebhook({ ...valid, headers: { ...valid.headers, 'X-ServiceHook-Signature': '0'.repeat(64) }, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
    SECURITY_ERROR_CODES.LEGACY_SERVICE_HOOK_REJECTED,
  );
  const bodyWithResource = payload({ resource: 'metric_alert' });
  expectCode(
    () => authenticateWebhook({ ...request(bodyWithResource), clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
    SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY,
  );
  const bodyWithMonitor = payload({ data: { ...payload().data, monitor_id: 'monitor-1' } });
  expectCode(
    () => authenticateWebhook({ ...request(bodyWithMonitor), clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
    SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY,
  );
});

test('rejects every action except triggered', () => {
  for (const action of ['critical', 'warning', 'resolved', 'event.alert', undefined]) {
    const body = payload({ action });
    const requestData = request(body);
    expectCode(
      () => authenticateWebhook({ ...requestData, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }),
      action === undefined ? SECURITY_ERROR_CODES.ACTION_REQUIRED : SECURITY_ERROR_CODES.ACTION_NOT_ALLOWED,
    );
  }
});

test('enforces exact actor and installation/project/organization/alert allowlists', () => {
  const cases = [
    ['wrong actor', payload({ actor: { type: 'user', id: '1', name: 'operator' } }), SECURITY_ERROR_CODES.ACTOR_NOT_ALLOWED],
    ['missing installation', payload({ installation: {} }), SECURITY_ERROR_CODES.INSTALLATION_REQUIRED],
    ['wrong installation', payload({ installation: { uuid: '00000000-0000-4000-8000-000000000011' } }), SECURITY_ERROR_CODES.INSTALLATION_NOT_ALLOWED],
    ['missing project', payload({ data: { ...payload().data, event: { ...payload().data.event, project: undefined } } }), SECURITY_ERROR_CODES.PROJECT_REQUIRED],
    ['wrong project', payload({ data: { ...payload().data, event: { ...payload().data.event, project: 9999 } } }), SECURITY_ERROR_CODES.PROJECT_NOT_ALLOWED],
    ['wrong organization', payload({ data: { ...payload().data, organization_id: '9999' } }), SECURITY_ERROR_CODES.ORGANIZATION_NOT_ALLOWED],
    ['missing alert id', payload({ data: { ...payload().data, issue_alert: { title: 'no id', settings: [] } } }), SECURITY_ERROR_CODES.ALERT_ID_REQUIRED],
    ['wrong alert id', payload({ data: { ...payload().data, issue_alert: { id: 9999, title: 'wrong', settings: [] } } }), SECURITY_ERROR_CODES.ALERT_ID_NOT_ALLOWED],
  ];

  for (const [label, body, code] of cases) {
    const requestData = request(body);
    expectCode(() => authenticateWebhook({ ...requestData, clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }), code);
    assert.notEqual(label, '');
  }
});

test('fails closed when monitor identity is unavailable in the documented event-alert shape', () => {
  expectCode(
    () => validateSecurityConfig({ ...CONFIG, monitorId: 'monitor-1', alertId: undefined }),
    SECURITY_ERROR_CODES.CONFIGURATION_BLOCKED,
  );
  expectCode(
    () => validateSecurityConfig({ ...CONFIG, alertId: undefined }),
    SECURITY_ERROR_CODES.SOURCE_IDENTITY_REQUIRED,
  );

  const validEvent = {
    installationId: INSTALLATION_ID,
    organizationId: '1234',
    projectId: '5678',
    alertId: '91011',
  };
  expectCode(
    () => validateIssueAlertEvent({ ...validEvent, monitorId: 'monitor-1' }, CONFIG),
    SECURITY_ERROR_CODES.UNSUPPORTED_SOURCE_IDENTITY,
  );
});

test('requires signed event timestamps and rejects stale, future, conflicting, or invalid values', () => {
  const withoutTimestamp = payload({
    data: {
      ...payload().data,
      event: { ...payload().data.event, timestamp: undefined, datetime: undefined },
    },
  });
  expectCode(() => getSignedEventTimestamp(withoutTimestamp), SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_REQUIRED);

  for (const [label, timestamp, code] of [
    ['stale', NOW - (WEBHOOK_TIMESTAMP_TOLERANCE_MS + 1), SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_STALE],
    ['future', NOW + (WEBHOOK_TIMESTAMP_TOLERANCE_MS + 1), SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_FUTURE],
  ]) {
    const body = payload({
      data: {
        ...payload().data,
        event: { ...payload().data.event, timestamp: timestamp / 1000, datetime: new Date(timestamp).toISOString() },
      },
    });
    expectCode(() => authenticateWebhook({ ...request(body), clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }), code);
    assert.notEqual(label, '');
  }

  const invalid = payload({ data: { ...payload().data, event: { ...payload().data.event, timestamp: 'not-a-time' } } });
  expectCode(() => authenticateWebhook({ ...request(invalid), clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }), SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_INVALID);

  const conflict = payload({ data: { ...payload().data, event: { ...payload().data.event, datetime: new Date(NOW - 10 * 60 * 1000).toISOString() } } });
  expectCode(() => authenticateWebhook({ ...request(conflict), clientSecret: TEST_SIGNING_KEY, config: CONFIG, now: NOW }), SECURITY_ERROR_CODES.SIGNED_TIMESTAMP_CONFLICT);
});

test('derives a stable body fingerprint and correlation without logging request data', () => {
  const body = JSON.stringify(payload());
  const firstFingerprint = deriveBodyFingerprint(body);
  const secondFingerprint = deriveBodyFingerprint(body);
  assert.equal(firstFingerprint, secondFingerprint);
  assert.match(firstFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(deriveRequestCorrelation(body), deriveRequestCorrelation(body));
  assert.doesNotMatch(deriveRequestCorrelation(body), /synthetic|client-secret|provider-request/);
});

test('returns generic public errors with no secret, signature, or source identity detail', () => {
  const error = new WebhookSecurityError(SECURITY_ERROR_CODES.SIGNATURE_INVALID);
  const response = toPublicError(error);
  assert.deepEqual(response, { statusCode: 401, body: { accepted: false } });
  assert.doesNotMatch(JSON.stringify(response), /unit-test|signing|signature|5678|91011/);
  assert.deepEqual(toPublicError(new Error('internal unit-test signing key')), { statusCode: 500, body: { accepted: false } });
});
