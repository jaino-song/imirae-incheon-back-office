import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createReceiverHandler } from '../src/receiver.mjs';

const NOW = Date.parse('2026-08-24T00:00:00.000Z');
const SECRET = 'local-test-client-secret';
const INSTALLATION_UUID = '00000000-0000-4000-8000-000000000010';
const DB_FAILOVER_QUERY = 'prisma.code:[P1001,P1017] db.failover_eligible:true db.route:shared';

function config(overrides = {}) {
  return {
    enabled: true,
    installationId: INSTALLATION_UUID,
    organizationId: 'org-1',
    projectId: 'project-1',
    environment: 'preview',
    ruleIds: ['rule-1'],
    allowedResources: ['metric_alert'],
    allowedActions: ['critical'],
    allowedRoutes: ['SHARED'],
    ...overrides,
  };
}

function payload({ metricAlert = {}, alertRule = {}, installation = {}, ...overrides } = {}) {
  return {
    action: 'critical',
    installation: {
      uuid: INSTALLATION_UUID,
      ...installation,
    },
    data: {
      metric_alert: {
        id: 'metric-alert-1',
        organization_id: 'org-1',
        projects: [{ id: 'project-1' }],
        alert_rule: {
          id: 'rule-1',
          organization_id: 'org-1',
          projects: [{ id: 'project-1' }],
          environment: 'preview',
          query: DB_FAILOVER_QUERY,
          aggregate: 'count()',
          time_window: 1,
          triggers: [{ label: 'critical', alert_threshold: 5 }],
          ...alertRule,
        },
        ...metricAlert,
      },
    },
    ...overrides,
  };
}

function request(body, { headers = {}, signature, ...overrides } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const computedSignature = signature === null
    ? undefined
    : (signature ?? createHmac('sha256', SECRET).update(raw).digest('hex'));
  return {
    ...overrides,
    headers: {
      'Request-ID': 'request-1',
      'Sentry-Hook-Timestamp': String(NOW),
      'Sentry-Hook-Resource': 'metric_alert',
      'Sentry-Hook-Signature': computedSignature,
      ...headers,
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

function coldAwsLoaderSource({ delayMs, neverResolve }) {
  const delay = neverResolve
    ? 'await new Promise(() => {});'
    : `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));`;
  const sqsModule = `${delay}
globalThis.__receiverInitCounts = globalThis.__receiverInitCounts ?? { sqs: 0, secrets: 0 };
export class SQSClient {
  constructor() {
    globalThis.__receiverInitCounts.sqs += 1;
  }
  send() {
    return Promise.resolve({});
  }
}
export class SendMessageCommand {
  constructor(input) {
    this.input = input;
  }
}`;
  const secretsModule = `${delay}
globalThis.__receiverInitCounts = globalThis.__receiverInitCounts ?? { sqs: 0, secrets: 0 };
export class SecretsManagerClient {
  constructor() {
    globalThis.__receiverInitCounts.secrets += 1;
  }
  send() {
    return Promise.resolve({ SecretString: '${SECRET}' });
  }
}
export class GetSecretValueCommand {
  constructor(input) {
    this.input = input;
  }
}`;
  return `
const modules = new Map([
  ['@aws-sdk/client-sqs', ${JSON.stringify(sqsModule)}],
  ['@aws-sdk/client-secrets-manager', ${JSON.stringify(secretsModule)}],
]);

export async function resolve(specifier, context, nextResolve) {
  const source = modules.get(specifier);
  if (source === undefined) return nextResolve(specifier, context);
  return {
    shortCircuit: true,
    url: \`data:text/javascript;charset=utf-8,\${encodeURIComponent(source)}\`,
  };
}
`;
}

async function runExportedColdPath({
  delayMs = 0,
  neverResolve = false,
  concurrent = false,
  observeAfterMs = 0,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sentry-receiver-cold-'));
  const loaderPath = join(directory, 'aws-loader.mjs');
  const scriptPath = join(directory, 'invoke-handler.mjs');
  const receiverUrl = new URL('../src/receiver.mjs', import.meta.url).href;
  const requestCount = concurrent ? 2 : 1;
  await writeFile(loaderPath, coldAwsLoaderSource({ delayMs, neverResolve }));
  await writeFile(scriptPath, `
import { handler } from ${JSON.stringify(receiverUrl)};

const startedAt = Date.now();
const results = await Promise.all(Array.from({ length: ${requestCount} }, () => (
  handler({ body: '', headers: {} }, {})
)));
const elapsed = Date.now() - startedAt;
if (${observeAfterMs} > 0) await new Promise((resolve) => setTimeout(resolve, ${observeAfterMs}));
const output = {
  elapsed,
  statuses: results.map(({ statusCode }) => statusCode),
  bodies: results.map(({ body }) => JSON.parse(body)),
  initCounts: globalThis.__receiverInitCounts ?? null,
};
process.stdout.write(JSON.stringify(output), () => process.exit(0));
`);

  try {
    const child = spawn(process.execPath, ['--experimental-loader', loaderPath, scriptPath], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`cold-path child timed out; stderr: ${stderr}`));
      }, 2_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    assert.equal(exitCode.code, 0, `cold-path child failed (${exitCode.signal}): ${stderr}`);
    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('accepts the official metric-alert shape after signed boundary checks', async () => {
  const { handler, calls } = createHarness();
  const body = payload();
  const result = await handler(request(body));
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');

  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).accepted, true);
  assert.equal(calls.length, 1);
  const input = calls[0];
  assert.equal(input.MessageGroupId, 'preview');
  assert.equal(input.MessageDeduplicationId, fingerprint);
  const message = JSON.parse(input.MessageBody);
  assert.equal(message.eventId, fingerprint);
  assert.equal(message.bodyFingerprint, fingerprint);
  assert.equal(message.failoverEligible, true);
  assert.equal(message.signalClass, 'db_failover');
  assert.equal(message.action, 'critical');
  assert.equal(message.resource, 'metric_alert');
  assert.equal(message.environment, 'preview');
  assert.equal(message.ruleId, 'rule-1');
  assert.equal(message.requestId, 'request-1');
  assert.equal('issueCode' in message, false);
  assert.equal('route' in message, false);
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

test('rejects a missing timestamp header and a timestamp older than five minutes', async () => {
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
      'Sentry-Hook-Resource': 'metric_alert',
      'Sentry-Hook-Signature': staleSignature,
    },
  });
  assert.equal(staleResult.statusCode, 401);
  assert.equal(stale.calls.length, 0);
});

test('rejects a body over 64 KiB and parsed-body events', async () => {
  const oversized = createHarness();
  const body = `${JSON.stringify(payload())}${'x'.repeat(64 * 1024)}`;
  const result = await oversized.handler({ body, headers: {} });
  assert.equal(result.statusCode, 413);
  assert.equal(oversized.calls.length, 0);

  const parsed = createHarness();
  const parsedResult = await parsed.handler({ body: payload(), headers: {} });
  assert.equal(parsedResult.statusCode, 400);
  assert.equal(parsed.calls.length, 0);
});

test('rejects missing and wrong official installation, organization, project, environment, and rule values', async (t) => {
  const cases = [
    ['missing installation uuid', payload({ installation: { uuid: undefined } })],
    ['wrong installation uuid', payload({ installation: { uuid: 'other-installation' } })],
    ['missing metric alert id', payload({ metricAlert: { id: undefined } })],
    ['missing metric alert organization', payload({ metricAlert: { organization_id: undefined } })],
    ['wrong metric alert organization', payload({ metricAlert: { organization_id: 'other-org' } })],
    ['missing rule organization', payload({ alertRule: { organization_id: undefined } })],
    ['wrong rule organization', payload({ alertRule: { organization_id: 'other-org' } })],
    ['missing metric alert project membership', payload({ metricAlert: { projects: [] } })],
    ['wrong metric alert project membership', payload({ metricAlert: { projects: [{ id: 'other-project' }] } })],
    ['missing rule project membership', payload({ alertRule: { projects: [] } })],
    ['wrong rule project membership', payload({ alertRule: { projects: [{ id: 'other-project' }] } })],
    ['missing environment', payload({ alertRule: { environment: undefined } })],
    ['wrong environment', payload({ alertRule: { environment: 'production' } })],
    ['missing rule id', payload({ alertRule: { id: undefined } })],
    ['wrong rule id', payload({ alertRule: { id: 'other-rule' } })],
  ];

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const { handler, calls } = createHarness();
      const result = await handler(request(body));
      assert.equal(result.statusCode, 202);
      assert.equal(JSON.parse(result.body).accepted, false);
      assert.equal(calls.length, 0);
    });
  }
});

test('requires the metric-alert resource header and fixed action allowlists', async (t) => {
  for (const [name, body, headers] of [
    ['non-critical action', payload({ action: 'resolved' }), {}],
    ['missing resource header', payload(), { 'Sentry-Hook-Resource': undefined }],
    ['wrong resource header', payload(), { 'Sentry-Hook-Resource': 'issue' }],
  ]) {
    await t.test(name, async () => {
      const { handler, calls } = createHarness();
      const result = await handler(request(body, { headers }));
      assert.equal(result.statusCode, 202);
      assert.equal(JSON.parse(result.body).accepted, false);
      assert.equal(calls.length, 0);
    });
  }
});

test('rejects empty, mixed, and ineligible Prisma code queries or missing markers', async (t) => {
  const cases = [
    ['no Prisma code', 'db.failover_eligible:true db.route:shared'],
    ['P2024 query', 'prisma.code:P2024 db.failover_eligible:true db.route:shared'],
    ['mixed Prisma codes', 'prisma.code:[P1001,P2024] db.failover_eligible:true db.route:shared'],
    ['other Prisma code', 'prisma.code:P2002 db.failover_eligible:true db.route:shared'],
    ['missing eligibility marker', 'prisma.code:[P1001,P1017] db.route:shared'],
    ['missing shared-route marker', 'prisma.code:[P1001,P1017] db.failover_eligible:true'],
  ];
  for (const [name, query] of cases) {
    await t.test(name, async () => {
      const { handler, calls } = createHarness();
      const result = await handler(request(payload({ alertRule: { query } })));
      assert.equal(result.statusCode, 202);
      assert.equal(JSON.parse(result.body).accepted, false);
      assert.equal(calls.length, 0);
    });
  }
});

test('requires the signed metric alert aggregate, one-minute window, critical threshold, and exact project scope', async (t) => {
  const cases = [
    ['missing aggregate', { alertRule: { aggregate: undefined } }],
    ['wrong aggregate', { alertRule: { aggregate: 'sum(quantity)' } }],
    ['missing time window', { alertRule: { time_window: undefined } }],
    ['wrong time window', { alertRule: { time_window: 5 } }],
    ['missing triggers', { alertRule: { triggers: undefined } }],
    ['wrong critical threshold', { alertRule: { triggers: [{ label: 'critical', alert_threshold: 4 }] } }],
    ['missing critical threshold', { alertRule: { triggers: [{ label: 'critical' }] } }],
    ['wrong trigger label', { alertRule: { triggers: [{ label: 'warning', alert_threshold: 5 }] } }],
    ['multiple metric projects', { metricAlert: { projects: [{ id: 'project-1' }, { id: 'other-project' }] } }],
    ['multiple rule projects', { alertRule: { projects: [{ id: 'project-1' }, { id: 'other-project' }] } }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
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

test('keeps the 750 ms end-to-end budget by timing out a slow queue send', async () => {
  let abortSignal;
  const handler = createReceiverHandler({
    config: config(),
    queueUrl: 'https://sqs.example.invalid/failover.fifo',
    getClientSecret: async () => SECRET,
    sendMessage: (_input, { abortSignal: signal } = {}) => {
      abortSignal = signal;
      return new Promise(() => {});
    },
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  });
  const startedAt = Date.now();
  const result = await handler(request(payload()));
  const elapsed = Date.now() - startedAt;
  assert.equal(result.statusCode, 504);
  assert.equal(abortSignal?.aborted, true);
  assert.ok(elapsed < 800, `receiver exceeded total deadline: ${elapsed}ms`);
});

test('enforces one end-to-end deadline around a never-resolving secret fetch', async () => {
  let abortSignal;
  const handler = createReceiverHandler({
    config: config(),
    queueUrl: 'https://sqs.example.invalid/failover.fifo',
    getClientSecret: ({ signal } = {}) => {
      abortSignal = signal;
      return new Promise(() => {});
    },
    sendMessage: async () => {},
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  });
  const startedAt = Date.now();
  const result = await handler(request(payload()));
  const elapsed = Date.now() - startedAt;
  assert.equal(result.statusCode, 504);
  assert.deepEqual(JSON.parse(result.body), { accepted: false });
  assert.equal(abortSignal?.aborted, true);
  assert.ok(elapsed < 800, `receiver exceeded total deadline: ${elapsed}ms`);
});

test('bounds the exported handler when cold AWS client initialization is delayed', async () => {
  const result = await runExportedColdPath({ delayMs: 900, observeAfterMs: 250 });

  assert.deepEqual(result.statuses, [504]);
  assert.deepEqual(result.bodies, [{ accepted: false }]);
  assert.deepEqual(result.initCounts, { sqs: 0, secrets: 0 });
  assert.ok(result.elapsed < 800, `exported receiver exceeded total deadline: ${result.elapsed}ms`);
});

test('bounds the exported handler when cold AWS client initialization never resolves', async () => {
  const result = await runExportedColdPath({ neverResolve: true });

  assert.deepEqual(result.statuses, [504]);
  assert.deepEqual(result.bodies, [{ accepted: false }]);
  assert.equal(result.initCounts, null);
  assert.ok(result.elapsed < 800, `exported receiver exceeded total deadline: ${result.elapsed}ms`);
});

test('shares one cold initialization promise across concurrent exported requests', async () => {
  const result = await runExportedColdPath({ delayMs: 10, concurrent: true });

  assert.deepEqual(result.statuses, [401, 401]);
  assert.deepEqual(result.initCounts, { sqs: 1, secrets: 1 });
  assert.ok(result.elapsed < 800, `concurrent cold requests exceeded total deadline: ${result.elapsed}ms`);
});

test('does not enqueue when the kill switch is disabled after authentication', async () => {
  const { handler, calls } = createHarness({ handlerConfig: config({ enabled: false }) });
  const result = await handler(request(payload()));
  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).accepted, false);
  assert.equal(calls.length, 0);
});

test('reuses the signed body fingerprint when Request-ID and timestamp headers change', async () => {
  const { handler, calls } = createHarness();
  const first = request(payload());
  const replay = request(first.body, {
    signature: first.headers['Sentry-Hook-Signature'],
    headers: {
      'Request-ID': 'request-2',
      'Sentry-Hook-Timestamp': String(NOW + 1_000),
    },
  });

  const firstResult = await handler(first);
  const replayResult = await handler(replay);
  assert.equal(firstResult.statusCode, 202);
  assert.equal(replayResult.statusCode, 202);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].MessageDeduplicationId, calls[1].MessageDeduplicationId);
  assert.equal(JSON.parse(calls[0].MessageBody).requestId, 'request-1');
  assert.equal(JSON.parse(calls[1].MessageBody).requestId, 'request-2');
});
