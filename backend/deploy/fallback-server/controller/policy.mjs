import {
  VERIFICATION_DECISION,
  VERIFICATION_REASONS,
} from './probes.mjs';

export const SWITCH_TO_FALLBACK = 'SWITCH_TO_FALLBACK';
export const POLICY_BLOCKED = 'BLOCKED';

export const ROUTE_STATE = Object.freeze({
  AWS_ACTIVE: 'AWS_ACTIVE',
  FALLBACK_ACTIVE: 'FALLBACK_ACTIVE',
});

export const DNS_TARGET = Object.freeze({
  PRIMARY: 'PRIMARY',
  FALLBACK: 'FALLBACK',
});

export const POLICY_REFUSAL_REASONS = Object.freeze({
  INVALID_POLICY_INPUT: 'INVALID_POLICY_INPUT',
  AUTOMATIC_FAILBACK_DISABLED: 'AUTOMATIC_FAILBACK_DISABLED',
  CONTROLLER_DISARMED: 'CONTROLLER_DISARMED',
  SENTRY_EVENT_NOT_ACCEPTED: 'SENTRY_EVENT_NOT_ACCEPTED',
  STATE_NOT_AWS_ACTIVE: 'STATE_NOT_AWS_ACTIVE',
  DNS_TARGET_NOT_PRIMARY: 'DNS_TARGET_NOT_PRIMARY',
  FALLBACK_DB_IDENTITY_UNCERTIFIED: 'FALLBACK_DB_IDENTITY_UNCERTIFIED',
  FALLBACK_RELEASE_NOT_HEALTHY: 'FALLBACK_RELEASE_NOT_HEALTHY',
  FALLBACK_PASSIVE_GATES_UNSAFE: 'FALLBACK_PASSIVE_GATES_UNSAFE',
  HEALTH_VERIFICATION_BLOCKED: 'HEALTH_VERIFICATION_BLOCKED',
  PRIMARY_NOT_FAILED: 'PRIMARY_NOT_FAILED',
  FALLBACK_NOT_READY: 'FALLBACK_NOT_READY',
  BOTH_ORIGINS_DOWN: 'BOTH_ORIGINS_DOWN',
  VERIFICATION_ABORTED: 'VERIFICATION_ABORTED',
  VERIFICATION_DEADLINE_EXCEEDED: 'VERIFICATION_DEADLINE_EXCEEDED',
});

const HEALTH_REASON_MAP = new Map([
  [VERIFICATION_REASONS.PRIMARY_NOT_FAILED, POLICY_REFUSAL_REASONS.PRIMARY_NOT_FAILED],
  [VERIFICATION_REASONS.FALLBACK_NOT_READY, POLICY_REFUSAL_REASONS.FALLBACK_NOT_READY],
  [VERIFICATION_REASONS.BOTH_ORIGINS_DOWN, POLICY_REFUSAL_REASONS.BOTH_ORIGINS_DOWN],
  [VERIFICATION_REASONS.VERIFICATION_ABORTED, POLICY_REFUSAL_REASONS.VERIFICATION_ABORTED],
  [VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED, POLICY_REFUSAL_REASONS.VERIFICATION_DEADLINE_EXCEEDED],
]);

function blocked(reason) {
  return Object.freeze({ decision: POLICY_BLOCKED, reason });
}

function healthy(value) {
  return value === true || value === 'healthy' || value === 'ok';
}

function readBoolean(input, ...keys) {
  let found = false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    found = true;
    if (input[key] !== true) return false;
  }
  return found;
}

function fallbackStatusValue(input, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) return input[key];
  }
  const status = input.fallbackStatus;
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(status, key) && status[key] !== undefined) return status[key];
    }
  }
  return undefined;
}

function healthVerificationReason(verification) {
  if (
    verification === null ||
    typeof verification !== 'object' ||
    Array.isArray(verification) ||
    verification.decision !== VERIFICATION_DECISION.ELIGIBLE ||
    verification.primaryFailures !== 3 ||
    verification.fallbackSuccesses !== 3 ||
    (verification.reason !== null && verification.reason !== undefined)
  ) {
    if (verification && typeof verification.reason === 'string' && HEALTH_REASON_MAP.has(verification.reason)) {
      return HEALTH_REASON_MAP.get(verification.reason);
    }
    return POLICY_REFUSAL_REASONS.HEALTH_VERIFICATION_BLOCKED;
  }
  return null;
}

/**
 * Evaluate the one-way AWS -> Fallback policy.
 *
 * The function returns only a stable decision and refusal code. It never
 * echoes URLs, addresses, provider payloads, or runtime error text.
 */
export function evaluateFailoverPolicy(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return blocked(POLICY_REFUSAL_REASONS.INVALID_POLICY_INPUT);
  }

  const state = input.state ?? input.activeRoute;
  if (state === ROUTE_STATE.FALLBACK_ACTIVE) {
    return blocked(POLICY_REFUSAL_REASONS.AUTOMATIC_FAILBACK_DISABLED);
  }
  if (!readBoolean(input, 'controllerArmed', 'armed')) {
    return blocked(POLICY_REFUSAL_REASONS.CONTROLLER_DISARMED);
  }
  if (!readBoolean(input, 'sentryEventAccepted', 'sentryAccepted')) {
    return blocked(POLICY_REFUSAL_REASONS.SENTRY_EVENT_NOT_ACCEPTED);
  }
  if (state !== ROUTE_STATE.AWS_ACTIVE) {
    return blocked(POLICY_REFUSAL_REASONS.STATE_NOT_AWS_ACTIVE);
  }

  const dnsCurrentTarget = input.dnsCurrentTarget ?? input.currentDnsTarget ?? input.dnsTarget;
  if (dnsCurrentTarget !== DNS_TARGET.PRIMARY) {
    return blocked(POLICY_REFUSAL_REASONS.DNS_TARGET_NOT_PRIMARY);
  }

  const dbIdentity = fallbackStatusValue(input, [
    'fallbackProductionDbIdentityCertified',
    'productionDbIdentityCertified',
    'productionDbIdentity',
    'production_db_identity',
  ]);
  if (!(dbIdentity === true || dbIdentity === 'ok' || dbIdentity === 'certified')) {
    return blocked(POLICY_REFUSAL_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED);
  }

  const releaseHealthy = fallbackStatusValue(input, [
    'fallbackReleaseHealthy',
    'fallbackReleaseStatus',
    'release',
  ]);
  if (!healthy(releaseHealthy)) {
    return blocked(POLICY_REFUSAL_REASONS.FALLBACK_RELEASE_NOT_HEALTHY);
  }

  const passiveHealthy = fallbackStatusValue(input, [
    'fallbackPassiveGatesHealthy',
    'fallbackPassiveStatus',
    'passiveGates',
    'passive_gates',
  ]);
  if (!healthy(passiveHealthy)) {
    return blocked(POLICY_REFUSAL_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE);
  }

  const verificationReason = healthVerificationReason(input.healthVerification ?? input.health);
  if (verificationReason !== null) return blocked(verificationReason);

  return Object.freeze({ decision: SWITCH_TO_FALLBACK, reason: null });
}

/** Return exactly `SWITCH_TO_FALLBACK` or one stable refusal reason. */
export function decideFailover(input = {}) {
  const result = evaluateFailoverPolicy(input);
  return result.decision === SWITCH_TO_FALLBACK ? SWITCH_TO_FALLBACK : result.reason;
}

export const policyDecision = decideFailover;
export const isFailoverEligible = (input = {}) => decideFailover(input) === SWITCH_TO_FALLBACK;
