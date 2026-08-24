import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASES, ROUTES, createInitialState } from '../src/constants.mjs';
import { createMemoryStateStore } from '../src/state-store.mjs';
import { createWorkerHandler, createSsmObserver } from '../src/worker.mjs';

const BASE_TIME = Date.parse('2026-08-24T00:00:00.000Z');
const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
];

function config(overrides = {}) {
  return {
    enabled: true,
    environment: 'preview',
    allowedResources: ['metric_alert'],
    stateKey: 'db-failover/preview',
    sharedFailureThreshold: 3,
    directSuccessThreshold: 3,
    directMinimumMs: 60 * 60 * 1000,
    sharedHealthyThreshold: 30,
    emergencySharedSuccessThreshold: 3,
    maxNormalRoundTrips: 3,
    roundTripWindowMs: 6 * 60 * 60 * 1000,
    cooldownMs: 0,
    leaseMs: 1000,
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    eventId: 'event-1',
    issueCode: 'P1001',
    action: 'critical',
    resource: 'metric_alert',
    environment: 'preview',
    route: 'SHARED',
    ruleId: 'rule-1',
    eventAt: BASE_TIME,
    requestId: 'sentry-request-1',
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    messageId: 'sqs-message-1',
    body: JSON.stringify(message()),
    ...overrides,
  };
}

function harness({ initialState, observe, handlerConfig = config(), clock = () => BASE_TIME } = {}) {
  const store = createMemoryStateStore({ initialState, now: BASE_TIME });
  const observed = [];
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return observe ? observe(input) : { controlPlaneOk: true, sharedOk: true, directOk: true };
    },
    config: handlerConfig,
    now: clock,
    ownerFactory: () => 'worker-owner',
    idFactory: () => IDS[0],
    logger: { info() {}, warn() {}, error() {} },
  });
  return { handler, store, observed };
}

test('wakes reconciliation for eligible Sentry messages without passing a route command', async () => {
  const { handler, observed } = harness({
    observe: async () => ({ controlPlaneOk: true, sharedOk: false, directOk: true }),
  });
  const result = await handler({ Records: [record()] }, { awsRequestId: 'lambda-request' });
  assert.equal(result.processed, 1);
  assert.equal(result.batchItemFailures.length, 0);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].trigger, 'sentry');
  assert.equal(observed[0].requestId, IDS[0]);
  assert.deepEqual(observed[0].message, {
    eventId: 'event-1',
    issueCode: 'P1001',
    action: 'critical',
    resource: 'metric_alert',
  });
});

test('deduplicates replayed request IDs and rejects out-of-order events', async () => {
  const { handler, observed } = harness();
  const first = await handler({ Records: [record()] });
  assert.equal(first.processed, 1);
  const duplicate = await handler({ Records: [record({ messageId: 'sqs-message-2' })] });
  assert.equal(duplicate.results[0].reason, 'duplicate_request');
  assert.equal(observed.length, 1);

  const older = await handler({ Records: [
    { messageId: 'sqs-message-3', body: JSON.stringify(message({
      eventId: 'event-old',
      requestId: 'sentry-request-old',
      eventAt: BASE_TIME - 1,
    })) },
  ] });
  assert.equal(older.results[0].reason, 'out_of_order');
  assert.equal(observed.length, 1);
});

test('does not wake reconciliation for P2024, non-DB, direct-route, or wrong-environment messages', async (t) => {
  for (const overrides of [
    { issueCode: 'P2024' },
    { resource: 'http' },
    { route: 'DIRECT' },
    { environment: 'production' },
    { action: 'issue_alert' },
  ]) {
    await t.test(JSON.stringify(overrides), async () => {
      const { handler, observed } = harness();
      const result = await handler({ Records: [
        { messageId: `sqs-${JSON.stringify(overrides)}`, body: JSON.stringify(message(overrides)) },
      ] });
      assert.equal(result.processed, 1);
      assert.equal(result.results[0].status, 'ignored');
      assert.equal(observed.length, 0);
      assert.equal(result.batchItemFailures.length, 0);
    });
  }
});

test('does not let a Sentry wake-up bypass the current direct-route guard', async () => {
  const { handler, observed } = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      activeRoute: ROUTES.DIRECT,
      phase: PHASES.DIRECT_ACTIVE,
    },
  });
  const result = await handler({ Records: [record({
    body: JSON.stringify(message({ route: undefined })),
  })] });
  assert.equal(result.results[0].reason, 'current_route_not_shared');
  assert.equal(observed.length, 0);
});

test('does not invoke SSM after the state machine is terminally blocked', async () => {
  const { handler, observed } = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      phase: PHASES.BLOCKED,
      errorTerminalPhase: PHASES.BLOCKED,
    },
  });
  const result = await handler({ Records: [record()] });
  assert.equal(result.results[0].reason, 'blocked');
  assert.equal(observed.length, 0);
});

test('retries when a lease is held, then acquires it after expiry', async () => {
  let now = BASE_TIME;
  const initialState = {
    ...createInitialState(BASE_TIME),
    leaseOwner: 'other-worker',
    leaseExpiresAt: BASE_TIME + 500,
  };
  const { handler, observed } = harness({ initialState, clock: () => now });
  const held = await handler({ Records: [record()] });
  assert.equal(held.batchItemFailures.length, 1);
  assert.equal(observed.length, 0);

  now += 1000;
  const retried = await handler({ Records: [record()] });
  assert.equal(retried.batchItemFailures.length, 0);
  assert.equal(observed.length, 1);
});

test('scheduled reconciler uses a scheduled trigger and remains route-preserving on AWS failure', async () => {
  const initialState = {
    ...createInitialState(BASE_TIME),
    phase: PHASES.DIRECT_ACTIVE,
    activeRoute: ROUTES.DIRECT,
    directActivatedAt: BASE_TIME,
  };
  const { handler, store, observed } = harness({
    initialState,
    observe: async (input) => {
      assert.equal(input.trigger, 'schedule');
      throw new Error('ssm unavailable');
    },
  });
  const result = await handler({});
  assert.equal(result.processed, 1);
  assert.equal(observed.length, 1);
  const state = store.snapshot();
  assert.equal(state.activeRoute, ROUTES.DIRECT);
  assert.equal(state.phase, PHASES.DEGRADED);
  assert.equal(state.lastErrorCode, 'AWS_CONTROL_PLANE_FAILURE');
});

test('reports malformed queue messages for retry/DLQ rather than acting on them', async () => {
  const { handler, observed } = harness();
  const result = await handler({ Records: [{ messageId: 'bad', body: '{not-json' }] });
  assert.equal(result.batchItemFailures.length, 1);
  assert.equal(observed.length, 0);
});

test('SSM observer sends only the fixed document, exact target tag, and opaque RequestId', async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command.input);
      return { Command: { CommandId: 'command-1' } };
    },
  };
  class SendCommandCommand {
    constructor(input) { this.input = input; }
  }
  class ListCommandInvocationsCommand {
    constructor(input) { this.input = input; }
  }
  const observer = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagKey: 'DeploymentTarget',
    tagValue: 'babyjamjam-preview',
    environment: 'preview',
  });
  const requestId = IDS[0];
  const commandId = await observer.sendFixedCommand(requestId);
  assert.equal(commandId, 'command-1');
  assert.deepEqual(calls[0], {
    DocumentName: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    Targets: [
      { Key: 'tag:DeploymentTarget', Values: ['babyjamjam-preview'] },
      { Key: 'tag:Environment', Values: ['preview'] },
    ],
    Parameters: { RequestId: [requestId] },
    MaxConcurrency: '1',
    MaxErrors: '0',
    TimeoutSeconds: 55,
  });
  assert.equal('route' in calls[0], false);
  assert.equal('url' in calls[0], false);
  assert.equal('shell' in calls[0], false);
});

test('SSM observer rejects deploy or cross-environment documents and non-fixed tags', async () => {
  const client = { async send() { return { Command: { CommandId: 'command-1' } }; } };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const base = {
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    tagValue: 'babyjamjam-preview',
    environment: 'preview',
  };
  assert.throws(
    () => createSsmObserver({
      ...base,
      documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-deploy',
    }),
    /fixed for the environment/,
  );
  assert.throws(
    () => createSsmObserver({
      ...base,
      documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-production-db-failover',
    }),
    /fixed for the environment/,
  );
  assert.throws(
    () => createSsmObserver({
      ...base,
      documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
      tagKey: 'OtherTag',
    }),
    /tag key is fixed/,
  );
});

test('SSM terminal command failure is treated as control-plane failure, not both routes down', async () => {
  const client = {
    async send() {
      return {
        CommandInvocations: [{ Status: 'Failed', CommandPlugins: [{ Output: '' }] }],
      };
    },
  };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const observer = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagValue: 'babyjamjam-preview',
    environment: 'preview',
  });
  const result = await observer.observe({
    state: { ssmCommandId: 'command-1' },
    requestId: IDS[0],
  });
  assert.equal(result.controlPlaneOk, false);
  assert.equal(result.commandComplete, true);
  assert.equal(result.sharedOk, undefined);
  assert.equal(result.directOk, undefined);
});
