import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASES, ROUTES, createInitialState } from '../src/constants.mjs';
import {
  ConditionalStateWriteError,
  createMemoryStateStore,
} from '../src/state-store.mjs';
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
    allowedActions: ['critical'],
    allowedRoutes: ['SHARED'],
    ruleIds: ['rule-1'],
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
    eventId: 'a'.repeat(64),
    bodyFingerprint: 'a'.repeat(64),
    failoverEligible: true,
    signalClass: 'db_failover',
    action: 'critical',
    resource: 'metric_alert',
    environment: 'preview',
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
    eventId: 'a'.repeat(64),
    bodyFingerprint: 'a'.repeat(64),
    failoverEligible: true,
    signalClass: 'db_failover',
    action: 'critical',
    resource: 'metric_alert',
    environment: 'preview',
    ruleId: 'rule-1',
  });
});

test('deduplicates a body fingerprint even when Request-ID and timestamp change', async () => {
  const { handler, observed } = harness();
  const first = await handler({ Records: [record()] });
  assert.equal(first.processed, 1);
  const duplicate = await handler({ Records: [record({
    messageId: 'sqs-message-2',
    body: JSON.stringify(message({
      requestId: 'sentry-request-2',
      eventAt: BASE_TIME + 1_000,
    })),
  })] });
  assert.equal(duplicate.results[0].reason, 'duplicate_event');
  assert.equal(observed.length, 1);

  const older = await handler({ Records: [
    { messageId: 'sqs-message-3', body: JSON.stringify(message({
      eventId: 'b'.repeat(64),
      bodyFingerprint: 'b'.repeat(64),
      requestId: 'sentry-request-old',
      eventAt: BASE_TIME - 1,
    })) },
  ] });
  assert.equal(older.results[0].status, 'processed');
  assert.equal(observed.length, 2);
});

test('keeps durable replay protection after more than 32 unique events', async () => {
  const { handler, store, observed } = harness();
  for (let index = 0; index < 33; index += 1) {
    const fingerprint = index.toString(16).padStart(2, '0').repeat(32);
    const result = await handler({ Records: [record({
      messageId: `sqs-${index}`,
      body: JSON.stringify(message({
        eventId: fingerprint,
        bodyFingerprint: fingerprint,
        eventAt: BASE_TIME + index,
        requestId: `sentry-request-${index}`,
      })),
    })] });
    assert.equal(result.batchItemFailures.length, 0);
  }
  assert.equal(store.snapshot().recentSentryEventFingerprints.length, 32);
  const duplicate = await handler({ Records: [record({
    messageId: 'sqs-replay-after-eviction',
    body: JSON.stringify(message({
      eventId: '00'.repeat(32),
      bodyFingerprint: '00'.repeat(32),
      eventAt: BASE_TIME + 10_000,
      requestId: 'changed-request-id',
    })),
  })] });
  assert.equal(duplicate.results[0].reason, 'duplicate_event');
  assert.equal(observed.length, 33);
});

test('does not leave state or replay residue when the atomic transaction fails, then retries', async () => {
  const baseStore = createMemoryStateStore({ now: BASE_TIME });
  let failTransaction = true;
  const store = {
    ...baseStore,
    async saveAndMarkFingerprint(...args) {
      if (failTransaction) {
        failTransaction = false;
        throw new ConditionalStateWriteError('simulated transaction failure');
      }
      return baseStore.saveAndMarkFingerprint(...args);
    },
  };
  const observed = [];
  let ownerCounter = 0;
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return { controlPlaneOk: true, sharedOk: true, directOk: true };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => `worker-owner-${ownerCounter += 1}`,
    idFactory: () => IDS[0],
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  assert.equal(store.snapshot().lastSentryEventFingerprint, null);
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);

  const retried = await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retried.batchItemFailures.length, 0);
  assert.equal(retried.results[0].status, 'processed');
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), true);
  assert.equal(observed.length, 2);
});

test('serializes a duplicate race and performs no second host observation', async () => {
  const baseStore = createMemoryStateStore({ now: BASE_TIME });
  const observed = [];
  let ownerCounter = 0;
  let releaseObservation;
  let observationStarted;
  const observationGate = new Promise((resolve) => { releaseObservation = resolve; });
  const started = new Promise((resolve) => { observationStarted = resolve; });
  const handler = createWorkerHandler({
    stateStore: baseStore,
    observe: async (input) => {
      observed.push(input);
      observationStarted();
      await observationGate;
      return { controlPlaneOk: true, sharedOk: true, directOk: true };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => `worker-owner-${ownerCounter += 1}`,
    idFactory: () => IDS[0],
    logger: { info() {}, warn() {}, error() {} },
  });
  const firstPromise = handler({ Records: [record()] });
  await started;
  const concurrent = await handler({ Records: [record({ messageId: 'sqs-concurrent' })] });
  assert.equal(concurrent.batchItemFailures.length, 1);
  releaseObservation();
  const first = await firstPromise;
  assert.equal(first.batchItemFailures.length, 0);

  const retried = await handler({ Records: [record({ messageId: 'sqs-concurrent' })] });
  assert.equal(retried.results[0].reason, 'duplicate_event');
  assert.equal(observed.length, 1);
});

test('does not wake reconciliation for ineligible signals or wrong resource/action/environment', async (t) => {
  for (const [overrides, malformed] of [
    [{ failoverEligible: false }, true],
    [{ signalClass: 'other_signal' }, true],
    [{ resource: 'http' }, false],
    [{ environment: 'production' }, false],
    [{ action: 'issue_alert' }, false],
    [{ ruleId: 'other-rule' }, false],
  ]) {
    await t.test(JSON.stringify(overrides), async () => {
      const { handler, observed } = harness();
      const result = await handler({ Records: [
        { messageId: `sqs-${JSON.stringify(overrides)}`, body: JSON.stringify(message(overrides)) },
      ] });
      assert.equal(result.processed, malformed ? 0 : 1);
      if (malformed) {
        assert.equal(result.batchItemFailures.length, 1);
      } else {
        assert.equal(result.results[0].status, 'ignored');
        assert.equal(result.batchItemFailures.length, 0);
      }
      assert.equal(observed.length, 0);
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
    body: JSON.stringify(message({ requestId: 'sentry-request-direct-route' })),
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
