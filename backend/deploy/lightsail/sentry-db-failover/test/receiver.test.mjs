import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createReceiverHandler } from '../src/receiver.mjs';

const NOW = Date.parse('2026-08-24T00:00:00.000Z');
const SECRET = 'local-test-client-secret';

function config(overrides = {}) {
  return {
    enabled: true,
    installationId: 'install-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    environment: 'preview',
    ruleIds: ['rule-1'],
    allowedResources: ['metric_alert'],
    allowedActions: ['critical'],
    allowedRoutes: ['SHARED'],
    issueCodes: ['P1001', 'P1017'],
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    event_id: 'evt-1',
    installation_id: 'install-1',
    organization_id: 'org-1',
    project_id: 'project-1',
    environment: 'preview',
    rule_id: 'rule-1',
    resource: 'metric_alert',
    action: 'critical',
    issue_code: 'P1001',
    route: 'SHARED',
    timestamp: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function request(body, overrides = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = createHmac('sha256', SECRET).update(raw).digest('hex');
  return {
    ...overrides,
    headers: {
      'Request-ID': 'request-1',
      'Sentry-Hook-Timestamp': String(NOW),
      'Sentry-Hook-Resource': 'metric_alert',
      'Sentry-Hook-Signature': signature,
      ...overrides.headers,
    },
    body: raw,
  };
}

function createHarness({ sendMessage = async () => {}, handlerConfig = config() } = {}) {
  const calls = [];
  const handler = createReceiverHandler({
    config: handlerConfig,
    queueUrl: 'https://sqs.example.invalid/failover.fifo',
    getClientSecret: async () => SECRET,
    sendMessage: async (input) => {
      calls.push(input);
      return sendMessage(input);
    },
    now: () => NOW,
    idFactory: () => '00000000-0000-4000-8000-000000000001',
    logger: { info() {}, warn() {}, error() {} },
  });
  return { handler, calls };
}

test('enqueues an allowlisted metric alert with a FIFO deduplication key', async () => {
  const { handler, calls } = createHarness();
  const result = await handler(request(payload()));
  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).accepted, true);
  assert.equal(calls.length, 1);
  const input = calls[0];
  assert.equal(input.MessageGroupId, 'preview');
  assert.equal(input.MessageDeduplicationId, 'evt-1');
  const message = JSON.parse(input.MessageBody);
  assert.equal(message.issueCode, 'P1001');
  assert.equal(message.route, 'SHARED');
  assert.equal(message.requestId, 'request-1');
  assert.equal(Object.values(message).some((value) => String(value).includes('sqs.example.invalid')), false);
  assert.equal(Object.values(message).some((value) => String(value).includes(SECRET)), false);
});

test('rejects a missing or tampered HMAC before parsing the event', async (t) => {
  for (const [name, headers] of [
    ['missing', { 'Sentry-Hook-Signature': undefined }],
    ['tampered', { 'Sentry-Hook-Signature': '00'.repeat(32) }],
  ]) {
    await t.test(name, async () => {
      const { handler, calls } = createHarness();
      const result = await handler(request(payload(), { headers }));
      assert.equal(result.statusCode, 401);
      assert.equal(calls.length, 0);
    });
  }
});

test('rejects a missing timestamp header and a timestamp older than five minutes', async (t) => {
  const missing = createHarness();
  const missingResult = await missing.handler(request(payload(), {
    headers: { 'Sentry-Hook-Timestamp': undefined },
  }));
  assert.equal(missingResult.statusCode, 401);
  assert.equal(missing.calls.length, 0);

  const stale = createHarness();
  const staleBody = JSON.stringify(payload());
  const staleSignature = createHmac('sha256', SECRET).update(staleBody).digest('hex');
  const staleResult = await stale.handler({
    body: staleBody,
    headers: {
      'Request-ID': 'request-stale',
      'Sentry-Hook-Timestamp': String(NOW - (5 * 60 * 1000) - 1),
      'Sentry-Hook-Signature': staleSignature,
    },
  });
  assert.equal(staleResult.statusCode, 401);
  assert.equal(stale.calls.length, 0);
});

test('rejects a body over 64 KiB and parsed-body events', async (t) => {
  const oversized = createHarness();
  const body = `${JSON.stringify(payload({ event_id: 'large' }))}${'x'.repeat(64 * 1024)}`;
  const result = await oversized.handler({ body, headers: {} });
  assert.equal(result.statusCode, 413);
  assert.equal(oversized.calls.length, 0);

  const parsed = createHarness();
  const parsedResult = await parsed.handler({ body: payload(), headers: {} });
  assert.equal(parsedResult.statusCode, 400);
  assert.equal(parsed.calls.length, 0);
});

test('ignores wrong allowlists and non-metric actions without queueing', async (t) => {
  for (const overrides of [
    { organization_id: 'other-org' },
    { project_id: 'other-project' },
    { environment: 'production' },
    { rule_id: 'other-rule' },
    { resource: 'http' },
    { action: 'issue_alert' },
    { action: 'resolved' },
    { issue_code: 'P2024' },
    { route: 'DIRECT' },
  ]) {
    await t.test(JSON.stringify(overrides), async () => {
      const { handler, calls } = createHarness();
      const result = await handler(request(payload(overrides)));
      assert.equal(result.statusCode, 202);
      assert.equal(JSON.parse(result.body).accepted, false);
      assert.equal(calls.length, 0);
    });
  }
});

test('returns 5xx when SQS cannot durably accept the message', async () => {
  const { handler, calls } = createHarness({
    sendMessage: async () => {
      throw new Error('queue unavailable');
    },
  });
  const result = await handler(request(payload()));
  assert.equal(result.statusCode, 503);
  assert.equal(calls.length, 1);
});

test('returns 503 when the configured secret has no usable value', async () => {
  const calls = [];
  const handler = createReceiverHandler({
    config: config(),
    queueUrl: 'https://sqs.example.invalid/failover.fifo',
    getClientSecret: async () => null,
    sendMessage: async (input) => calls.push(input),
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  });
  const result = await handler(request(payload()));
  assert.equal(result.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('keeps the one-second webhook budget by timing out a slow queue send', async () => {
  const { handler } = createHarness({
    sendMessage: () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const result = await handler(request(payload()));
  const elapsed = Date.now() - startedAt;
  assert.equal(result.statusCode, 504);
  assert.ok(elapsed < 1000, `receiver exceeded one-second budget: ${elapsed}ms`);
});

test('does not enqueue when the kill switch is disabled after authentication', async () => {
  const { handler, calls } = createHarness({ handlerConfig: config({ enabled: false }) });
  const result = await handler(request(payload()));
  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).accepted, false);
  assert.equal(calls.length, 0);
});

test('uses the official nested metric-alert rule/incident fields and requires the resource header', async () => {
  const { handler, calls } = createHarness();
  const result = await handler(request({
    event_id: 'evt-nested',
    data: {
      metric_alert: {
        alert_rule: {
          id: 'rule-1',
          organization: { id: 'org-1' },
          project: { id: 'project-1' },
          environment: 'preview',
        },
        incident: { short_id: 'P1017' },
      },
      installation_id: 'install-1',
      environment: 'preview',
    },
    action: 'critical',
    timestamp: new Date(NOW).toISOString(),
  }));
  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).accepted, true);
  assert.equal(calls.length, 1);

  const missingResource = createHarness();
  const missingResourceResult = await missingResource.handler(request(payload(), {
    headers: { 'Sentry-Hook-Resource': undefined },
  }));
  assert.equal(missingResourceResult.statusCode, 202);
  assert.equal(missingResource.calls.length, 0);
});
