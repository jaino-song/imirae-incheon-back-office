import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import {
  CONTROLLER_BIND_HOST,
  CONTROLLER_PORT,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_CONNECTIONS,
  REQUEST_TIMEOUT_MS,
  parseControllerConfig,
} from '../config.mjs';
import {
  createControllerServer,
  startControllerServer,
} from '../server.mjs';

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

function payload() {
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
  };
}

function signedRequest() {
  const body = JSON.stringify(payload());
  const signature = createHmac('sha256', TEST_SIGNING_KEY).update(body, 'utf8').digest('hex');
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'request-id': 'provider-request-1',
      'sentry-hook-resource': 'event_alert',
      'sentry-hook-timestamp': String(Math.floor(NOW / 1000)),
      'sentry-hook-signature': signature,
    },
  };
}

function httpCall({ method = 'GET', path = '/health', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: CONTROLLER_BIND_HOST,
      port: CONTROLLER_PORT,
      method,
      path,
      headers: { connection: 'close', ...headers },
    }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: chunks.join(''),
        json: chunks.length > 0 ? JSON.parse(chunks.join('')) : undefined,
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

test('starts on the fixed loopback address and invokes resumePending without promotion', async () => {
  const calls = [];
  const controller = await startControllerServer({
    env: VALID_ENV,
    now: () => NOW,
    resumePending: async () => {
      calls.push('resume');
      return { canPromoteToFallback: true };
    },
    acceptAuthenticatedEvent: async (event) => {
      calls.push(event.bodyFingerprint);
      return { accepted: true };
    },
  });
  try {
    assert.deepEqual(calls.slice(0, 1), ['resume']);
    assert.deepEqual(controller.address(), { address: CONTROLLER_BIND_HOST, family: 'IPv4', port: CONTROLLER_PORT });
    assert.equal(controller.server.requestTimeout, REQUEST_TIMEOUT_MS);
    assert.equal(controller.server.headersTimeout, HEADERS_TIMEOUT_MS);
    assert.equal(controller.server.keepAliveTimeout, KEEP_ALIVE_TIMEOUT_MS);
    assert.equal(controller.server.maxConnections, MAX_CONNECTIONS);

    const health = await httpCall();
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json, { status: 'ok' });

    const webhook = signedRequest();
    const result = await httpCall({
      method: 'POST',
      path: '/sentry/uptime-alert',
      body: webhook.body,
      headers: { ...webhook.headers, 'content-length': Buffer.byteLength(webhook.body) },
    });
    assert.equal(result.statusCode, 202);
    assert.deepEqual(result.json, { accepted: true, duplicate: false });
    assert.equal(calls.length, 2);
  } finally {
    await controller.stop();
  }
});

test('startup is idempotent and stop is safe when called more than once', async () => {
  let resumes = 0;
  const controller = createControllerServer({
    env: VALID_ENV,
    resumePending: async () => { resumes += 1; },
    acceptAuthenticatedEvent: async () => ({ accepted: true }),
  });
  await Promise.all([controller.start(), controller.start()]);
  try {
    assert.equal(resumes, 1);
  } finally {
    await controller.stop();
    await controller.stop();
  }
});

test('resumePending failure prevents startup and does not mutate route state', async () => {
  const controller = createControllerServer({
    env: VALID_ENV,
    resumePending: async () => { throw new Error('state failure'); },
    acceptAuthenticatedEvent: async () => ({ accepted: true }),
  });
  await assert.rejects(controller.start(), /state failure/);
  assert.equal(controller.server.listening, false);
  await controller.stop();
});

test('disabled server can be started without worker callback and returns generic health/POST responses', async () => {
  const controller = await startControllerServer({ env: {}, resumePending: async () => {} });
  try {
    const health = await httpCall();
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json, { status: 'disabled' });
    const result = await httpCall({
      method: 'POST',
      path: '/sentry/uptime-alert',
      body: '{}',
      headers: { 'content-type': 'application/json', 'content-length': '2' },
    });
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json, { accepted: false, statusCode: 503 });
  } finally {
    await controller.stop();
  }
});
