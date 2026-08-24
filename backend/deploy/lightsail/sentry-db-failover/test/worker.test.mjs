import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_PLANE_STATUS,
  PHASES,
  ROUTES,
  createInitialState,
  makeDeterministicRequestId,
} from '../src/constants.mjs';
import {
  ConditionalStateWriteError,
  createMemoryStateStore,
} from '../src/state-store.mjs';
import {
  createSsmObserver,
  createWorkerHandler,
} from '../src/worker.mjs';

const BASE_TIME = Date.parse('2026-08-24T00:00:00.000Z');
const COMMAND_ID = '00000000-0000-4000-8000-000000000099';

function config(overrides = {}) {
  return {
    enabled: true,
    environment: 'preview',
    allowedResources: ['metric_alert'],
    allowedActions: ['critical'],
    allowedRoutes: ['SHARED'],
    ruleIds: ['rule-1'],
    stateKey: 'db-failover/preview',
    leaseMs: 1_000,
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

function hostEnvelope(requestId, overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'babyjamjam-db-failover-host',
    controlPlaneOk: true,
    environment: 'preview',
    requestId,
    hostGeneration: 1,
    activeRoute: ROUTES.SHARED,
    phase: PHASES.SHARED_ACTIVE,
    result: 'shared_healthy',
    sharedOk: true,
    directOk: null,
    sharedFailureCount: 0,
    directSuccessCount: 0,
    directFailureCount: 0,
    emergencySharedSuccessCount: 0,
    sharedHealthyCount: 0,
    directActivatedAt: 0,
    sharedHealthyStartedAt: 0,
    sharedHealthyLastAt: 0,
    cooldownUntil: 0,
    recentNormalRoundTrips: [],
    transition: {
      previousRoute: null,
      targetRoute: null,
      startedAt: 0,
      generation: 0,
      terminalReason: null,
    },
    terminalReason: null,
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
      return observe ? observe(input) : { hostEnvelope: hostEnvelope(input.requestId) };
    },
    config: handlerConfig,
    now: clock,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  return { handler, store, observed };
}

test('Sentry wakes host reconciliation and mirrors the complete host result without a route action', async () => {
  const { handler, observed, store } = harness();
  const result = await handler({ Records: [record()] }, { awsRequestId: 'lambda-request' });
  assert.equal(result.processed, 1);
  assert.equal(result.batchItemFailures.length, 0);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].trigger, 'sentry');
  assert.equal(observed[0].requestId, makeDeterministicRequestId('a'.repeat(64)));
  assert.equal('route' in observed[0], false);
  assert.equal('action' in result.results[0], false);
  assert.equal(store.snapshot().hostGeneration, 1);
  assert.equal(store.snapshot().phase, PHASES.SHARED_ACTIVE);
});

test('derives the same opaque request UUID from the same authenticated body fingerprint', async () => {
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
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return { controlPlaneOk: false, controlPlaneError: 'AWS_CONTROL_PLANE_FAILURE' };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  await handler({ Records: [record()] });
  await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(observed.length, 2);
  assert.equal(observed[0].requestId, observed[1].requestId);
  assert.match(observed[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('deduplicates a body fingerprint even when Sentry request metadata changes', async () => {
  const { handler, observed } = harness();
  await handler({ Records: [record()] });
  const duplicate = await handler({ Records: [record({
    messageId: 'sqs-message-2',
    body: JSON.stringify(message({ requestId: 'changed-request-id', eventAt: BASE_TIME + 1_000 })),
  })] });
  assert.equal(duplicate.results[0].reason, 'duplicate_event');
  assert.equal(observed.length, 1);
});

test('keeps durable replay protection after more than 32 unique events', async () => {
  const { handler, store, observed } = harness({
    observe: async ({ requestId, state }) => ({
      hostEnvelope: hostEnvelope(requestId, {
        hostGeneration: state.hostGeneration + 1,
      }),
    }),
  });
  for (let index = 0; index < 33; index += 1) {
    const fingerprint = index.toString(16).padStart(2, '0').repeat(32);
    const result = await handler({ Records: [record({
      messageId: `sqs-${index}`,
      body: JSON.stringify(message({ eventId: fingerprint, bodyFingerprint: fingerprint })),
    })] });
    assert.equal(result.batchItemFailures.length, 0);
  }
  assert.equal(store.snapshot().recentSentryEventFingerprints.length, 32);
  const duplicate = await handler({ Records: [record({
    messageId: 'sqs-replay-after-eviction',
    body: JSON.stringify(message({ eventId: '00'.repeat(32), bodyFingerprint: '00'.repeat(32) })),
  })] });
  assert.equal(duplicate.results[0].reason, 'duplicate_event');
  assert.equal(observed.length, 33);
});

test('atomic replay transaction failure leaves no replay residue and retries the same host request', async () => {
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
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return { hostEnvelope: hostEnvelope(input.requestId, {
        hostGeneration: input.state.hostGeneration + 1,
      }) };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);
  const retried = await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retried.batchItemFailures.length, 0);
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), true);
  assert.equal(observed.length, 2);
  assert.equal(observed[0].requestId, observed[1].requestId);
  assert.equal(store.snapshot().hostGeneration, 1);
});

test('a SendCommand success followed by Dynamo failure retries with the same UUID and mirrors host evidence once', async () => {
  const baseStore = createMemoryStateStore({ now: BASE_TIME });
  let failTransaction = true;
  const store = {
    ...baseStore,
    async saveAndMarkFingerprint(...args) {
      if (failTransaction) {
        failTransaction = false;
        throw new ConditionalStateWriteError('simulated post-command save failure');
      }
      return baseStore.saveAndMarkFingerprint(...args);
    },
  };
  const observed = [];
  const evidenceByRequest = new Map();
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      const next = evidenceByRequest.get(input.requestId) ?? 1;
      evidenceByRequest.set(input.requestId, next);
      return {
        hostEnvelope: hostEnvelope(input.requestId, {
          hostGeneration: next,
          sharedFailureCount: next,
        }),
      };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  const retry = await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retry.batchItemFailures.length, 0);
  assert.equal(observed[0].requestId, observed[1].requestId);
  assert.equal(store.snapshot().hostGeneration, 1);
  assert.equal(store.snapshot().sharedFailureCount, 1);
});

test('persists the command ID before the replay transaction so a failed save polls instead of re-sending', async () => {
  const baseStore = createMemoryStateStore({ now: BASE_TIME });
  let failTransaction = true;
  const store = {
    ...baseStore,
    async saveAndMarkFingerprint(...args) {
      if (failTransaction) {
        failTransaction = false;
        throw new ConditionalStateWriteError('simulated replay transaction failure');
      }
      return baseStore.saveAndMarkFingerprint(...args);
    },
  };
  let sendCount = 0;
  let listCount = 0;
  const requestId = makeDeterministicRequestId('a'.repeat(64));
  const terminal = hostEnvelope(requestId, {
    hostGeneration: 1,
    phase: PHASES.SHARED_ACTIVE,
  });
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sendCount += 1;
        assert.deepEqual(command.input.Parameters, { RequestId: [requestId] });
        return { Command: { CommandId: COMMAND_ID } };
      }
      listCount += 1;
      return {
        CommandInvocations: [{
          Status: 'Success',
          CommandPlugins: [{ Output: `${JSON.stringify(terminal)}\n` }],
        }],
      };
    },
  };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const ssm = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagValue: 'babyjamjam-preview',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: ssm.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  assert.equal(store.snapshot().ssmCommandId, COMMAND_ID);
  assert.equal(store.snapshot().ssmRequestId, requestId);
  assert.equal(store.snapshot().hostGeneration, 0);
  const retry = await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retry.batchItemFailures.length, 0);
  assert.equal(sendCount, 1);
  assert.equal(listCount, 1);
  assert.equal(store.snapshot().hostGeneration, 1);
});

test('a mirrored Direct route prevents an eligible Shared Sentry alert from bypassing the host route', async () => {
  const { handler, observed } = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 4,
      activeRoute: ROUTES.DIRECT,
      phase: PHASES.DIRECT_ACTIVE,
      lastHostResult: 'route_switched',
    },
  });
  const result = await handler({ Records: [record()] });
  assert.equal(result.results[0].reason, 'current_route_not_shared');
  assert.equal(observed.length, 0);
});

test('host terminal BLOCKED or DEGRADED state prevents further SSM calls', async (t) => {
  for (const phase of [PHASES.BLOCKED, PHASES.DEGRADED]) {
    await t.test(phase, async () => {
      const { handler, observed } = harness({
        initialState: {
          ...createInitialState(BASE_TIME),
          hostGeneration: 2,
          phase,
          terminalPhase: phase,
          terminalReason: 'both_routes_failed',
        },
      });
      const result = await handler({ Records: [record()] });
      assert.equal(result.results[0].reason, 'host_terminal');
      assert.equal(observed.length, 0);
    });
  }
});

test('AWS failure preserves the last host phase, route, counters, and terminal fields', async () => {
  const { handler, store, observed } = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 6,
      activeRoute: ROUTES.DIRECT,
      phase: PHASES.DIRECT_ACTIVE,
      sharedFailureCount: 2,
      lastHostResult: 'direct_healthy',
    },
    observe: async () => { throw new Error('ssm unavailable'); },
  });
  const result = await handler({});
  assert.equal(result.processed, 1);
  assert.equal(observed.length, 1);
  const state = store.snapshot();
  assert.equal(state.activeRoute, ROUTES.DIRECT);
  assert.equal(state.phase, PHASES.DIRECT_ACTIVE);
  assert.equal(state.hostGeneration, 6);
  assert.equal(state.sharedFailureCount, 2);
  assert.equal(state.controlPlaneStatus, CONTROL_PLANE_STATUS.DEGRADED);
  assert.equal(state.controlPlaneError, 'AWS_CONTROL_PLANE_FAILURE');
  assert.equal(state.terminalPhase, null);
});

test('rejected host envelopes leave the prior host evidence unchanged', async (t) => {
  const cases = [
    ['partial', (value) => { delete value.result; }],
    ['old-generation', (value) => { value.hostGeneration = 5; }],
    ['wrong-request', (value) => { value.requestId = '10000000-0000-4000-8000-000000000001'; }],
    ['wrong-environment', (value) => { value.environment = 'production'; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const { handler, store } = harness({
        initialState: {
          ...createInitialState(BASE_TIME),
          hostGeneration: 6,
          activeRoute: ROUTES.DIRECT,
          phase: PHASES.DIRECT_ACTIVE,
          sharedFailureCount: 4,
          lastHostResult: 'direct_healthy',
        },
        observe: async ({ requestId }) => {
          const value = hostEnvelope(requestId, {
            hostGeneration: 7,
            activeRoute: ROUTES.DIRECT,
            phase: PHASES.DIRECT_ACTIVE,
            result: 'direct_healthy',
          });
          mutate(value);
          return { hostEnvelope: value, commandComplete: true };
        },
      });
      const result = await handler({});
      assert.equal(
        result.results[0].reason,
        name === 'old-generation' ? 'host_result_rejected' : 'invalid_host_result',
      );
      const state = store.snapshot();
      assert.equal(state.hostGeneration, 6);
      assert.equal(state.phase, PHASES.DIRECT_ACTIVE);
      assert.equal(state.activeRoute, ROUTES.DIRECT);
      assert.equal(state.sharedFailureCount, 4);
      assert.equal(state.lastHostResult, 'direct_healthy');
      assert.equal(state.controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
    });
  }
});

test('scheduled retries reuse the EventBridge id/time identity', async () => {
  const store = createMemoryStateStore({ now: BASE_TIME });
  const observed = [];
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return { hostEnvelope: hostEnvelope(input.requestId, { hostGeneration: 1 }) };
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const event = { id: 'eventbridge-123', time: '2026-08-24T00:00:00Z' };
  const first = await handler(event);
  assert.equal(first.processed, 1);
  const retry = await handler(event);
  assert.equal(retry.processed, 1);
  assert.equal(observed[0].requestId, observed[1].requestId);
  assert.equal(observed[0].requestId, makeDeterministicRequestId('schedule:eventbridge-123:2026-08-24T00:00:00Z'));
});

test('SSM observer sends only the fixed document and polls a persisted opaque request UUID', async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command.input);
      return { Command: { CommandId: COMMAND_ID } };
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
  const requestId = makeDeterministicRequestId('fingerprint');
  const started = await observer.observe({
    state: createInitialState(BASE_TIME),
    requestId,
    identity: 'sentry:fingerprint',
  });
  assert.equal(started.commandId, COMMAND_ID);
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
});

test('terminal failed SSM commands mirror valid host BLOCKED results', async () => {
  const requestId = makeDeterministicRequestId('terminal');
  const terminal = hostEnvelope(requestId, {
    hostGeneration: 9,
    activeRoute: ROUTES.DIRECT,
    phase: PHASES.BLOCKED,
    result: 'both_routes_failed',
    sharedOk: false,
    directOk: false,
    terminalReason: 'both_routes_failed',
    transition: {
      previousRoute: null,
      targetRoute: null,
      startedAt: 0,
      generation: 0,
      terminalReason: 'both_routes_failed',
    },
  });
  const client = {
    async send() {
      return {
        CommandInvocations: [{
          Status: 'Failed',
          CommandPlugins: [{ Output: `${JSON.stringify(terminal)}\n` }],
        }],
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
    state: { ...createInitialState(BASE_TIME), ssmCommandId: COMMAND_ID, ssmRequestId: requestId },
    requestId,
  });
  assert.equal(result.controlPlaneOk, true);
  assert.equal(result.commandComplete, true);
  assert.equal(result.hostEnvelope.phase, PHASES.BLOCKED);
});

test('terminal SSM command without a complete valid host result fails closed', async () => {
  const requestId = makeDeterministicRequestId('invalid-terminal');
  const client = {
    async send() {
      return { CommandInvocations: [{ Status: 'Failed', CommandPlugins: [{ Output: '{"phase":"BLOCKED"}' }] }] };
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
    state: { ...createInitialState(BASE_TIME), ssmCommandId: COMMAND_ID, ssmRequestId: requestId },
    requestId,
  });
  assert.equal(result.controlPlaneOk, false);
  assert.equal(result.controlPlaneTerminal, true);
  assert.equal(result.controlPlaneError, 'INVALID_HOST_RESULT');
});

test('SSM observer rejects deploy, cross-environment, and non-fixed tag boundaries', () => {
  const client = { async send() { return { Command: { CommandId: COMMAND_ID } }; } };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const base = {
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    tagValue: 'babyjamjam-preview',
    environment: 'preview',
  };
  assert.throws(
    () => createSsmObserver({ ...base, documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-deploy' }),
    /fixed for the environment/,
  );
  assert.throws(
    () => createSsmObserver({ ...base, documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-production-db-failover' }),
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
