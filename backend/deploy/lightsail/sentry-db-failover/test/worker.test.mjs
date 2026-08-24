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
  CONTROL_PLANE_DEGRADED_METRIC_DIMENSIONS,
  CONTROL_PLANE_DEGRADED_METRIC_NAME,
  CONTROL_PLANE_DEGRADED_METRIC_NAMESPACE,
  SHARED_ACTIVE_SCHEDULE_SKIP_REASON,
  TERMINAL_STATE_METRIC_DIMENSIONS,
  TERMINAL_STATE_METRIC_NAME,
  TERMINAL_STATE_METRIC_NAMESPACE,
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

function harness({ initialState, observe, handlerConfig = config(), clock = () => BASE_TIME, logger } = {}) {
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
    logger: logger ?? { info() {}, warn() {}, error() {} },
  });
  return { handler, store, observed };
}

test('fresh and steady Shared schedules are ignored without host-state residue', async (t) => {
  const initialStates = [
    undefined,
    {
      ...createInitialState(BASE_TIME),
      hostGeneration: 4,
      result: 'shared_healthy',
      lastHostResult: 'shared_healthy',
      sharedOk: true,
    },
  ];

  for (const [index, initialState] of initialStates.entries()) {
    await t.test(index === 0 ? 'fresh' : 'steady', async () => {
      const { handler, store, observed } = harness({
        initialState,
        observe: async () => {
          throw new Error('quiescent Shared schedules must not observe');
        },
      });
      const before = store.snapshot();
      const result = await handler({ id: `shared-active-${index}`, time: '2026-08-24T00:00:00Z' });

      assert.equal(result.results[0].status, 'ignored');
      assert.equal(result.results[0].reason, SHARED_ACTIVE_SCHEDULE_SKIP_REASON);
      assert.equal(observed.length, 0);
      assert.deepEqual(store.snapshot(), before);
      assert.equal(store.snapshot().phase, PHASES.SHARED_ACTIVE);
      assert.equal(store.snapshot().activeRoute, ROUTES.SHARED);
      assert.equal(store.snapshot().ssmCommandId, null);
      assert.equal(store.snapshot().ssmRequestId, null);
      assert.equal(store.snapshot().ssmRecoveryRequestId, null);
    });
  }
});

test('repeated Shared schedules cannot initiate failover without Sentry', async () => {
  const { handler, store, observed } = harness({
    observe: async () => {
      throw new Error('repeated quiescent schedules must not observe');
    },
  });
  const before = store.snapshot();

  for (let index = 0; index < 3; index += 1) {
    const result = await handler({ id: `shared-active-repeat-${index}`, time: `2026-08-24T00:0${index}:00Z` });
    assert.equal(result.results[0].status, 'ignored');
    assert.equal(result.results[0].reason, SHARED_ACTIVE_SCHEDULE_SKIP_REASON);
  }

  assert.equal(observed.length, 0);
  assert.deepEqual(store.snapshot(), before);
});

test('scheduled eligibility is rechecked after a race changes the leased state to quiescent Shared', async () => {
  const baseStore = createMemoryStateStore({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 7,
      phase: PHASES.DIRECT_ACTIVE,
      activeRoute: ROUTES.DIRECT,
      result: 'direct_healthy',
      lastHostResult: 'direct_healthy',
      directOk: true,
    },
    now: BASE_TIME,
  });
  let acquireCalls = 0;
  let observeCalls = 0;
  const stateStore = {
    ...baseStore,
    async acquireLease(options) {
      const lease = await baseStore.acquireLease(options);
      acquireCalls += 1;
      const quiescentSharedState = {
        ...lease.state,
        phase: PHASES.SHARED_ACTIVE,
        activeRoute: ROUTES.SHARED,
        result: 'shared_healthy',
        lastHostResult: 'shared_healthy',
        sharedOk: true,
        directOk: null,
        ssmCommandId: null,
        ssmRequestId: null,
        ssmRequestIdentity: null,
        ssmDispatchAttempted: false,
        ssmRecoveryRequestId: null,
        ssmRecoveryIdentity: null,
        controlPlaneStatus: CONTROL_PLANE_STATUS.OK,
        controlPlaneError: null,
      };
      await baseStore.saveHostMirror(quiescentSharedState, {
        ...options,
        generation: lease.generation,
      });
      return { ...lease, state: quiescentSharedState };
    },
  };
  const handler = createWorkerHandler({
    stateStore,
    observe: async () => {
      observeCalls += 1;
      throw new Error('raced quiescent Shared schedule must not observe');
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await handler({ id: 'race-to-shared', time: '2026-08-24T00:02:00Z' });

  assert.equal(result.results[0].status, 'ignored');
  assert.equal(result.results[0].reason, SHARED_ACTIVE_SCHEDULE_SKIP_REASON);
  assert.equal(acquireCalls, 1);
  assert.equal(observeCalls, 0);
  const finalState = baseStore.snapshot();
  assert.equal(finalState.phase, PHASES.SHARED_ACTIVE);
  assert.equal(finalState.activeRoute, ROUTES.SHARED);
  assert.equal(finalState.hostGeneration, 7);
  assert.equal(finalState.ssmCommandId, null);
  assert.equal(finalState.ssmRequestId, null);
  assert.equal(finalState.ssmRequestIdentity, null);
  assert.equal(finalState.ssmRecoveryRequestId, null);
  assert.equal(finalState.ssmRecoveryIdentity, null);
  assert.equal(finalState.controlPlaneStatus, CONTROL_PLANE_STATUS.OK);
  assert.equal(finalState.controlPlaneError, null);
  assert.equal(finalState.leaseOwner, null);
  assert.equal(finalState.leaseExpiresAt, 0);
});

test('a scheduled tick polls an SSM command already started by Sentry without sending another command', async () => {
  const sentryRequestId = makeDeterministicRequestId('a'.repeat(64));
  const sendCommandId = '00000000-0000-4000-8000-0000000000f1';
  let sendCount = 0;
  let listCount = 0;
  let sentryCommandRequestId;
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sendCount += 1;
        sentryCommandRequestId = command.input.Parameters.RequestId[0];
        return { Command: { CommandId: sendCommandId } };
      }
      listCount += 1;
      return {
        CommandInvocations: [{
          Status: 'Success',
          CommandPlugins: [{
            Output: `${JSON.stringify(hostEnvelope(sentryRequestId, {
              hostGeneration: 1,
              result: 'shared_healthy',
            }))}\n`,
          }],
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
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const store = createMemoryStateStore({ now: BASE_TIME });
  const observed = [];
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return observer.observe(input);
    },
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });

  const sentryResult = await handler({ Records: [record()] });
  assert.equal(sentryResult.batchItemFailures.length, 0);
  assert.equal(sentryCommandRequestId, sentryRequestId);
  assert.equal(observed[0].requestId, makeDeterministicRequestId('a'.repeat(64)));
  assert.equal(observed[0].identity, 'sentry:' + 'a'.repeat(64));
  assert.equal(store.snapshot().ssmCommandId, sendCommandId);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.IN_FLIGHT);

  const scheduledResult = await handler({ id: 'eventbridge-after-sentry', time: '2026-08-24T00:01:00Z' });
  assert.equal(scheduledResult.results[0].status, 'processed');
  assert.equal(scheduledResult.results[0].reason, 'host_result_mirrored');
  assert.equal(sendCount, 1);
  assert.equal(listCount, 1);
  assert.deepEqual(observed.map((input) => input.trigger), ['sentry', 'schedule']);
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.equal(store.snapshot().hostGeneration, 1);
});

test('scheduled reconciliation remains active for Direct health and failback phases', async () => {
  const { handler, store, observed } = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 4,
      phase: PHASES.DIRECT_ACTIVE,
      activeRoute: ROUTES.DIRECT,
      directOk: true,
    },
    observe: async ({ requestId, state }) => {
      if (state.phase === PHASES.DIRECT_ACTIVE) {
        return {
          hostEnvelope: hostEnvelope(requestId, {
            hostGeneration: state.hostGeneration + 1,
            activeRoute: ROUTES.DIRECT,
            phase: PHASES.RECOVERING_SHARED,
            result: 'recovering_shared',
            sharedOk: true,
            directOk: true,
            sharedHealthyCount: 1,
          }),
        };
      }
      return {
        hostEnvelope: hostEnvelope(requestId, {
          hostGeneration: state.hostGeneration + 1,
          activeRoute: ROUTES.SHARED,
          phase: PHASES.SHARED_ACTIVE,
          result: 'emergency_shared_recovery',
          sharedOk: true,
          directOk: null,
        }),
      };
    },
  });

  const first = await handler({ id: 'direct-health', time: '2026-08-24T00:01:00Z' });
  assert.equal(first.results[0].status, 'processed');
  assert.equal(store.snapshot().phase, PHASES.RECOVERING_SHARED);
  assert.equal(store.snapshot().activeRoute, ROUTES.DIRECT);

  const second = await handler({ id: 'direct-failback', time: '2026-08-24T00:02:00Z' });
  assert.equal(second.results[0].status, 'processed');
  assert.equal(store.snapshot().phase, PHASES.SHARED_ACTIVE);
  assert.equal(store.snapshot().activeRoute, ROUTES.SHARED);
  assert.deepEqual(observed.map((input) => input.trigger), ['schedule', 'schedule']);
});

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
    tagValue: 'babyjamjam-admin-server',
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

test('process restart after an immediate command-ID save failure does not re-send SSM', async () => {
  const baseStore = createMemoryStateStore({ now: BASE_TIME });
  let failCommandMirror = true;
  const store = {
    ...baseStore,
    async saveHostMirror(state, options) {
      if (failCommandMirror && state.ssmCommandId === COMMAND_ID) {
        failCommandMirror = false;
        throw new ConditionalStateWriteError('simulated command-ID save failure');
      }
      return baseStore.saveHostMirror(state, options);
    },
  };
  let sendCount = 0;
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sendCount += 1;
        return { Command: { CommandId: COMMAND_ID } };
      }
      throw new Error('the uncertain command must not be polled without a persisted ID');
    },
  };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const observer = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  assert.equal(sendCount, 1);
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.equal(store.snapshot().ssmDispatchAttempted, true);
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);

  const retryHandler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-restarted',
    logger: { info() {}, warn() {}, error() {} },
  });
  const retry = await retryHandler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retry.batchItemFailures.length, 1);
  assert.equal(retry.batchItemFailures[0].itemIdentifier, 'sqs-retry');
  assert.equal(sendCount, 1);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
  assert.equal(store.snapshot().controlPlaneError, 'SSM_COMMAND_STATE_UNCERTAIN');
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);

  await assert.rejects(
    () => retryHandler({ id: 'schedule-after-uncertain', time: '2026-08-24T00:01:00Z' }),
    (error) => error.name === 'UncertainSsmStateError'
      && error.code === 'SSM_COMMAND_STATE_UNCERTAIN',
  );
  assert.equal(sendCount, 1);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
  assert.equal(store.snapshot().controlPlaneError, 'SSM_COMMAND_STATE_UNCERTAIN');
});

test('a lost SendCommand response stays uncertain and never re-sends the accepted command', async () => {
  const store = createMemoryStateStore({ now: BASE_TIME });
  let sendCount = 0;
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sendCount += 1;
        throw new Error('SSM accepted command but response was lost');
      }
      throw new Error('the uncertain command must not be polled without a persisted ID');
    },
  };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const observer = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });

  const first = await handler({ Records: [record()] });
  assert.equal(first.batchItemFailures.length, 1);
  assert.equal(first.batchItemFailures[0].itemIdentifier, 'sqs-message-1');
  assert.equal(sendCount, 1);
  assert.equal(store.snapshot().ssmDispatchAttempted, true);
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
  assert.equal(store.snapshot().controlPlaneError, 'SSM_COMMAND_STATE_UNCERTAIN');
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);

  const retry = await handler({ Records: [record({ messageId: 'sqs-retry' })] });
  assert.equal(retry.batchItemFailures.length, 1);
  assert.equal(retry.batchItemFailures[0].itemIdentifier, 'sqs-retry');
  assert.equal(sendCount, 1);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
  assert.equal(store.snapshot().controlPlaneError, 'SSM_COMMAND_STATE_UNCERTAIN');
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);

  await assert.rejects(
    () => handler({ id: 'schedule-after-lost-response', time: '2026-08-24T00:01:00Z' }),
    (error) => error.name === 'UncertainSsmStateError'
      && error.code === 'SSM_COMMAND_STATE_UNCERTAIN',
  );
  assert.equal(sendCount, 1);
});

test('defers a Sentry message while reconciling a scheduled command owned by another request', async () => {
  const sentRequestIds = [];
  const polledCommandIds = [];
  const commandIds = [
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000a1',
  ];
  const schedule = { id: 'schedule-b', time: '2026-08-24T00:00:00Z' };
  const scheduleRequestId = makeDeterministicRequestId('schedule:schedule-b:2026-08-24T00:00:00Z');
  const requestIds = new Map([[commandIds[0], scheduleRequestId]]);
  const store = createMemoryStateStore({
    initialState: {
      ...createInitialState(BASE_TIME),
      ssmCommandId: commandIds[0],
      ssmRequestId: scheduleRequestId,
      ssmRequestIdentity: 'schedule:schedule-b:2026-08-24T00:00:00Z',
      controlPlaneStatus: CONTROL_PLANE_STATUS.IN_FLIGHT,
    },
    now: BASE_TIME,
  });
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        const requestId = command.input.Parameters.RequestId[0];
        sentRequestIds.push(requestId);
        const commandId = commandIds[sentRequestIds.length];
        requestIds.set(commandId, requestId);
        return { Command: { CommandId: commandId } };
      }
      polledCommandIds.push(command.input.CommandId);
      const requestId = requestIds.get(command.input.CommandId);
      const commandStillRunning = command.input.CommandId === commandIds[0]
        && polledCommandIds.filter((value) => value === commandIds[0]).length === 1;
      return {
        CommandInvocations: [{
          Status: commandStillRunning ? 'InProgress' : 'Success',
          CommandPlugins: [{
            Output: commandStillRunning
              ? ''
              : `${JSON.stringify(hostEnvelope(requestId, {
                hostGeneration: command.input.CommandId.endsWith('b1') ? 1 : 2,
              }))}\n`,
          }],
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
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const sentryRecord = record({
    messageId: 'sqs-a',
    body: JSON.stringify(message({
      eventId: 'a'.repeat(64),
      bodyFingerprint: 'a'.repeat(64),
    })),
  });
  const scheduled = await handler(schedule);
  assert.equal(scheduled.batchItemFailures.length, 0);
  assert.equal(scheduled.results[0].reason, 'control_plane_failure');
  assert.equal(store.snapshot().ssmRequestId, scheduleRequestId);
  assert.equal(store.snapshot().ssmCommandId, commandIds[0]);

  const premature = await handler({ Records: [sentryRecord] });
  assert.equal(premature.batchItemFailures.length, 1);
  assert.equal(premature.batchItemFailures[0].itemIdentifier, 'sqs-a');
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), false);
  assert.equal(store.snapshot().hostGeneration, 1);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.OK);
  assert.equal(store.snapshot().controlPlaneError, null);
  assert.equal(store.snapshot().ssmRequestId, scheduleRequestId);
  assert.equal(store.snapshot().ssmRequestIdentity, 'schedule:schedule-b:2026-08-24T00:00:00Z');
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.deepEqual(sentRequestIds, []);
  assert.deepEqual(polledCommandIds, [commandIds[0], commandIds[0]]);

  const retried = await handler({ Records: [sentryRecord] });
  assert.equal(retried.batchItemFailures.length, 0);
  assert.equal(await store.hasProcessedFingerprint('a'.repeat(64)), true);
  assert.equal(store.snapshot().ssmRequestId, makeDeterministicRequestId('a'.repeat(64)));
  assert.equal(store.snapshot().ssmCommandId, commandIds[1]);
  assert.deepEqual(sentRequestIds, [makeDeterministicRequestId('a'.repeat(64))]);

  const completed = await handler({ id: 'schedule-a', time: '2026-08-24T00:01:00Z' });
  assert.equal(completed.batchItemFailures.length, 0);
  assert.equal(store.snapshot().hostGeneration, 2);
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.deepEqual(polledCommandIds, [commandIds[0], commandIds[0], commandIds[1]]);
});

test('uses one transition-bound recovery command after an envelope-less terminal result', async () => {
  const pendingCommandId = '00000000-0000-4000-8000-0000000000b2';
  const recoveryCommandId = '00000000-0000-4000-8000-0000000000c2';
  const pendingRequestId = makeDeterministicRequestId('schedule:pending-transition:2026-08-24T00:00:00Z');
  const transition = {
    previousRoute: ROUTES.SHARED,
    targetRoute: ROUTES.DIRECT,
    startedAt: 100_000,
    generation: 1,
    terminalReason: null,
  };
  const store = createMemoryStateStore({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 1,
      phase: PHASES.SWITCHING_TO_DIRECT,
      activeRoute: ROUTES.SHARED,
      transition,
      ssmCommandId: pendingCommandId,
      ssmRequestId: pendingRequestId,
      ssmRequestIdentity: 'schedule:pending-transition:2026-08-24T00:00:00Z',
      controlPlaneStatus: CONTROL_PLANE_STATUS.IN_FLIGHT,
    },
  });
  const sentRequestIds = [];
  const polledCommandIds = [];
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sentRequestIds.push(command.input.Parameters.RequestId[0]);
        return { Command: { CommandId: recoveryCommandId } };
      }
      polledCommandIds.push(command.input.CommandId);
      if (command.input.CommandId === pendingCommandId) {
        return { CommandInvocations: [{ Status: 'Failed', CommandPlugins: [{ Output: '' }] }] };
      }
      const envelope = hostEnvelope(sentRequestIds[0], {
        hostGeneration: 2,
        result: 'stale_transition_compensated',
      });
      return {
        CommandInvocations: [{
          Status: 'Success',
          CommandPlugins: [{ Output: `${JSON.stringify(envelope)}\n` }],
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
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ id: 'schedule-recovery-1', time: '2026-08-24T00:01:00Z' });
  const recoveryIdentity = 'recovery:SWITCHING_TO_DIRECT:SHARED:DIRECT:100000:1';
  const recoveryRequestId = makeDeterministicRequestId(recoveryIdentity);
  assert.equal(first.batchItemFailures.length, 0);
  assert.deepEqual(sentRequestIds, [recoveryRequestId]);
  assert.deepEqual(polledCommandIds, [pendingCommandId]);
  assert.equal(store.snapshot().phase, PHASES.SWITCHING_TO_DIRECT);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.IN_FLIGHT);
  assert.equal(store.snapshot().ssmCommandId, recoveryCommandId);
  assert.equal(store.snapshot().ssmRequestId, recoveryRequestId);
  assert.equal(store.snapshot().ssmRecoveryRequestId, recoveryRequestId);

  const second = await handler({ id: 'schedule-recovery-2', time: '2026-08-24T00:02:00Z' });
  assert.equal(second.batchItemFailures.length, 0);
  assert.deepEqual(polledCommandIds, [pendingCommandId, recoveryCommandId]);
  assert.equal(store.snapshot().hostGeneration, 2);
  assert.equal(store.snapshot().phase, PHASES.SHARED_ACTIVE);
  assert.equal(store.snapshot().activeRoute, ROUTES.SHARED);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.OK);
  assert.equal(store.snapshot().ssmCommandId, null);
  assert.equal(store.snapshot().ssmRecoveryRequestId, null);
});

test('does not open a second transition recovery path after recovery is terminal without an envelope', async () => {
  const pendingCommandId = '00000000-0000-4000-8000-0000000000d2';
  const transition = {
    previousRoute: ROUTES.SHARED,
    targetRoute: ROUTES.DIRECT,
    startedAt: 100_000,
    generation: 1,
    terminalReason: null,
  };
  const pendingRequestId = makeDeterministicRequestId('schedule:pending-transition:2026-08-24T00:00:00Z');
  const store = createMemoryStateStore({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 1,
      phase: PHASES.SWITCHING_TO_DIRECT,
      activeRoute: ROUTES.SHARED,
      transition,
      ssmCommandId: pendingCommandId,
      ssmRequestId: pendingRequestId,
      ssmRequestIdentity: 'schedule:pending-transition:2026-08-24T00:00:00Z',
      controlPlaneStatus: CONTROL_PLANE_STATUS.IN_FLIGHT,
    },
  });
  let sendCount = 0;
  let listCount = 0;
  const client = {
    async send(command) {
      if (command.input?.Parameters) {
        sendCount += 1;
        return { Command: { CommandId: `00000000-0000-4000-8000-0000000000e${sendCount}` } };
      }
      listCount += 1;
      if (listCount === 1) {
        return { CommandInvocations: [{ Status: 'Failed', CommandPlugins: [{ Output: '' }] }] };
      }
      return { CommandInvocations: [{ Status: 'Failed', CommandPlugins: [{ Output: '' }] }] };
    },
  };
  class SendCommandCommand { constructor(input) { this.input = input; } }
  class ListCommandInvocationsCommand { constructor(input) { this.input = input; } }
  const observer = createSsmObserver({
    client,
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
    tagValue: 'babyjamjam-admin-server',
    environment: 'preview',
  });
  const handler = createWorkerHandler({
    stateStore: store,
    observe: observer.observe,
    config: config(),
    now: () => BASE_TIME,
    ownerFactory: () => 'worker-owner',
    logger: { info() {}, warn() {}, error() {} },
  });
  const first = await handler({ id: 'schedule-recovery-1', time: '2026-08-24T00:01:00Z' });
  assert.equal(first.batchItemFailures.length, 0);
  assert.equal(sendCount, 1);
  const recoveryCommandId = store.snapshot().ssmCommandId;
  const second = await handler({ id: 'schedule-recovery-2', time: '2026-08-24T00:02:00Z' });
  assert.equal(second.batchItemFailures.length, 0);
  assert.equal(sendCount, 1);
  assert.equal(listCount, 2);
  assert.equal(store.snapshot().ssmCommandId, recoveryCommandId);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
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

test('valid terminal host envelopes emit one monitored secret-free signal after persistence', async (t) => {
  for (const phase of [PHASES.BLOCKED, PHASES.DEGRADED]) {
    await t.test(phase, async () => {
      const warnings = [];
      const { handler, store } = harness({
        observe: async ({ requestId }) => ({
          hostEnvelope: hostEnvelope(requestId, {
            activeRoute: ROUTES.DIRECT,
            phase,
            result: phase === PHASES.BLOCKED ? 'both_routes_failed' : 'reconcile_degraded',
            sharedOk: false,
            directOk: phase === PHASES.BLOCKED ? false : true,
            terminalReason: phase === PHASES.BLOCKED ? 'both_routes_failed' : 'compensation_failed',
            transition: {
              previousRoute: null,
              targetRoute: null,
              startedAt: 0,
              generation: 0,
              terminalReason: phase === PHASES.BLOCKED ? 'both_routes_failed' : 'compensation_failed',
            },
          }),
        }),
        logger: { info() {}, warn(fields) { warnings.push(fields); }, error() {} },
      });
      const result = await handler({ Records: [record()] });
      assert.equal(result.batchItemFailures.length, 0);
      assert.equal(store.snapshot().phase, phase);
      const signals = warnings.filter((entry) => entry.event === 'db_failover_terminal_state');
      assert.equal(signals.length, 1);
      assert.deepEqual(signals[0]._aws, {
        Timestamp: BASE_TIME,
        CloudWatchMetrics: [{
          Namespace: TERMINAL_STATE_METRIC_NAMESPACE,
          Dimensions: [TERMINAL_STATE_METRIC_DIMENSIONS],
          Metrics: [{ Name: TERMINAL_STATE_METRIC_NAME, Unit: 'Count' }],
        }],
      });
      assert.equal(signals[0].Environment, 'preview');
      assert.equal(signals[0].StateType, 'HOST');
      assert.equal(signals[0].TerminalState, 1);
      assert.equal('secret' in signals[0], false);
      assert.equal('databaseUrl' in signals[0], false);
    });
  }
});

test('terminal control-plane state emits the same monitored signal without a worker failure', async () => {
  const warnings = [];
  const { handler, store } = harness({
    observe: async () => ({
      controlPlaneOk: false,
      controlPlaneTerminal: true,
      controlPlaneError: 'INVALID_HOST_RESULT',
    }),
    logger: { info() {}, warn(fields) { warnings.push(fields); }, error() {} },
  });
  const result = await handler({ Records: [record()] });
  assert.equal(result.batchItemFailures.length, 0);
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.BLOCKED);
  const signals = warnings.filter((entry) => entry.event === 'db_failover_terminal_state');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].Environment, 'preview');
  assert.equal(signals[0].StateType, 'CONTROL_PLANE');
  assert.equal(signals[0].TerminalState, 1);
  assert.equal(signals[0]._aws.CloudWatchMetrics[0].Namespace, TERMINAL_STATE_METRIC_NAMESPACE);
  assert.equal(signals[0]._aws.CloudWatchMetrics[0].Metrics[0].Name, TERMINAL_STATE_METRIC_NAME);
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

test('persisted control-plane DEGRADED state emits a secret-free top-level EMF signal', async () => {
  const warnings = [];
  let store;
  const harnessResult = harness({
    initialState: {
      ...createInitialState(BASE_TIME),
      hostGeneration: 6,
      activeRoute: ROUTES.DIRECT,
      phase: PHASES.DIRECT_ACTIVE,
      lastHostResult: 'direct_healthy',
    },
    observe: async () => { throw new Error('ssm unavailable'); },
    logger: {
      info() {},
      warn(fields) {
        warnings.push({ fields, persistedStatus: store?.snapshot().controlPlaneStatus });
      },
      error() {},
    },
  });
  store = harnessResult.store;

  const result = await harnessResult.handler({ id: 'degraded-schedule', time: '2026-08-24T00:00:00Z' });
  assert.equal(result.results[0].status, 'processed');
  assert.equal(result.results[0].reason, 'control_plane_failure');
  assert.equal(store.snapshot().controlPlaneStatus, CONTROL_PLANE_STATUS.DEGRADED);

  const signals = warnings.filter((entry) => entry.fields.event === 'db_failover_control_plane_degraded');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].persistedStatus, CONTROL_PLANE_STATUS.DEGRADED);
  assert.deepEqual(signals[0].fields._aws, {
    Timestamp: BASE_TIME,
    CloudWatchMetrics: [{
      Namespace: CONTROL_PLANE_DEGRADED_METRIC_NAMESPACE,
      Dimensions: [CONTROL_PLANE_DEGRADED_METRIC_DIMENSIONS],
      Metrics: [{ Name: CONTROL_PLANE_DEGRADED_METRIC_NAME, Unit: 'Count' }],
    }],
  });
  assert.equal(signals[0].fields.Environment, 'preview');
  assert.equal(signals[0].fields.ControlPlaneDegraded, 1);
  assert.equal(signals[0].fields.controlPlaneStatus, CONTROL_PLANE_STATUS.DEGRADED);
  assert.equal('secret' in signals[0].fields, false);
  assert.equal('databaseUrl' in signals[0].fields, false);
  assert.doesNotMatch(JSON.stringify(signals[0].fields), /postgres|password|bearer|access[_-]?token/i);
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
  const store = createMemoryStateStore({
    initialState: {
      ...createInitialState(BASE_TIME),
      phase: PHASES.DIRECT_ACTIVE,
      activeRoute: ROUTES.DIRECT,
    },
    now: BASE_TIME,
  });
  const observed = [];
  const handler = createWorkerHandler({
    stateStore: store,
    observe: async (input) => {
      observed.push(input);
      return {
        hostEnvelope: hostEnvelope(input.requestId, {
          hostGeneration: 1,
          activeRoute: ROUTES.DIRECT,
          phase: PHASES.DIRECT_ACTIVE,
          result: 'direct_healthy',
          sharedOk: null,
          directOk: true,
        }),
      };
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
    tagValue: 'babyjamjam-admin-server',
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
      { Key: 'tag:DeploymentTarget', Values: ['babyjamjam-admin-server'] },
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
    tagValue: 'babyjamjam-admin-server',
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
    tagValue: 'babyjamjam-admin-server',
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
    tagValue: 'babyjamjam-admin-server',
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
  assert.throws(
    () => createSsmObserver({
      ...base,
      documentArn: 'arn:aws:ssm:ap-northeast-2:123456789012:document/babyjamjam-preview-db-failover',
      tagValue: 'babyjamjam-preview',
    }),
    /tag value is fixed/,
  );
});
