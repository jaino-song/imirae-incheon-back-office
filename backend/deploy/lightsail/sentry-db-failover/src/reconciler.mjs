import {
  DEFAULT_RECONCILE_CONFIG,
  PHASES,
  ROUTES,
  createInitialState,
} from './constants.mjs';

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeState(state, now = Date.now()) {
  const initial = createInitialState(now);
  const normalized = { ...initial, ...(state ?? {}) };
  normalized.generation = numberOr(normalized.generation, 0);
  normalized.leaseExpiresAt = numberOr(normalized.leaseExpiresAt, 0);
  normalized.lastSentryEventAt = numberOr(normalized.lastSentryEventAt, 0);
  normalized.sharedFailureCount = numberOr(normalized.sharedFailureCount, 0);
  normalized.directSuccessCount = numberOr(normalized.directSuccessCount, 0);
  normalized.directFailureCount = numberOr(normalized.directFailureCount, 0);
  normalized.emergencySharedSuccessCount = numberOr(normalized.emergencySharedSuccessCount, 0);
  normalized.sharedHealthyCount = numberOr(normalized.sharedHealthyCount, 0);
  normalized.cooldownUntil = numberOr(normalized.cooldownUntil, 0);
  normalized.recentRoundTripCount = numberOr(normalized.recentRoundTripCount, 0);
  normalized.recentRoundTripHistory = Array.isArray(normalized.recentRoundTripHistory)
    ? normalized.recentRoundTripHistory
    : [];
  normalized.recentSentryRequestIds = Array.isArray(normalized.recentSentryRequestIds)
    ? normalized.recentSentryRequestIds
    : [];
  if (!Object.values(PHASES).includes(normalized.phase)) normalized.phase = PHASES.SHARED_ACTIVE;
  if (!Object.values(ROUTES).includes(normalized.activeRoute)) normalized.activeRoute = ROUTES.SHARED;
  return normalized;
}

export function pruneRoundTripHistory(state, now, windowMs = DEFAULT_RECONCILE_CONFIG.roundTripWindowMs) {
  const cutoff = now - windowMs;
  const history = (state.recentRoundTripHistory ?? []).filter((entry) => (
    typeof entry?.at === 'number' && entry.at >= cutoff
  ));
  state.recentRoundTripHistory = history;
  state.recentRoundTripCount = history.filter((entry) => entry.kind === 'normal').length;
  return state;
}

function hasObservedRoute(observation, route) {
  return observation.activeRoute === route
    || String(observation.route ?? '').toUpperCase() === route;
}

function setBlocked(state, now, reason) {
  state.phase = PHASES.BLOCKED;
  state.errorTerminalPhase = PHASES.BLOCKED;
  state.lastErrorCode = reason;
  state.pendingTransition = null;
  state.pendingRoundTripKind = null;
  state.updatedAt = now;
  return {
    state,
    action: 'none',
    reason,
  };
}

function preserveOnControlPlaneFailure(state, now) {
  if (state.phase !== PHASES.BLOCKED) state.phase = PHASES.DEGRADED;
  state.lastErrorCode = 'AWS_CONTROL_PLANE_FAILURE';
  state.updatedAt = now;
  return {
    state,
    action: 'none',
    reason: 'control_plane_failure',
  };
}

function activateDirect(state, now, config) {
  state.activeRoute = ROUTES.DIRECT;
  state.phase = PHASES.DIRECT_ACTIVE;
  state.directActivatedAt = now;
  state.sharedHealthySince = null;
  state.sharedHealthyCount = 0;
  state.sharedFailureCount = 0;
  state.directSuccessCount = 0;
  state.directFailureCount = 0;
  state.emergencySharedSuccessCount = 0;
  state.cooldownUntil = now + config.cooldownMs;
  state.pendingTransition = null;
  state.pendingRoundTripKind = null;
  state.lastErrorCode = null;
  return state;
}

function activateShared(state, now, config, kind) {
  state.activeRoute = ROUTES.SHARED;
  state.phase = PHASES.SHARED_ACTIVE;
  state.directActivatedAt = null;
  state.sharedHealthySince = now;
  state.sharedHealthyCount = 0;
  state.sharedFailureCount = 0;
  state.directSuccessCount = 0;
  state.directFailureCount = 0;
  state.emergencySharedSuccessCount = 0;
  state.cooldownUntil = now + config.cooldownMs;
  state.pendingTransition = null;
  state.pendingRoundTripKind = null;
  state.lastErrorCode = null;
  if (kind === 'normal') {
    state.recentRoundTripHistory.push({
      at: now,
      kind: 'normal',
      from: ROUTES.DIRECT,
      to: ROUTES.SHARED,
    });
  }
  return state;
}

function directMinimumSatisfied(state, now, config) {
  return typeof state.directActivatedAt === 'number'
    && now - state.directActivatedAt >= config.directMinimumMs;
}

function normalFailbackAllowed(state, now, config) {
  if (state.cooldownUntil > now) return false;
  if (!directMinimumSatisfied(state, now, config)) return false;
  if (state.sharedHealthyCount < config.sharedHealthyThreshold) return false;
  return state.recentRoundTripCount < config.maxNormalRoundTrips - 1;
}

function processSwitchingToDirect(state, observation, now, config) {
  if (hasObservedRoute(observation, ROUTES.DIRECT)) {
    activateDirect(state, now, config);
    return { state, action: 'none', reason: 'direct_route_confirmed' };
  }
  if (observation.sharedOk === false && observation.directOk === false) {
    return setBlocked(state, now, 'BOTH_ROUTES_DOWN');
  }
  state.phase = PHASES.SWITCHING_TO_DIRECT;
  state.updatedAt = now;
  return { state, action: 'switch_to_direct', reason: 'awaiting_direct_route_confirmation' };
}

function processSwitchingToShared(state, observation, now, config) {
  if (hasObservedRoute(observation, ROUTES.SHARED)) {
    const kind = state.pendingRoundTripKind;
    activateShared(state, now, config, kind);
    pruneRoundTripHistory(state, now, config.roundTripWindowMs);
    if (state.recentRoundTripCount >= config.maxNormalRoundTrips) {
      return setBlocked(state, now, 'NORMAL_ROUND_TRIP_BUDGET_EXHAUSTED');
    }
    return { state, action: 'none', reason: 'shared_route_confirmed' };
  }
  if (observation.sharedOk === false && observation.directOk === false) {
    return setBlocked(state, now, 'BOTH_ROUTES_DOWN');
  }
  state.phase = PHASES.SWITCHING_TO_SHARED;
  state.updatedAt = now;
  return { state, action: 'switch_to_shared', reason: 'awaiting_shared_route_confirmation' };
}

function processSharedActive(state, observation, now, config) {
  if (observation.sharedOk === true) {
    state.phase = PHASES.SHARED_ACTIVE;
    state.sharedFailureCount = 0;
    state.directSuccessCount = 0;
    state.sharedHealthySince ??= now;
    state.lastErrorCode = null;
    state.updatedAt = now;
    return { state, action: 'none', reason: 'shared_healthy' };
  }

  if (observation.sharedOk === false) {
    state.sharedFailureCount += 1;
    state.sharedHealthySince = null;
    state.directSuccessCount = observation.directOk === true ? state.directSuccessCount + 1 : 0;
    state.phase = PHASES.DEGRADED;
    state.lastErrorCode = 'SHARED_ROUTE_UNHEALTHY';
    if (
      state.sharedFailureCount >= config.sharedFailureThreshold
      && state.directSuccessCount >= config.directSuccessThreshold
    ) {
      if (state.cooldownUntil > now) {
        state.updatedAt = now;
        return { state, action: 'none', reason: 'switch_cooldown_active' };
      }
      state.phase = PHASES.SWITCHING_TO_DIRECT;
      state.pendingTransition = ROUTES.DIRECT;
      return { state, action: 'switch_to_direct', reason: 'shared_failure_and_direct_success_gates_met' };
    }
    state.updatedAt = now;
    return { state, action: 'none', reason: 'shared_failure_gate_accumulating' };
  }

  state.phase = PHASES.DEGRADED;
  state.sharedHealthySince = null;
  state.updatedAt = now;
  return { state, action: 'none', reason: 'shared_status_unavailable' };
}

function processDirectActive(state, observation, now, config) {
  if (observation.directOk === false && observation.sharedOk === false) {
    return setBlocked(state, now, 'BOTH_ROUTES_DOWN');
  }

  if (observation.directOk === false) {
    state.directFailureCount += 1;
    state.sharedHealthyCount = 0;
    state.sharedHealthySince = null;
    state.emergencySharedSuccessCount = observation.sharedOk === true
      ? state.emergencySharedSuccessCount + 1
      : 0;
    state.phase = PHASES.DEGRADED;
    state.lastErrorCode = 'DIRECT_ROUTE_UNHEALTHY';
    if (state.emergencySharedSuccessCount >= config.emergencySharedSuccessThreshold) {
      state.phase = PHASES.RECOVERING_SHARED;
      state.pendingTransition = ROUTES.SHARED;
      state.pendingRoundTripKind = 'emergency';
      return { state, action: 'switch_to_shared', reason: 'emergency_failback_gate_met' };
    }
    state.updatedAt = now;
    return { state, action: 'none', reason: 'direct_failure_gate_accumulating' };
  }

  if (observation.directOk === true) {
    state.directFailureCount = 0;
    state.emergencySharedSuccessCount = 0;
    if (observation.sharedOk === true) {
      state.sharedHealthySince ??= now;
      state.sharedHealthyCount += 1;
    } else if (observation.sharedOk === false) {
      state.sharedHealthySince = null;
      state.sharedHealthyCount = 0;
    } else {
      state.sharedHealthySince = null;
      state.sharedHealthyCount = 0;
    }
    state.phase = PHASES.DIRECT_ACTIVE;
    state.lastErrorCode = null;
    if (normalFailbackAllowed(state, now, config)) {
      state.phase = PHASES.SWITCHING_TO_SHARED;
      state.pendingTransition = ROUTES.SHARED;
      state.pendingRoundTripKind = 'normal';
      return { state, action: 'switch_to_shared', reason: 'normal_failback_gate_met' };
    }
    if (
      directMinimumSatisfied(state, now, config)
      && state.sharedHealthyCount >= config.sharedHealthyThreshold
      && state.recentRoundTripCount >= config.maxNormalRoundTrips - 1
    ) {
      return setBlocked(state, now, 'NORMAL_ROUND_TRIP_BUDGET_EXHAUSTED');
    }
    state.updatedAt = now;
    return { state, action: 'none', reason: 'direct_healthy' };
  }

  state.phase = PHASES.DEGRADED;
  state.updatedAt = now;
  return { state, action: 'none', reason: 'direct_status_unavailable' };
}

export function reconcileState(inputState, rawObservation, now = Date.now(), overrides = {}) {
  const config = { ...DEFAULT_RECONCILE_CONFIG, ...overrides };
  const state = normalizeState(copy(inputState), now);
  const observation = {
    controlPlaneOk: rawObservation?.controlPlaneOk !== false,
    sharedOk: booleanOrNull(rawObservation?.sharedOk),
    directOk: booleanOrNull(rawObservation?.directOk),
    activeRoute: rawObservation?.activeRoute,
    route: rawObservation?.route,
    commandId: rawObservation?.commandId,
  };

  pruneRoundTripHistory(state, now, config.roundTripWindowMs);
  state.lastObservedAt = now;
  state.updatedAt = now;
  if (observation.commandId) state.ssmCommandId = observation.commandId;

  if (state.phase === PHASES.BLOCKED) {
    return { state, action: 'none', reason: 'already_blocked' };
  }
  if (!observation.controlPlaneOk) return preserveOnControlPlaneFailure(state, now);
  if (observation.sharedOk === false && observation.directOk === false) {
    return setBlocked(state, now, 'BOTH_ROUTES_DOWN');
  }

  if (state.phase === PHASES.SWITCHING_TO_DIRECT) {
    return processSwitchingToDirect(state, observation, now, config);
  }
  if (state.phase === PHASES.SWITCHING_TO_SHARED || state.phase === PHASES.RECOVERING_SHARED) {
    return processSwitchingToShared(state, observation, now, config);
  }
  if (state.activeRoute === ROUTES.DIRECT || state.phase === PHASES.DIRECT_ACTIVE) {
    return processDirectActive(state, observation, now, config);
  }
  return processSharedActive(state, observation, now, config);
}
