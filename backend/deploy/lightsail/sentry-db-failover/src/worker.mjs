import { randomUUID } from 'node:crypto';

import {
  CONTROL_PLANE_STATUS,
  DEFAULT_RECONCILE_CONFIG,
  ELIGIBLE_ACTION,
  ELIGIBLE_RESOURCE,
  FAILOVER_SIGNAL_CLASS,
  PHASES,
  ROUTES,
  makeDeterministicRequestId,
  parseBoolean,
  parseCsv,
  safeLog,
} from './constants.mjs';
import {
  ReplayFingerprintExistsError,
  createDynamoStateStore,
} from './state-store.mjs';
import {
  isBodyFingerprint,
  isEligibleAlert,
  isOpaqueUuid,
  isSafeIdentifier,
} from './security.mjs';
import {
  HostResultReplayError,
  HostEnvelopeValidationError,
  isHostTerminalPhase,
  markControlPlaneFailure,
  mirrorHostEnvelope,
  normalizeHostEnvelope,
  normalizeState,
} from './reconciler.mjs';

const TERMINAL_COMMAND_STATUSES = new Set([
  'Success',
  'Cancelled',
  'TimedOut',
  'Failed',
  'Undeliverable',
  'Terminated',
]);

const SWITCHING_PHASES = new Set([
  PHASES.SWITCHING_TO_DIRECT,
  PHASES.SWITCHING_TO_SHARED,
]);

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

class CurrentRequestDeferredError extends Error {
  constructor() {
    super('current request was deferred while reconciling another SSM command');
    this.name = 'CurrentRequestDeferredError';
    this.code = 'CURRENT_REQUEST_DEFERRED';
    this.retryable = true;
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
  return {
    enabled: parseBoolean(env.FAILOVER_ENABLED, false),
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
  ) {
    throw new InvalidQueueMessageError();
  }
  message.bodyFingerprint = bodyFingerprint;
  message.eventId ??= bodyFingerprint;
  return message;
}

function numericTimestamp(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function messageAlreadyProcessed(message, state) {
  const fingerprint = message.bodyFingerprint;
  if (fingerprint && state.lastSentryEventFingerprint === fingerprint) return 'duplicate_event';
  if (fingerprint && state.recentSentryEventFingerprints.includes(fingerprint)) return 'duplicate_event';
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

function oneLineJson(output) {
  if (typeof output !== 'string' || output.trim() === '') return null;
  const trimmed = output.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseStatusOutput(output, expected = {}) {
  const parsed = oneLineJson(output);
  if (!parsed) return null;
  try {
    return normalizeHostEnvelope(parsed, expected);
  } catch (error) {
    if (error instanceof HostEnvelopeValidationError) return null;
    throw error;
  }
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
    if (!isSafeIdentifier(commandId)) throw new Error('SSM did not return a safe command id');
    return commandId;
  }

  async function observe({ state, requestId, identity }) {
    if (state.ssmCommandId) {
      if (!isSafeIdentifier(state.ssmCommandId) || !isOpaqueUuid(state.ssmRequestId)) {
        return {
          controlPlaneOk: false,
          controlPlaneTerminal: true,
          controlPlaneError: 'SSM_REQUEST_ID_MISSING',
          commandId: state.ssmCommandId,
          requestId: state.ssmRequestId,
          commandComplete: true,
          identity: state.ssmRequestIdentity,
        };
      }
      const expectedRequestId = state.ssmRequestId;
      const expectedIdentity = state.ssmRequestIdentity;
      const invocations = await client.send(new commands.ListCommandInvocationsCommand({
        CommandId: state.ssmCommandId,
        Details: true,
      }));
      const entries = invocations?.CommandInvocations ?? [];
      if (entries.length > 1) throw new Error('SSM target tag resolved to more than one node');
      if (entries.length === 0) {
        return {
          controlPlaneOk: false,
          controlPlaneError: 'SSM_INVOCATION_MISSING',
          commandId: state.ssmCommandId,
          requestId: expectedRequestId,
          identity: expectedIdentity,
        };
      }
      const invocation = entries[0];
      const status = invocation?.CommandPlugins?.[0]?.Output
        ?? invocation?.CommandPlugins?.[0]?.OutputContent
        ?? invocation?.StandardOutputContent;
      const terminal = TERMINAL_COMMAND_STATUSES.has(invocation?.Status);
      const envelope = parseStatusOutput(status, {
        environment,
        requestId: expectedRequestId,
      });
      if (!envelope) {
        return {
          controlPlaneOk: false,
          controlPlaneTerminal: terminal,
          controlPlaneError: terminal ? 'INVALID_HOST_RESULT' : 'HOST_RESULT_UNAVAILABLE',
          commandId: state.ssmCommandId,
          requestId: expectedRequestId,
          commandComplete: terminal,
          identity: expectedIdentity,
        };
      }
      return {
        controlPlaneOk: true,
        hostEnvelope: envelope,
        commandId: state.ssmCommandId,
        requestId: expectedRequestId,
        commandComplete: terminal,
        identity: expectedIdentity,
      };
    }

    if (!isOpaqueUuid(requestId)) throw new TypeError('SSM request id must be an opaque UUID');
    const reusableRequestId = state.ssmRequestId === requestId
      && state.ssmRequestIdentity === identity
      && state.controlPlaneStatus !== CONTROL_PLANE_STATUS.BLOCKED
      ? state.ssmRequestId
      : requestId;
    const commandId = await sendFixedCommand(reusableRequestId);
    return {
      controlPlaneOk: true,
      commandId,
      requestId: reusableRequestId,
      commandStarted: true,
      identity,
    };
  }

  observe.requiresDispatchAttemptPersistence = true;
  return { observe, sendFixedCommand };
}

function stopReason(state) {
  if (isHostTerminalPhase(state.phase)) return 'host_terminal';
  if (state.controlPlaneStatus === CONTROL_PLANE_STATUS.BLOCKED) return 'control_plane_blocked';
  if (state.ssmDispatchAttempted === true && !state.ssmCommandId) return 'ssm_command_state_uncertain';
  if (
    SWITCHING_PHASES.has(state.phase)
    && state.ssmRecoveryRequestId
    && !state.ssmCommandId
    && state.controlPlaneStatus !== CONTROL_PLANE_STATUS.OK
  ) {
    return 'transition_recovery_unavailable';
  }
  return null;
}

function identityForMessage(message) {
  return `sentry:${message.bodyFingerprint}`;
}

function identityForSchedule(event) {
  const eventId = typeof event?.id === 'string' ? event.id : '';
  const eventTime = typeof event?.time === 'string' ? event.time : '';
  return `schedule:${eventId}:${eventTime}`;
}

function requestIdForMessage(message) {
  return makeDeterministicRequestId(message.bodyFingerprint);
}

function requestIdForSchedule(event) {
  return makeDeterministicRequestId(identityForSchedule(event));
}

function transitionRecoveryIdentity(state) {
  const transition = state.transition ?? {};
  return [
    'recovery',
    state.phase,
    transition.previousRoute ?? 'none',
    transition.targetRoute ?? 'none',
    transition.startedAt ?? 0,
    transition.generation ?? 0,
  ].join(':');
}

function transitionRecoveryRequestId(state) {
  return makeDeterministicRequestId(transitionRecoveryIdentity(state));
}

function hasRecoverableTransition(state) {
  const transition = state.transition;
  if (!transition || transition.terminalReason !== null
    || !Number.isSafeInteger(transition.startedAt)
    || transition.startedAt <= 0
    || !Number.isSafeInteger(transition.generation)
    || transition.generation <= 0) {
    return false;
  }
  if (state.phase === PHASES.SWITCHING_TO_DIRECT) {
    return transition.previousRoute === ROUTES.SHARED && transition.targetRoute === ROUTES.DIRECT;
  }
  if (state.phase === PHASES.SWITCHING_TO_SHARED) {
    return transition.previousRoute === ROUTES.DIRECT && transition.targetRoute === ROUTES.SHARED;
  }
  return false;
}

function shouldRecoverTransition(state, observation) {
  return observation?.controlPlaneOk !== true
    && observation?.controlPlaneTerminal === true
    && !observation?.hostEnvelope
    && SWITCHING_PHASES.has(state.phase)
    && hasRecoverableTransition(state)
    && state.ssmRecoveryRequestId !== transitionRecoveryRequestId(state);
}

function bindObservationOwner(state, observation, { requestId, identity }) {
  const observed = observation ?? {};
  const ownerRequestId = state.ssmRequestId
    ?? observed.requestId
    ?? observed.hostEnvelope?.requestId
    ?? requestId;
  const ownerIdentity = state.ssmRequestIdentity
    ?? (state.ssmCommandId ? undefined : (observed.identity ?? identity));
  return {
    ...observed,
    requestId: ownerRequestId,
    identity: ownerIdentity,
  };
}

function observationBelongsToRequest(observation, { requestId, identity }) {
  return observation?.requestId === requestId
    && (observation.identity === undefined || observation.identity === identity);
}

async function prepareRequest({
  state,
  stateStore,
  owner,
  generation,
  now,
  requestId,
  identity,
  dispatchAttempted = false,
}) {
  if (state.ssmCommandId) return state;
  const reusable = state.ssmRequestId === requestId
    && state.ssmRequestIdentity === identity
    && state.controlPlaneStatus !== CONTROL_PLANE_STATUS.BLOCKED;
  const next = {
    ...state,
    ssmRequestId: reusable ? state.ssmRequestId : requestId,
    ssmRequestIdentity: identity,
    ssmDispatchAttempted: dispatchAttempted || state.ssmDispatchAttempted === true,
    controlPlaneStatus: CONTROL_PLANE_STATUS.IN_FLIGHT,
    controlPlaneError: null,
    updatedAt: now(),
  };
  await saveHostMirror(stateStore, next, { owner, generation, now: now() });
  return next;
}

async function prepareTransitionRecovery({
  state,
  stateStore,
  owner,
  generation,
  now,
  observe,
}) {
  const identity = transitionRecoveryIdentity(state);
  const requestId = makeDeterministicRequestId(identity);
  const seeded = {
    ...state,
    ssmCommandId: null,
    ssmRequestId: null,
    ssmRequestIdentity: null,
    ssmDispatchAttempted: false,
    ssmRecoveryRequestId: requestId,
    ssmRecoveryIdentity: identity,
  };
  const prepared = await prepareRequest({
    state: seeded,
    stateStore,
    owner,
    generation,
    now,
    requestId,
    identity,
    dispatchAttempted: observe.requiresDispatchAttemptPersistence === true,
  });
  return { state: prepared, requestId, identity };
}

async function saveHostMirror(stateStore, state, options) {
  const method = stateStore.saveHostMirror ?? stateStore.save;
  return method.call(stateStore, state, options);
}

async function saveHostMirrorAndMarkFingerprint(stateStore, state, options) {
  const method = stateStore.saveHostMirrorAndMarkFingerprint ?? stateStore.saveAndMarkFingerprint;
  return method.call(stateStore, state, options);
}

function applyObservation(state, observation, { now, environment, requestId }) {
  const ownerRequestId = state.ssmRequestId
    ?? observation?.requestId
    ?? observation?.hostEnvelope?.requestId
    ?? requestId;
  const ownerIdentity = state.ssmRequestIdentity
    ?? (state.ssmCommandId ? undefined : observation?.identity);
  if (observation?.hostEnvelope) {
    let mirrored;
    try {
      mirrored = mirrorHostEnvelope(state, observation.hostEnvelope, now, {
        environment,
        requestId: ownerRequestId,
      });
    } catch (error) {
      if (!(error instanceof HostResultReplayError) && !(error instanceof HostEnvelopeValidationError)) {
        throw error;
      }
      return {
        state: markControlPlaneFailure(state, {
          status: observation?.commandComplete
            ? CONTROL_PLANE_STATUS.BLOCKED
            : CONTROL_PLANE_STATUS.DEGRADED,
          error: error instanceof HostResultReplayError ? 'HOST_RESULT_REPLAY' : 'INVALID_HOST_RESULT',
          now,
        }),
        reason: error instanceof HostResultReplayError ? 'host_result_rejected' : 'invalid_host_result',
      };
    }
    const hostTerminal = isHostTerminalPhase(mirrored.envelope.phase);
    const next = {
      ...mirrored.state,
      ssmRequestId: ownerRequestId,
      ssmRequestIdentity: ownerIdentity,
      ssmDispatchAttempted: false,
      ssmRecoveryRequestId: null,
      ssmRecoveryIdentity: null,
      ssmCommandId: observation.commandComplete || hostTerminal
        ? null
        : (observation.commandId ?? state.ssmCommandId),
      controlPlaneStatus: observation.commandComplete || hostTerminal
        ? CONTROL_PLANE_STATUS.OK
        : CONTROL_PLANE_STATUS.IN_FLIGHT,
      controlPlaneError: null,
      updatedAt: now,
    };
    return {
      state: next,
      reason: mirrored.reason,
      mirrorStatus: mirrored.status,
    };
  }

  if (observation?.controlPlaneOk !== true) {
    return {
      state: {
        ...markControlPlaneFailure(state, {
          status: observation.controlPlaneTerminal
            ? CONTROL_PLANE_STATUS.BLOCKED
            : CONTROL_PLANE_STATUS.DEGRADED,
          error: observation.controlPlaneError ?? 'AWS_CONTROL_PLANE_FAILURE',
          now,
        }),
        ssmRequestId: ownerRequestId,
        ssmRequestIdentity: ownerIdentity,
        ssmDispatchAttempted: false,
        ssmCommandId: observation.commandId ?? state.ssmCommandId,
      },
      reason: observation.controlPlaneTerminal ? 'invalid_host_result' : 'control_plane_failure',
    };
  }

  return {
    state: {
      ...state,
      ssmRequestId: ownerRequestId,
      ssmRequestIdentity: ownerIdentity,
      ssmDispatchAttempted: observation.commandId || state.ssmCommandId
        ? false
        : state.ssmDispatchAttempted === true,
      ssmCommandId: observation.commandId ?? state.ssmCommandId,
      controlPlaneStatus: observation.commandComplete
        ? CONTROL_PLANE_STATUS.OK
        : CONTROL_PLANE_STATUS.IN_FLIGHT,
      controlPlaneError: null,
      updatedAt: now,
    },
    reason: observation.commandStarted ? 'host_request_started' : 'host_request_observed',
  };
}

async function observeRequest({ observe, state, requestId, identity, trigger, message, logger }) {
  try {
    return await observe({ state, requestId, identity, trigger, message });
  } catch (error) {
    safeLog(logger, 'error', 'failover_observation_failed', {
      requestId,
      reason: error.code ?? 'control_plane_error',
    });
    return {
      controlPlaneOk: false,
      controlPlaneError: 'AWS_CONTROL_PLANE_FAILURE',
      requestId: state.ssmRequestId ?? requestId,
      identity: state.ssmRequestIdentity ?? identity,
      commandId: state.ssmCommandId ?? undefined,
    };
  }
}

async function reconcileObservation({
  state,
  observation,
  stateStore,
  observe,
  owner,
  generation,
  now,
  environment,
  requestId,
  identity,
  logger,
}) {
  let boundObservation = bindObservationOwner(state, observation, { requestId, identity });
  let applied = applyObservation(state, boundObservation, {
    now: now(),
    environment,
    requestId,
  });
  let nextState = applied.state;
  let dispatchAttemptPersisted = state.ssmDispatchAttempted === true;

  if (shouldRecoverTransition(state, boundObservation)) {
    const recovery = await prepareTransitionRecovery({
      state: nextState,
      stateStore,
      owner,
      generation,
      now,
      observe,
    });
    const recoveryObservation = await observeRequest({
      observe,
      state: recovery.state,
      requestId: recovery.requestId,
      identity: recovery.identity,
      trigger: 'recovery',
      logger,
    });
    boundObservation = bindObservationOwner(recovery.state, recoveryObservation, {
      requestId: recovery.requestId,
      identity: recovery.identity,
    });
    applied = applyObservation(recovery.state, boundObservation, {
      now: now(),
      environment,
      requestId: recovery.requestId,
    });
    nextState = applied.state;
    dispatchAttemptPersisted = recovery.state.ssmDispatchAttempted === true;
  }

  return {
    state: nextState,
    observation: boundObservation,
    applied,
    dispatchAttemptPersisted,
  };
}

async function releaseLeaseQuietly(stateStore, owner, generation, now) {
  try {
    await stateStore.releaseLease({ owner, generation, now: now() });
  } catch {
    // Ownership may already have expired or been replaced after a failed write.
  }
}

async function processMessage({
  message,
  stateStore,
  config,
  observe,
  now,
  owner,
  logger,
}) {
  if (!isEligibleAlert(message, config)) return { status: 'ignored', reason: 'ineligible' };
  if (await stateStore.hasProcessedFingerprint(message.bodyFingerprint)) {
    return { status: 'ignored', reason: 'duplicate_event' };
  }
  const loaded = normalizeState((await stateStore.get()) ?? undefined, now());
  const loadedStopReason = stopReason(loaded);
  if (loadedStopReason) return { status: 'ignored', reason: loadedStopReason };
  if (loaded.activeRoute !== ROUTES.SHARED) return { status: 'ignored', reason: 'current_route_not_shared' };
  const beforeLeaseReason = messageAlreadyProcessed(message, loaded);
  if (beforeLeaseReason) return { status: 'ignored', reason: beforeLeaseReason };

  const lease = await stateStore.acquireLease({ owner, now: now(), leaseMs: config.leaseMs });
  if (!lease?.acquired) throw new LeaseUnavailableError();
  const generation = lease.generation ?? lease.state.generation;
  try {
    let state = normalizeState(lease.state, now());
    const afterLeaseReason = messageAlreadyProcessed(message, state);
    if (afterLeaseReason) return { status: 'ignored', reason: afterLeaseReason };
    if (await stateStore.hasProcessedFingerprint(message.bodyFingerprint)) {
      return { status: 'ignored', reason: 'duplicate_event' };
    }
    const afterLeaseStopReason = stopReason(state);
    if (afterLeaseStopReason) return { status: 'ignored', reason: afterLeaseStopReason };
    if (state.activeRoute !== ROUTES.SHARED) return { status: 'ignored', reason: 'current_route_not_shared' };

    const identity = identityForMessage(message);
    const requestId = requestIdForMessage(message);
    state = await prepareRequest({
      state,
      stateStore,
      owner,
      generation,
      now,
      requestId,
      identity,
      dispatchAttempted: observe.requiresDispatchAttemptPersistence === true,
    });
    const observation = await observeRequest({
      observe,
      state,
      requestId,
      identity,
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
      logger,
    });
    const reconciled = await reconcileObservation({
      state,
      observation,
      stateStore,
      observe,
      owner,
      generation,
      now,
      environment: config.environment,
      requestId,
      identity,
      logger,
    });
    state = reconciled.state;
    if (!observationBelongsToRequest(reconciled.observation, { requestId, identity })) {
      await saveHostMirror(stateStore, state, { owner, generation, now: now() });
      throw new CurrentRequestDeferredError();
    }
    if (reconciled.dispatchAttemptPersisted || (reconciled.observation?.commandId && state.ssmCommandId)) {
      await saveHostMirror(stateStore, state, { owner, generation, now: now() });
    }
    rememberMessage(state, message);
    await saveHostMirrorAndMarkFingerprint(stateStore, state, {
      owner,
      generation,
      now: now(),
      fingerprint: message.bodyFingerprint,
    });
    safeLog(logger, 'info', 'failover_reconciled', {
      requestId,
      phase: state.phase,
      activeRoute: state.activeRoute,
      reason: reconciled.applied.reason,
    });
    return {
      status: 'processed',
      phase: state.phase,
      activeRoute: state.activeRoute,
      hostGeneration: state.hostGeneration,
      reason: reconciled.applied.reason,
    };
  } catch (error) {
    if (error instanceof ReplayFingerprintExistsError) {
      return { status: 'ignored', reason: 'duplicate_event' };
    }
    throw error;
  } finally {
    await releaseLeaseQuietly(stateStore, owner, generation, now);
  }
}

async function processScheduled({
  event,
  stateStore,
  config,
  observe,
  now,
  owner,
  logger,
}) {
  const lease = await stateStore.acquireLease({ owner, now: now(), leaseMs: config.leaseMs });
  if (!lease?.acquired) throw new LeaseUnavailableError();
  const generation = lease.generation ?? lease.state.generation;
  try {
    let state = normalizeState(lease.state, now());
    const terminalReason = stopReason(state);
    if (terminalReason) return { status: 'ignored', reason: terminalReason };

    const identity = identityForSchedule(event);
    const requestId = requestIdForSchedule(event);
    state = await prepareRequest({
      state,
      stateStore,
      owner,
      generation,
      now,
      requestId,
      identity,
      dispatchAttempted: observe.requiresDispatchAttemptPersistence === true,
    });
    const observation = await observeRequest({
      observe,
      state,
      requestId,
      identity,
      trigger: 'schedule',
      logger,
    });
    const reconciled = await reconcileObservation({
      state,
      observation,
      stateStore,
      observe,
      owner,
      generation,
      now,
      environment: config.environment,
      requestId,
      identity,
      logger,
    });
    state = reconciled.state;
    if (reconciled.dispatchAttemptPersisted || (reconciled.observation?.commandId && state.ssmCommandId)) {
      await saveHostMirror(stateStore, state, { owner, generation, now: now() });
    }
    await saveHostMirror(stateStore, state, { owner, generation, now: now() });
    safeLog(logger, 'info', 'failover_reconciled', {
      requestId,
      phase: state.phase,
      activeRoute: state.activeRoute,
      reason: reconciled.applied.reason,
    });
    return {
      status: 'processed',
      phase: state.phase,
      activeRoute: state.activeRoute,
      hostGeneration: state.hostGeneration,
      reason: reconciled.applied.reason,
    };
  } finally {
    await releaseLeaseQuietly(stateStore, owner, generation, now);
  }
}

export function createWorkerHandler({
  stateStore,
  observe,
  config = readWorkerConfig(),
  now = () => Date.now(),
  ownerFactory = (context) => context?.awsRequestId ?? `worker-${randomUUID()}`,
  logger = defaultLogger(),
} = {}) {
  if (!stateStore || typeof stateStore.get !== 'function') throw new TypeError('state store is required');
  if (typeof observe !== 'function') throw new TypeError('observation provider is required');
  if (
    (typeof stateStore.saveHostMirror !== 'function' && typeof stateStore.save !== 'function')
    || (
      typeof stateStore.saveHostMirrorAndMarkFingerprint !== 'function'
      && typeof stateStore.saveAndMarkFingerprint !== 'function'
    )
  ) {
    throw new TypeError('state store write methods are required');
  }

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
          event,
          stateStore,
          config,
          observe,
          now,
          owner,
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
          logger,
        });
        results.push(result);
      } catch (error) {
        safeLog(logger, 'error', 'failover_message_failed', {
          messageId: record?.messageId,
          reason: error.name ?? 'worker_error',
        });
        failures.push({ itemIdentifier: record?.messageId });
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
    {
      DynamoDBClient,
      GetItemCommand,
      PutItemCommand,
      UpdateItemCommand,
      TransactWriteItemsCommand,
    },
    { SSMClient, SendCommandCommand, ListCommandInvocationsCommand },
  ] = await Promise.all([
    import('@aws-sdk/client-dynamodb'),
    import('@aws-sdk/client-ssm'),
  ]);
  const config = readWorkerConfig();
  const stateStore = createDynamoStateStore({
    client: new DynamoDBClient({}),
    commands: {
      GetItemCommand,
      PutItemCommand,
      UpdateItemCommand,
      TransactWriteItemsCommand,
    },
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
  identityForMessage,
  identityForSchedule,
  processMessage,
  processScheduled,
  readWorkerConfig,
};
