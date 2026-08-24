import { randomUUID } from 'node:crypto';

import {
  DEFAULT_RECONCILE_CONFIG,
  ELIGIBLE_ACTION,
  ELIGIBLE_RESOURCE,
  FAILOVER_SIGNAL_CLASS,
  PHASES,
  ROUTES,
  makeOpaqueRequestId,
  parseBoolean,
  parseCsv,
  safeLog,
} from './constants.mjs';
import {
  ConditionalStateWriteError,
  createDynamoStateStore,
} from './state-store.mjs';
import {
  isBodyFingerprint,
  isEligibleAlert,
  isOpaqueUuid,
} from './security.mjs';
import {
  normalizeState,
  reconcileState,
} from './reconciler.mjs';

class LeaseUnavailableError extends Error {
  constructor() {
    super('failover state lease is held by another worker');
    this.name = 'LeaseUnavailableError';
    this.retryable = true;
  }
}

class InvalidQueueMessageError extends Error {
  constructor() {
    super('invalid failover queue message');
    this.name = 'InvalidQueueMessageError';
    this.retryable = false;
  }
}

function defaultLogger() {
  return {
    info(fields) {
      console.info(JSON.stringify(fields));
    },
    warn(fields) {
      console.warn(JSON.stringify(fields));
    },
    error(fields) {
      console.error(JSON.stringify(fields));
    },
  };
}

function readWorkerConfig(env = process.env) {
  const enabled = parseBoolean(env.FAILOVER_ENABLED, false);
  return {
    enabled,
    environment: env.FAILOVER_ENVIRONMENT?.trim(),
    allowedResources: parseCsv(env.SENTRY_ALLOWED_RESOURCES, [ELIGIBLE_RESOURCE]),
    allowedActions: parseCsv(env.SENTRY_ALLOWED_ACTIONS, [ELIGIBLE_ACTION]),
    allowedRoutes: parseCsv(env.SENTRY_ALLOWED_ROUTES, [ROUTES.SHARED]),
    ruleIds: parseCsv(env.SENTRY_RULE_IDS),
    stateKey: env.FAILOVER_STATE_KEY ?? `db-failover/${env.FAILOVER_ENVIRONMENT ?? 'unknown'}`,
    ...DEFAULT_RECONCILE_CONFIG,
  };
}

function parseQueueMessage(record) {
  const body = record?.body;
  if (typeof body !== 'string' || body.length === 0) throw new InvalidQueueMessageError();
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    throw new InvalidQueueMessageError();
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new InvalidQueueMessageError();
  }
  const bodyFingerprint = message.bodyFingerprint ?? message.eventId;
  if (
    !isBodyFingerprint(bodyFingerprint)
    || message.failoverEligible !== true
    || message.signalClass !== FAILOVER_SIGNAL_CLASS
    || !message.action
    || !message.resource
    || !message.environment
    || !message.ruleId
    || message.eventAt === undefined
    || message.eventAt === null
  ) {
    throw new InvalidQueueMessageError();
  }
  message.bodyFingerprint = bodyFingerprint;
  message.eventId ??= bodyFingerprint;
  return message;
}

function numericTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function messageAlreadyProcessed(message, state) {
  const fingerprint = message.bodyFingerprint;
  if (fingerprint && state.lastSentryEventFingerprint === fingerprint) return 'duplicate_event';
  if (fingerprint && state.recentSentryEventFingerprints.includes(fingerprint)) return 'duplicate_event';
  const eventAt = numericTimestamp(message.eventAt);
  if (eventAt > 0 && state.lastSentryEventAt > 0 && eventAt < state.lastSentryEventAt) {
    return 'out_of_order';
  }
  return null;
}

function rememberMessage(state, message) {
  const fingerprint = isBodyFingerprint(message.bodyFingerprint) ? message.bodyFingerprint : null;
  if (fingerprint) {
    state.lastSentryEventFingerprint = fingerprint;
    state.recentSentryEventFingerprints = [
      ...state.recentSentryEventFingerprints.filter((value) => value !== fingerprint),
      fingerprint,
    ].slice(-32);
  }
  const eventAt = numericTimestamp(message.eventAt);
  if (eventAt > state.lastSentryEventAt) state.lastSentryEventAt = eventAt;
}

function normalizeStatusValue(status) {
  if (!status || typeof status !== 'object') return null;
  const source = status.result && typeof status.result === 'object' ? status.result : status;
  const sharedOk = typeof source.sharedOk === 'boolean' ? source.sharedOk : null;
  const directOk = typeof source.directOk === 'boolean' ? source.directOk : null;
  const observedRoute = typeof (source.activeRoute ?? source.route) === 'string'
    ? (source.activeRoute ?? source.route).toUpperCase()
    : undefined;
  const activeRoute = observedRoute === ROUTES.SHARED || observedRoute === ROUTES.DIRECT
    ? observedRoute
    : undefined;
  const commandId = isOpaqueUuid(source.commandId) ? source.commandId : undefined;
  if (sharedOk === null && directOk === null && !activeRoute) return null;
  return {
    controlPlaneOk: source.controlPlaneOk !== false,
    sharedOk,
    directOk,
    activeRoute,
    commandId,
    observedAt: source.observedAt,
  };
}

export function parseStatusOutput(output) {
  if (typeof output !== 'string' || output.trim() === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  return normalizeStatusValue(parsed);
}

export function createSsmObserver({
  client,
  commands,
  documentArn,
  tagKey = 'DeploymentTarget',
  tagValue,
  environment,
  timeoutSeconds = 55,
} = {}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('SSM client is required');
  if (!commands?.SendCommandCommand || !commands?.ListCommandInvocationsCommand) {
    throw new TypeError('SSM command constructors are required');
  }
  if (typeof documentArn !== 'string' || documentArn.length === 0) {
    throw new TypeError('fixed SSM document ARN is required');
  }
  if (typeof tagValue !== 'string' || tagValue.length === 0) throw new TypeError('managed node tag value is required');
  if (typeof environment !== 'string' || environment.length === 0) throw new TypeError('managed node environment is required');
  if (!['preview', 'production'].includes(environment)) throw new TypeError('unsupported managed node environment');
  if (tagKey !== 'DeploymentTarget') throw new TypeError('managed node tag key is fixed');
  const fixedDocumentPattern = new RegExp(
    `^arn:[A-Za-z0-9-]+:ssm:[A-Za-z0-9-]+:[0-9]{12}:document/babyjamjam-${environment}-db-failover$`,
  );
  if (!fixedDocumentPattern.test(documentArn)) throw new TypeError('SSM document is not fixed for the environment');

  async function sendFixedCommand(requestId) {
    if (!isOpaqueUuid(requestId)) throw new TypeError('SSM request id must be an opaque UUID');
    const result = await client.send(new commands.SendCommandCommand({
      DocumentName: documentArn,
      Targets: [
        { Key: `tag:${tagKey}`, Values: [tagValue] },
        { Key: 'tag:Environment', Values: [environment] },
      ],
      Parameters: { RequestId: [requestId] },
      MaxConcurrency: '1',
      MaxErrors: '0',
      TimeoutSeconds: timeoutSeconds,
    }));
    const commandId = result?.Command?.CommandId;
    if (typeof commandId !== 'string' || commandId.length === 0) {
      throw new Error('SSM did not return a command id');
    }
    return commandId;
  }

  async function observe({ state, requestId }) {
    if (state.ssmCommandId) {
      const invocations = await client.send(new commands.ListCommandInvocationsCommand({
        CommandId: state.ssmCommandId,
        Details: true,
      }));
      const entries = invocations?.CommandInvocations ?? [];
      if (entries.length > 1) throw new Error('SSM target tag resolved to more than one node');
      if (entries.length === 0) {
        return { controlPlaneOk: false, commandId: state.ssmCommandId };
      }
      const invocation = entries[0];
      const status = invocation?.CommandPlugins?.[0]?.Output
        ?? invocation?.CommandPlugins?.[0]?.OutputContent
        ?? invocation?.StandardOutputContent;
      const terminal = ['Success', 'Cancelled', 'TimedOut', 'Failed', 'Undeliverable', 'Terminated']
        .includes(invocation?.Status);
      const parsed = parseStatusOutput(status);
      if (parsed) {
        return {
          ...parsed,
          commandId: state.ssmCommandId,
          commandComplete: terminal,
        };
      }
      if (terminal) {
        return {
          controlPlaneOk: false,
          commandId: state.ssmCommandId,
          commandComplete: true,
        };
      }
      return { controlPlaneOk: true, sharedOk: null, directOk: null, commandId: state.ssmCommandId };
    }
    const commandId = await sendFixedCommand(requestId);
    return { controlPlaneOk: true, sharedOk: null, directOk: null, commandId };
  }

  return { observe, sendFixedCommand };
}

async function processMessage({
  message,
  stateStore,
  config,
  observe,
  now,
  owner,
  idFactory,
  logger,
}) {
  if (!isEligibleAlert(message, config)) return { status: 'ignored', reason: 'ineligible' };
  const loaded = (await stateStore.get()) ?? normalizeState(undefined, now());
  if (loaded.phase === PHASES.BLOCKED) return { status: 'ignored', reason: 'blocked' };
  if (loaded.activeRoute !== ROUTES.SHARED) return { status: 'ignored', reason: 'current_route_not_shared' };
  const beforeLeaseReason = messageAlreadyProcessed(message, loaded);
  if (beforeLeaseReason) return { status: 'ignored', reason: beforeLeaseReason };

  const lease = await stateStore.acquireLease({
    owner,
    now: now(),
    leaseMs: config.leaseMs,
  });
  if (!lease?.acquired) throw new LeaseUnavailableError();

  const generation = lease.generation ?? lease.state.generation;
  const state = normalizeState(lease.state, now());
  const afterLeaseReason = messageAlreadyProcessed(message, state);
  if (afterLeaseReason) {
    await stateStore.releaseLease({ owner, generation, now: now() });
    return { status: 'ignored', reason: afterLeaseReason };
  }
  if (state.phase === PHASES.BLOCKED) {
    await stateStore.releaseLease({ owner, generation, now: now() });
    return { status: 'ignored', reason: 'blocked' };
  }
  if (state.activeRoute !== ROUTES.SHARED) {
    await stateStore.releaseLease({ owner, generation, now: now() });
    return { status: 'ignored', reason: 'current_route_not_shared' };
  }

  const ssmRequestId = makeOpaqueRequestId(idFactory);
  let observation;
  try {
    observation = await observe({
      state,
      requestId: ssmRequestId,
      trigger: 'sentry',
      message: {
        eventId: message.eventId,
        bodyFingerprint: message.bodyFingerprint,
        failoverEligible: message.failoverEligible,
        signalClass: message.signalClass,
        action: message.action,
        resource: message.resource,
        environment: message.environment,
        ruleId: message.ruleId,
      },
    });
  } catch (error) {
    safeLog(logger, 'error', 'failover_observation_failed', {
      requestId: ssmRequestId,
      reason: error.code ?? 'control_plane_error',
    });
    observation = { controlPlaneOk: false };
  }

  const result = reconcileState(state, observation, now(), config);
  rememberMessage(result.state, message);
  result.state.ssmCommandId = observation?.commandComplete
    ? null
    : (observation?.commandId ?? result.state.ssmCommandId);
  await stateStore.save(result.state, { owner, generation, now: now() });
  await stateStore.releaseLease({ owner, generation, now: now() });
  safeLog(logger, 'info', 'failover_reconciled', {
    requestId: ssmRequestId,
    phase: result.state.phase,
    activeRoute: result.state.activeRoute,
    reason: result.reason,
  });
  return {
    status: 'processed',
    phase: result.state.phase,
    activeRoute: result.state.activeRoute,
    reason: result.reason,
  };
}

async function processScheduled({ stateStore, config, observe, now, owner, idFactory, logger }) {
  const lease = await stateStore.acquireLease({
    owner,
    now: now(),
    leaseMs: config.leaseMs,
  });
  if (!lease?.acquired) throw new LeaseUnavailableError();
  const generation = lease.generation ?? lease.state.generation;
  const state = normalizeState(lease.state, now());
  if (state.phase === PHASES.BLOCKED) {
    await stateStore.releaseLease({ owner, generation, now: now() });
    return { status: 'ignored', reason: 'blocked' };
  }
  const ssmRequestId = makeOpaqueRequestId(idFactory);
  let observation;
  try {
    observation = await observe({ state, requestId: ssmRequestId, trigger: 'schedule' });
  } catch (error) {
    safeLog(logger, 'error', 'failover_observation_failed', {
      requestId: ssmRequestId,
      reason: error.code ?? 'control_plane_error',
    });
    observation = { controlPlaneOk: false };
  }
  const result = reconcileState(state, observation, now(), config);
  result.state.ssmCommandId = observation?.commandComplete
    ? null
    : (observation?.commandId ?? result.state.ssmCommandId);
  await stateStore.save(result.state, { owner, generation, now: now() });
  await stateStore.releaseLease({ owner, generation, now: now() });
  safeLog(logger, 'info', 'failover_reconciled', {
    requestId: ssmRequestId,
    phase: result.state.phase,
    activeRoute: result.state.activeRoute,
    reason: result.reason,
  });
  return {
    status: 'processed',
    phase: result.state.phase,
    activeRoute: result.state.activeRoute,
    reason: result.reason,
  };
}

export function createWorkerHandler({
  stateStore,
  observe,
  config = readWorkerConfig(),
  now = () => Date.now(),
  ownerFactory = (context) => context?.awsRequestId ?? `worker-${randomUUID()}`,
  idFactory = randomUUID,
  logger = defaultLogger(),
} = {}) {
  if (!stateStore || typeof stateStore.get !== 'function') throw new TypeError('state store is required');
  if (typeof observe !== 'function') throw new TypeError('observation provider is required');

  return async function workerHandler(event, context = {}) {
    if (!config.enabled) {
      safeLog(logger, 'info', 'failover_disabled');
      return { processed: 0, skipped: 'disabled', batchItemFailures: [] };
    }
    const owner = ownerFactory(context);
    const records = Array.isArray(event?.Records) ? event.Records : [];
    if (records.length === 0) {
      try {
        const result = await processScheduled({
          stateStore,
          config,
          observe,
          now,
          owner,
          idFactory,
          logger,
        });
        return { processed: 1, results: [result], batchItemFailures: [] };
      } catch (error) {
        if (error instanceof LeaseUnavailableError) {
          return { processed: 0, skipped: 'lease_unavailable', batchItemFailures: [] };
        }
        throw error;
      }
    }

    const results = [];
    const failures = [];
    for (const record of records) {
      try {
        const message = parseQueueMessage(record);
        const result = await processMessage({
          message,
          stateStore,
          config,
          observe,
          now,
          owner,
          idFactory,
          logger,
        });
        results.push(result);
      } catch (error) {
        safeLog(logger, 'error', 'failover_message_failed', {
          messageId: record?.messageId,
          reason: error.name ?? 'worker_error',
        });
        if (error instanceof InvalidQueueMessageError || error instanceof ConditionalStateWriteError) {
          failures.push({ itemIdentifier: record?.messageId });
        } else {
          failures.push({ itemIdentifier: record?.messageId });
        }
      }
    }
    return {
      processed: results.length,
      results,
      batchItemFailures: failures.filter((entry) => typeof entry.itemIdentifier === 'string'),
    };
  };
}

async function createDefaultWorkerHandler() {
  const [
    { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand },
    { SSMClient, SendCommandCommand, ListCommandInvocationsCommand },
  ] = await Promise.all([
    import('@aws-sdk/client-dynamodb'),
    import('@aws-sdk/client-ssm'),
  ]);
  const config = readWorkerConfig();
  const stateStore = createDynamoStateStore({
    client: new DynamoDBClient({}),
    commands: { GetItemCommand, PutItemCommand, UpdateItemCommand },
    tableName: process.env.FAILOVER_STATE_TABLE_NAME,
    stateKey: config.stateKey,
  });
  const ssmObserver = createSsmObserver({
    client: new SSMClient({}),
    commands: { SendCommandCommand, ListCommandInvocationsCommand },
    documentArn: process.env.FAILOVER_DOCUMENT_ARN,
    tagKey: process.env.FAILOVER_MANAGED_NODE_TAG_KEY,
    tagValue: process.env.FAILOVER_MANAGED_NODE_TAG_VALUE,
    environment: process.env.FAILOVER_ENVIRONMENT,
  });
  return createWorkerHandler({ stateStore, observe: ssmObserver.observe, config });
}

let defaultHandlerPromise;

export async function handler(event, context) {
  defaultHandlerPromise ??= createDefaultWorkerHandler();
  const worker = await defaultHandlerPromise;
  return worker(event, context);
}

export {
  InvalidQueueMessageError,
  LeaseUnavailableError,
  processMessage,
  readWorkerConfig,
};
