import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { parseControllerConfig } from '../config.mjs';
import {
  HTTP_STATUS,
  ReceiverError,
  createReceiverHandler,
} from '../receiver.mjs';

const NOW = Date.parse('2026-08-31T00:00:00.000Z');
const TEST_SIGNING_KEY = 'unit-test-signing-key';
const INSTALLATION_ID = '00000000-0000-4000-8000-000000000010';

const VALID_ENV = Object.freeze({
  FAILOVER_CONTROLLER_ENABLED: 'true',
  FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'true',
  FAILOVER_SENTRY_CLIENT_SECRET: TEST_SIGNING_KEY,
  FAILOVER_SENTRY_INSTALLATION_ID: INSTALLATION_ID,
  FAILOVER_SENTRY_ORGANIZATION_ID: '1234',
  FAILOVER_SENTRY_PROJECT_ID: '5678',
  FAILOVER_SENTRY_ALERT_ID: '91011',
  FAILOVER_PRIMARY_HEALTH_URL: 'https://api.babyjamjam.com/health/ready',
  FAILOVER_FALLBACK_HEALTH_URL: 'http://127.0.0.1:3101/health/ready',
  FAILOVER_VERCEL_API_TOKEN: 'unit-test-vercel-token',
  FAILOVER_VERCEL_TEAM_ID: 'team_test',
  FAILOVER_VERCEL_DNS_RECORD_ID: 'rec_test',
  FAILOVER_PRIMARY_IPV4: '8.8.8.8',
  FAILOVER_FALLBACK_IPV4: '1.1.1.1',
});

function payload(overrides = {}) {
  return {
    action: 'triggered',
    actor: { type: 'application', id: 'sentry', name: 'Sentry' },
    data: {
      event: {
        event_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        issue_id: '424242',
        project: 5678,
        timestamp: NOW / 1000,
        datetime: new Date(NOW).toISOString(),
      },
      triggered_rule: 'Fallback Server Uptime outage',
      issue_alert: { id: 91011, title: 'Fallback Server Uptime outage', settings: [] },
    },
    installation: { uuid: INSTALLATION_ID },
    ...overrides,
  };
}

function request(body = payload(), headers = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = createHmac('sha256', TEST_SIGNING_KEY).update(rawBody, 'utf8').digest('hex');
  return {
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'request-id': 'provider-request-1',
      'sentry-hook-resource': 'event_alert',
      'sentry-hook-timestamp': String(Math.floor(NOW / 1000)),
      'sentry-hook-signature': signature,
      ...headers,
    },
  };
}

function mockRequest({ method = 'POST', url = '/sentry/uptime-alert', body = '', headers = {} } = {}) {
  const requestStream = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')]);
  requestStream.method = method;
  requestStream.url = url;
  requestStream.headers = headers;
  return requestStream;
}

function mockResponse() {
  return {
    headersSent: false,
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.headersSent = true;
      this.body = value;
    },
  };
}

async function invoke(handler, options) {
  const req = mockRequest(options);
  const res = mockResponse();
  await handler(req, res);
  return { req, res, body: res.body ? JSON.parse(res.body) : undefined };
}

function enabledConfig() {
  return parseControllerConfig(VALID_ENV);
}

test('returns 503 while disabled and exposes only generic health status', async () => {
  const handler = createReceiverHandler({ config: parseControllerConfig({}) });
  const health = await invoke(handler, { method: 'GET', url: '/health' });
  assert.equal(health.res.statusCode, HTTP_STATUS.OK);
  assert.deepEqual(health.body, { status: 'disabled' });

  const disabled = await invoke(handler, {
    ...request(),
    method: 'POST',
    url: '/sentry/uptime-alert',
  });
  assert.equal(disabled.res.statusCode, HTTP_STATUS.SERVICE_UNAVAILABLE);
  assert.deepEqual(disabled.body, { accepted: false, statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE });
});

test('authenticates then durably accepts an event before returning 202', async () => {
  const config = enabledConfig();
  const seen = [];
  const handler = createReceiverHandler({
    config,
    now: () => NOW,
    acceptAuthenticatedEvent: async (event) => {
      seen.push(event);
      return { accepted: true, duplicate: false };
    },
  });
  const result = await invoke(handler, request());
  assert.equal(result.res.statusCode, HTTP_STATUS.ACCEPTED);
  assert.deepEqual(result.body, { accepted: true, duplicate: false });
  assert.equal(seen.length, 1);
  assert.match(seen[0].bodyFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(seen[0].resource, 'event_alert');
  assert.equal(seen[0].action, 'triggered');
});

test('recognizes a durable duplicate and still returns 202', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    acceptAuthenticatedEvent: async () => ({ accepted: false, duplicate: true }),
  });
  const result = await invoke(handler, request());
  assert.equal(result.res.statusCode, HTTP_STATUS.ACCEPTED);
  assert.deepEqual(result.body, { accepted: true, duplicate: true });
});

test('does not acknowledge a callback that failed to durably accept the event', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    acceptAuthenticatedEvent: async () => ({ accepted: false, duplicate: false }),
  });
  const result = await invoke(handler, request());
  assert.equal(result.res.statusCode, HTTP_STATUS.SERVICE_UNAVAILABLE);
  assert.deepEqual(result.body, { accepted: false, statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE });
});

test('maps typed blocked/config callback failures to generic 503 responses', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    acceptAuthenticatedEvent: async () => {
      throw Object.assign(new Error('do not expose this'), { blocked: true, code: 'DNS_DRIFT' });
    },
  });
  const result = await invoke(handler, request());
  assert.equal(result.res.statusCode, HTTP_STATUS.SERVICE_UNAVAILABLE);
  assert.deepEqual(result.body, { accepted: false, statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE });
  assert.doesNotMatch(result.res.body, /expose|DNS_DRIFT|api\.babyjamjam/);
});

test('rejects wrong method/path/query/content type without redirects or details', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    acceptAuthenticatedEvent: async () => ({ accepted: true }),
  });
  const cases = [
    { method: 'PUT', url: '/sentry/uptime-alert', expected: HTTP_STATUS.METHOD_NOT_ALLOWED },
    { method: 'POST', url: '/wrong', expected: HTTP_STATUS.NOT_FOUND },
    { method: 'POST', url: 'http://attacker.example/sentry/uptime-alert', expected: HTTP_STATUS.NOT_FOUND },
    { method: 'POST', url: '/sentry/uptime-alert?redirect=https://attacker.example', expected: HTTP_STATUS.NOT_FOUND },
    { method: 'POST', url: '/sentry/uptime-alert', headers: { 'content-type': 'text/plain' }, expected: HTTP_STATUS.BAD_REQUEST },
  ];
  for (const input of cases) {
    const result = await invoke(handler, { ...request(), ...input, headers: { ...request().headers, ...input.headers } });
    assert.equal(result.res.statusCode, input.expected);
    assert.equal(result.body.accepted, false);
    assert.doesNotMatch(result.res.body, /attacker|redirect|token|secret/);
  }
});

test('rejects oversized request bodies before authentication', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    acceptAuthenticatedEvent: async () => {
      throw new Error('callback must not run');
    },
  });
  const oversizedBody = 'x'.repeat(64 * 1024 + 1);
  const headers = request().headers;
  const result = await invoke(handler, {
    body: oversizedBody,
    headers: { ...headers, 'content-length': String(Buffer.byteLength(oversizedBody)) },
  });
  assert.equal(result.res.statusCode, HTTP_STATUS.PAYLOAD_TOO_LARGE);
  assert.deepEqual(result.body, { accepted: false, statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE });
});

test('requires the callback for enabled mode and never performs DNS itself', () => {
  assert.throws(
    () => createReceiverHandler({ config: enabledConfig() }),
    (error) => error.code === 'CONFIG_ACCEPT_CALLBACK_REQUIRED',
  );
});

test('does not leak provider values when handling an unexpected receiver error', async () => {
  const handler = createReceiverHandler({
    config: enabledConfig(),
    now: () => NOW,
    authenticate: () => {
      throw new ReceiverError('internal-test', HTTP_STATUS.INTERNAL_ERROR);
    },
    acceptAuthenticatedEvent: async () => ({ accepted: true }),
  });
  const result = await invoke(handler, request());
  assert.equal(result.res.statusCode, HTTP_STATUS.INTERNAL_ERROR);
  assert.deepEqual(result.body, { accepted: false, statusCode: HTTP_STATUS.INTERNAL_ERROR });
  assert.doesNotMatch(result.res.body, /provider-request|unit-test|5678|91011/);
});
