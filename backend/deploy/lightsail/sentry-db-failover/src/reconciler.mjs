import {
  CONTROL_PLANE_STATUS,
  HOST_RESULT_KEYS,
  HOST_RESULT_MAX_HISTORY_LENGTH,
  HOST_RESULT_MAX_NUMBER,
  HOST_RESULT_MAX_TOKEN_LENGTH,
  HOST_RESULT_SCHEMA_VERSION,
  HOST_RESULT_SOURCE,
  HOST_TRANSITION_KEYS,
  PHASES,
  ROUTES,
  UUID_PATTERN,
  createInitialState,
} from './constants.mjs';

const NON_NEGATIVE_FIELDS = Object.freeze([
  'hostGeneration',
  'sharedFailureCount',
  'directSuccessCount',
  'directFailureCount',
  'emergencySharedSuccessCount',
  'sharedHealthyCount',
  'directActivatedAt',
  'sharedHealthyStartedAt',
  'sharedHealthyLastAt',
  'cooldownUntil',
]);

const TERMINAL_PHASES = new Set([PHASES.BLOCKED, PHASES.DEGRADED]);
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const SECRET_LIKE_PATTERN = /(secret|password|credential|bearer|api[_-]?key|access[_-]?token|https?:|arn:|postgres(?:ql)?)/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function isBoundedNonNegativeInteger(value) {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= HOST_RESULT_MAX_NUMBER;
}

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeToken(value) {
  return typeof value === 'string'
    && value.length <= HOST_RESULT_MAX_TOKEN_LENGTH
    && TOKEN_PATTERN.test(value)
    && !SECRET_LIKE_PATTERN.test(value);
}

function isNullableSafeToken(value) {
  return value === null || isSafeToken(value);
}

function isNullableRoute(value) {
  return value === null || value === ROUTES.SHARED || value === ROUTES.DIRECT;
}

function isEmptyTransition(transition) {
  return transition.previousRoute === null
    && transition.targetRoute === null
    && transition.startedAt === 0
    && transition.generation === 0;
}

function invalid(message, code = 'INVALID_HOST_RESULT') {
  return new HostEnvelopeValidationError(message, code);
}

function validateTransition(transition) {
  if (!isPlainObject(transition) || !hasExactKeys(transition, HOST_TRANSITION_KEYS)) {
    throw invalid('host transition is incomplete');
  }
  if (!isNullableRoute(transition.previousRoute) || !isNullableRoute(transition.targetRoute)) {
    throw invalid('host transition route is invalid');
  }
  if (!isBoundedNonNegativeInteger(transition.startedAt)) {
    throw invalid('host transition start is invalid');
  }
  if (!isBoundedNonNegativeInteger(transition.generation)) {
    throw invalid('host transition generation is invalid');
  }
  if (!isNullableSafeToken(transition.terminalReason)) {
    throw invalid('host transition terminal reason is invalid');
  }
}

function validatePhaseRouteTransition(envelope) {
  const { phase, activeRoute: route, transition, terminalReason } = envelope;
  if (TERMINAL_PHASES.has(phase)) {
    if (!isEmptyTransition(transition) || transition.terminalReason !== terminalReason) {
      throw invalid('terminal host result has invalid transition metadata');
    }
    if (!isSafeToken(terminalReason)) throw invalid('terminal host result has no reason');
    return;
  }

  if (terminalReason !== null || transition.terminalReason !== null) {
    throw invalid('non-terminal host result has a terminal reason');
  }

  if (phase === PHASES.SHARED_ACTIVE || phase === PHASES.DIRECT_ACTIVE) {
    const expectedRoute = phase === PHASES.SHARED_ACTIVE ? ROUTES.SHARED : ROUTES.DIRECT;
    if (route !== expectedRoute || !isEmptyTransition(transition)) {
      throw invalid('active host phase has invalid route or transition');
    }
    return;
  }

  if (phase === PHASES.RECOVERING_SHARED) {
    if (route !== ROUTES.DIRECT || !isEmptyTransition(transition)) {
      throw invalid('recovering host phase has invalid route or transition');
    }
    return;
  }

  const switchingToDirect = phase === PHASES.SWITCHING_TO_DIRECT;
  const switchingToShared = phase === PHASES.SWITCHING_TO_SHARED;
  if (!switchingToDirect && !switchingToShared) throw invalid('host phase is invalid');

  const previousRoute = switchingToDirect ? ROUTES.SHARED : ROUTES.DIRECT;
  const targetRoute = switchingToDirect ? ROUTES.DIRECT : ROUTES.SHARED;
  const activeRoute = switchingToDirect ? ROUTES.SHARED : ROUTES.DIRECT;
  if (
    route !== activeRoute
    || transition.previousRoute !== previousRoute
    || transition.targetRoute !== targetRoute
    || transition.startedAt === 0
    || transition.generation === 0
    || transition.generation > envelope.hostGeneration
  ) {
    throw invalid('switching host phase has invalid route or transition');
  }
}

export class HostEnvelopeValidationError extends Error {
  constructor(message = 'invalid host result envelope', code = 'INVALID_HOST_RESULT') {
    super(message);
    this.name = 'HostEnvelopeValidationError';
    this.code = code;
    this.retryable = false;
  }
}

export class HostResultReplayError extends Error {
  constructor(message = 'host result generation is stale or conflicting') {
    super(message);
    this.name = 'HostResultReplayError';
    this.code = 'HOST_RESULT_REPLAY';
    this.retryable = false;
  }
}

export function normalizeHostEnvelope(raw, { environment, requestId } = {}) {
  if (!isPlainObject(raw) || !hasExactKeys(raw, HOST_RESULT_KEYS)) {
    throw invalid('host result envelope is incomplete or has unexpected fields');
  }
  if (raw.schemaVersion !== HOST_RESULT_SCHEMA_VERSION) throw invalid('host result schema version is invalid');
  if (raw.source !== HOST_RESULT_SOURCE) throw invalid('host result source is invalid');
  if (raw.controlPlaneOk !== true) throw invalid('host result control-plane flag is invalid');
  if (
    typeof raw.environment !== 'string'
    || raw.environment.length > HOST_RESULT_MAX_TOKEN_LENGTH
    || !['preview', 'production'].includes(raw.environment)
    || (environment !== undefined && raw.environment !== environment)
  ) {
    throw invalid('host result environment is invalid');
  }
  if (typeof raw.requestId !== 'string' || !UUID_PATTERN.test(raw.requestId)) {
    throw invalid('host result request id is invalid');
  }
  if (requestId !== undefined && raw.requestId !== requestId) {
    throw invalid('host result request id does not match the SSM request');
  }
  if (!isBoundedNonNegativeInteger(raw.hostGeneration)) throw invalid('host result generation is invalid');
  if (!Object.values(ROUTES).includes(raw.activeRoute)) throw invalid('host result route is invalid');
  if (!Object.values(PHASES).includes(raw.phase)) throw invalid('host result phase is invalid');
  if (!isSafeToken(raw.result)) throw invalid('host result result token is invalid');
  if (![null, true, false].includes(raw.sharedOk) || ![null, true, false].includes(raw.directOk)) {
    throw invalid('host probe result is invalid');
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    if (!isBoundedNonNegativeInteger(raw[field])) throw invalid(`host ${field} is invalid`);
  }
  if (
    !Array.isArray(raw.recentNormalRoundTrips)
    || raw.recentNormalRoundTrips.length > HOST_RESULT_MAX_HISTORY_LENGTH
    || raw.recentNormalRoundTrips.some((entry, index, values) => (
      !isBoundedNonNegativeInteger(entry)
      || (index > 0 && entry < values[index - 1])
    ))
  ) {
    throw invalid('host round-trip history is invalid');
  }
  validateTransition(raw.transition);
  if (!isNullableSafeToken(raw.terminalReason)) throw invalid('host terminal reason is invalid');
  validatePhaseRouteTransition(raw);

  return {
    schemaVersion: raw.schemaVersion,
    source: raw.source,
    controlPlaneOk: raw.controlPlaneOk,
    environment: raw.environment,
    requestId: raw.requestId,
    hostGeneration: raw.hostGeneration,
    activeRoute: raw.activeRoute,
    phase: raw.phase,
    result: raw.result,
    sharedOk: raw.sharedOk,
    directOk: raw.directOk,
    sharedFailureCount: raw.sharedFailureCount,
    directSuccessCount: raw.directSuccessCount,
    directFailureCount: raw.directFailureCount,
    emergencySharedSuccessCount: raw.emergencySharedSuccessCount,
    sharedHealthyCount: raw.sharedHealthyCount,
    directActivatedAt: raw.directActivatedAt,
    sharedHealthyStartedAt: raw.sharedHealthyStartedAt,
    sharedHealthyLastAt: raw.sharedHealthyLastAt,
    cooldownUntil: raw.cooldownUntil,
    recentNormalRoundTrips: [...raw.recentNormalRoundTrips],
    transition: { ...raw.transition },
    terminalReason: raw.terminalReason,
  };
}

function normalizeStateValue(value, fallback, predicate) {
  return predicate(value) ? value : fallback;
}

export function normalizeState(state, now = Date.now()) {
  const initial = createInitialState(now);
  const normalized = { ...initial, ...(state ?? {}) };
  for (const obsoleteField of [
    'errorTerminalPhase',
    'lastErrorCode',
    'pendingTransition',
    'pendingRoundTripKind',
    'recentRoundTripCount',
    'recentRoundTripHistory',
    'sharedHealthySince',
    'lastSentryRequestId',
    'recentSentryRequestIds',
  ]) {
    delete normalized[obsoleteField];
  }
  normalized.generation = normalizeStateValue(
    normalized.generation,
    initial.generation,
    isSafeNonNegativeInteger,
  );
  normalized.leaseExpiresAt = normalizeStateValue(
    normalized.leaseExpiresAt,
    initial.leaseExpiresAt,
    isSafeNonNegativeInteger,
  );
  normalized.leaseOwner = normalized.leaseOwner === null || typeof normalized.leaseOwner === 'string'
    ? normalized.leaseOwner
    : null;
  if (!Object.values(PHASES).includes(normalized.phase)) normalized.phase = initial.phase;
  if (!Object.values(ROUTES).includes(normalized.activeRoute)) normalized.activeRoute = initial.activeRoute;
  normalized.hostGeneration = normalizeStateValue(
    normalized.hostGeneration,
    initial.hostGeneration,
    isBoundedNonNegativeInteger,
  );
  for (const field of NON_NEGATIVE_FIELDS.slice(1)) {
    normalized[field] = normalizeStateValue(normalized[field], initial[field], isBoundedNonNegativeInteger);
  }
  normalized.sharedOk = [null, true, false].includes(normalized.sharedOk) ? normalized.sharedOk : null;
  normalized.directOk = [null, true, false].includes(normalized.directOk) ? normalized.directOk : null;
  normalized.recentNormalRoundTrips = Array.isArray(normalized.recentNormalRoundTrips)
    ? normalized.recentNormalRoundTrips.filter(isBoundedNonNegativeInteger).slice(-HOST_RESULT_MAX_HISTORY_LENGTH)
    : [];
  normalized.transition = isPlainObject(normalized.transition)
    && HOST_TRANSITION_KEYS.every((key) => key in normalized.transition)
    ? { ...normalized.transition }
    : clone(initial.transition);
  normalized.recentSentryEventFingerprints = Array.isArray(normalized.recentSentryEventFingerprints)
    ? normalized.recentSentryEventFingerprints.filter((value) => typeof value === 'string').slice(-32)
    : [];
  normalized.lastSentryEventFingerprint = typeof normalized.lastSentryEventFingerprint === 'string'
    ? normalized.lastSentryEventFingerprint
    : null;
  normalized.lastSentryEventAt = isSafeNonNegativeInteger(normalized.lastSentryEventAt)
    ? normalized.lastSentryEventAt
    : 0;
  normalized.lastObservedAt = isSafeNonNegativeInteger(normalized.lastObservedAt)
    ? normalized.lastObservedAt
    : now;
  normalized.updatedAt = isSafeNonNegativeInteger(normalized.updatedAt)
    ? normalized.updatedAt
    : now;
  normalized.lastHostObservedAt = isSafeNonNegativeInteger(normalized.lastHostObservedAt)
    ? normalized.lastHostObservedAt
    : 0;
  normalized.lastHostObservationAt = isSafeNonNegativeInteger(normalized.lastHostObservationAt)
    ? normalized.lastHostObservationAt
    : normalized.lastHostObservedAt;
  normalized.terminalPhase = Object.values(PHASES).includes(normalized.terminalPhase)
    ? normalized.terminalPhase
    : null;
  normalized.terminalReason = isNullableSafeToken(normalized.terminalReason)
    ? normalized.terminalReason
    : null;
  normalized.controlPlaneStatus = Object.values(CONTROL_PLANE_STATUS).includes(normalized.controlPlaneStatus)
    ? normalized.controlPlaneStatus
    : CONTROL_PLANE_STATUS.OK;
  normalized.controlPlaneError = isNullableSafeToken(normalized.controlPlaneError)
    ? normalized.controlPlaneError
    : null;
  normalized.lastHostEnvelope = isPlainObject(normalized.lastHostEnvelope)
    ? clone(normalized.lastHostEnvelope)
    : null;
  return normalized;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isHostTerminalPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}

export function mirrorHostEnvelope(inputState, rawEnvelope, now = Date.now(), expected = {}) {
  const state = normalizeState(clone(inputState), now);
  const envelope = normalizeHostEnvelope(rawEnvelope, expected);
  if (envelope.hostGeneration < state.hostGeneration) throw new HostResultReplayError();
  if (envelope.hostGeneration === state.hostGeneration) {
    if (state.lastHostEnvelope && equalJson(state.lastHostEnvelope, envelope)) {
      return { state, envelope, status: 'duplicate', reason: 'duplicate_host_result' };
    }
    if (state.lastHostEnvelope || state.hostGeneration !== 0) throw new HostResultReplayError();
  }

  const mirrored = {
    ...state,
    hostGeneration: envelope.hostGeneration,
    hostResultSchemaVersion: envelope.schemaVersion,
    hostResultSource: envelope.source,
    resultSchemaVersion: envelope.schemaVersion,
    resultSource: envelope.source,
    hostEnvironment: envelope.environment,
    phase: envelope.phase,
    activeRoute: envelope.activeRoute,
    result: envelope.result,
    sharedOk: envelope.sharedOk,
    directOk: envelope.directOk,
    sharedFailureCount: envelope.sharedFailureCount,
    directSuccessCount: envelope.directSuccessCount,
    directFailureCount: envelope.directFailureCount,
    emergencySharedSuccessCount: envelope.emergencySharedSuccessCount,
    sharedHealthyCount: envelope.sharedHealthyCount,
    directActivatedAt: envelope.directActivatedAt,
    sharedHealthyStartedAt: envelope.sharedHealthyStartedAt,
    sharedHealthyLastAt: envelope.sharedHealthyLastAt,
    cooldownUntil: envelope.cooldownUntil,
    recentNormalRoundTrips: [...envelope.recentNormalRoundTrips],
    transition: { ...envelope.transition },
    terminalPhase: isHostTerminalPhase(envelope.phase) ? envelope.phase : null,
    terminalReason: envelope.terminalReason,
    lastHostResult: envelope.result,
    lastHostObservedAt: now,
    lastHostObservationAt: now,
    lastHostEnvelope: clone(envelope),
    controlPlaneStatus: CONTROL_PLANE_STATUS.OK,
    controlPlaneError: null,
    lastObservedAt: now,
    updatedAt: now,
  };
  return { state: mirrored, envelope, status: 'mirrored', reason: 'host_result_mirrored' };
}

export function markControlPlaneFailure(
  inputState,
  { status = CONTROL_PLANE_STATUS.DEGRADED, error = 'AWS_CONTROL_PLANE_FAILURE', now = Date.now() } = {},
) {
  const state = normalizeState(clone(inputState), now);
  const safeError = isSafeToken(error) ? error : 'AWS_CONTROL_PLANE_FAILURE';
  const nextStatus = status === CONTROL_PLANE_STATUS.BLOCKED
    ? CONTROL_PLANE_STATUS.BLOCKED
    : CONTROL_PLANE_STATUS.DEGRADED;
  return {
    ...state,
    controlPlaneStatus: nextStatus,
    controlPlaneError: safeError,
    updatedAt: now,
  };
}

export {
  NON_NEGATIVE_FIELDS,
  isBoundedNonNegativeInteger,
  isSafeNonNegativeInteger,
  isSafeToken,
};
