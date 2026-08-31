import {
  ConditionalStateWriteError,
  DNS_ROLES,
  PHASES,
  StaleGenerationError,
  createStateStore,
} from './state-store.mjs';
import {
  DNS_TARGET,
  POLICY_REFUSAL_REASONS,
  ROUTE_STATE,
  SWITCH_TO_FALLBACK,
  evaluateFailoverPolicy,
} from './policy.mjs';
import {
  VERIFICATION_DECISION,
  VERIFICATION_REASONS,
  verifyBoundedHealth,
} from './probes.mjs';
import {
  FALLBACK_STATUS_ERROR_CODES,
  FallbackStatusError,
  getFallbackStatus,
} from './fallback-status.mjs';
import { ErrorCode as VercelErrorCode } from './vercel-dns-client.mjs';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export const WORKER_REASONS = Object.freeze({
  INVALID_EVENT: 'invalid_event',
  DUPLICATE_EVENT: 'duplicate_event',
  VERIFICATION_STARTED: 'verification_started',
  STATE_UNAVAILABLE: 'state_unavailable',
  STATE_GENERATION_STALE: 'state_generation_stale',
  CONTROLLER_DISARMED: 'controller_disarmed',
  STATE_NOT_AWS_ACTIVE: 'state_not_aws_active',
  VERIFYING_IN_PROGRESS: 'verifying_in_progress',
  NO_PENDING_VERIFICATION: 'no_pending_verification',
  FALLBACK_STATUS_INVALID: 'fallback_status_invalid',
  FALLBACK_RELEASE_UNHEALTHY: 'fallback_release_unhealthy',
  FALLBACK_DB_IDENTITY_UNCERTIFIED: 'fallback_db_identity_uncertified',
  FALLBACK_PASSIVE_GATES_UNSAFE: 'fallback_passive_gates_unsafe',
  DNS_READ_FAILED: 'dns_read_failed',
  DNS_AMBIGUOUS: 'manual_check',
  DNS_DRIFT: 'dns_drift',
  PRIMARY_NOT_FAILED: 'primary_not_failed',
  FALLBACK_NOT_READY: 'fallback_not_ready',
  BOTH_ORIGINS_DOWN: 'both_origins_down',
  HEALTH_VERIFICATION_BLOCKED: 'health_verification_blocked',
  VERIFICATION_DEADLINE_EXCEEDED: 'verification_deadline_exceeded',
  VERIFICATION_ABORTED: 'verification_aborted',
  POLICY_REFUSED: 'policy_refused',
  DNS_UPDATE_FAILED: 'dns_update_failed',
  STATE_UPDATE_FAILED: 'state_update_failed',
});

export const WORKER_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  IGNORED: 'ignored',
  VERIFYING: 'verifying',
  FALLBACK_ACTIVE: 'fallback_active',
  AWS_ACTIVE: 'aws_active',
  BLOCKED: 'blocked',
});

const VERIFICATION_REASON_TO_WORKER_REASON = Object.freeze({
  [VERIFICATION_REASONS.PRIMARY_NOT_FAILED]: WORKER_REASONS.PRIMARY_NOT_FAILED,
  [VERIFICATION_REASONS.FALLBACK_NOT_READY]: WORKER_REASONS.FALLBACK_NOT_READY,
  [VERIFICATION_REASONS.BOTH_ORIGINS_DOWN]: WORKER_REASONS.BOTH_ORIGINS_DOWN,
  [VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED]: WORKER_REASONS.VERIFICATION_DEADLINE_EXCEEDED,
  [VERIFICATION_REASONS.VERIFICATION_ABORTED]: WORKER_REASONS.VERIFICATION_ABORTED,
});

const POLICY_REASON_TO_WORKER_REASON = Object.freeze({
  [POLICY_REFUSAL_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED]: WORKER_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED,
  [POLICY_REFUSAL_REASONS.FALLBACK_RELEASE_NOT_HEALTHY]: WORKER_REASONS.FALLBACK_RELEASE_UNHEALTHY,
  [POLICY_REFUSAL_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE]: WORKER_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE,
  [POLICY_REFUSAL_REASONS.DNS_TARGET_NOT_PRIMARY]: WORKER_REASONS.DNS_DRIFT,
  [POLICY_REFUSAL_REASONS.PRIMARY_NOT_FAILED]: WORKER_REASONS.PRIMARY_NOT_FAILED,
  [POLICY_REFUSAL_REASONS.FALLBACK_NOT_READY]: WORKER_REASONS.FALLBACK_NOT_READY,
  [POLICY_REFUSAL_REASONS.BOTH_ORIGINS_DOWN]: WORKER_REASONS.BOTH_ORIGINS_DOWN,
  [POLICY_REFUSAL_REASONS.HEALTH_VERIFICATION_BLOCKED]: WORKER_REASONS.HEALTH_VERIFICATION_BLOCKED,
  [POLICY_REFUSAL_REASONS.VERIFICATION_DEADLINE_EXCEEDED]: WORKER_REASONS.VERIFICATION_DEADLINE_EXCEEDED,
  [POLICY_REFUSAL_REASONS.VERIFICATION_ABORTED]: WORKER_REASONS.VERIFICATION_ABORTED,
});

const RESET_TO_AWS_POLICY_REASONS = new Set([
  POLICY_REFUSAL_REASONS.AUTOMATIC_FAILBACK_DISABLED,
  POLICY_REFUSAL_REASONS.CONTROLLER_DISARMED,
  POLICY_REFUSAL_REASONS.SENTRY_EVENT_NOT_ACCEPTED,
  POLICY_REFUSAL_REASONS.STATE_NOT_AWS_ACTIVE,
  POLICY_REFUSAL_REASONS.PRIMARY_NOT_FAILED,
]);

export class FailoverWorkerError extends Error {
  constructor(code = WORKER_REASONS.STATE_UNAVAILABLE) {
    super(code);
    this.name = 'FailoverWorkerError';
    this.code = code;
    this.blocked = true;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFingerprint(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
    ? value.toLowerCase()
    : undefined;
}

function stableReason(value, fallback = WORKER_REASONS.POLICY_REFUSED) {
  if (typeof value !== 'string') return fallback;
  if (Object.values(WORKER_REASONS).includes(value)) return value;
  return fallback;
}

function isVerificationEligible(value) {
  return isRecord(value)
    && value.decision === VERIFICATION_DECISION.ELIGIBLE
    && value.reason === null
    && value.primaryFailures === 3
    && value.fallbackSuccesses === 3;
}

function isPrimaryRecovered(value) {
  return isRecord(value)
    && value.decision === VERIFICATION_DECISION.BLOCKED
    && value.reason === VERIFICATION_REASONS.PRIMARY_NOT_FAILED;
}

function mapVerificationReason(value) {
  if (isRecord(value) && VERIFICATION_REASON_TO_WORKER_REASON[value.reason]) {
    return VERIFICATION_REASON_TO_WORKER_REASON[value.reason];
  }
  return WORKER_REASONS.HEALTH_VERIFICATION_BLOCKED;
}

function mapPolicyReason(value) {
  return POLICY_REASON_TO_WORKER_REASON[value] ?? WORKER_REASONS.POLICY_REFUSED;
}

function isDnsAmbiguous(error) {
  return error?.ambiguous === true
    || error?.code === VercelErrorCode.MANUAL_CHECK
    || error?.code === VercelErrorCode.RECORD_AMBIGUOUS;
}

function normalizeClock(clock) {
  if (typeof clock === 'function') return clock;
  if (Number.isSafeInteger(clock) && clock >= 0) return () => clock;
  return () => Date.now();
}

function currentRecordReader(dnsClient) {
  if (typeof dnsClient?.readCurrentRecord === 'function') return dnsClient.readCurrentRecord.bind(dnsClient);
  if (typeof dnsClient?.getCurrentRecord === 'function') return dnsClient.getCurrentRecord.bind(dnsClient);
  return undefined;
}

function fallbackSwitcher(dnsClient) {
  if (typeof dnsClient?.switchToFallback === 'function') return dnsClient.switchToFallback.bind(dnsClient);
  if (typeof dnsClient?.failoverToFallback === 'function') return dnsClient.failoverToFallback.bind(dnsClient);
  return undefined;
}

function classifyDnsTarget(record, { primaryIpv4, fallbackIpv4, dnsTargetResolver }) {
  if (typeof dnsTargetResolver === 'function') {
    try {
      const resolved = dnsTargetResolver(record);
      if (resolved === DNS_TARGET.PRIMARY || resolved === DNS_TARGET.FALLBACK) return resolved;
      if (resolved === DNS_ROLES.AWS) return DNS_TARGET.PRIMARY;
      if (resolved === DNS_ROLES.FALLBACK) return DNS_TARGET.FALLBACK;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(record)) return undefined;
  if (record.value === primaryIpv4) return DNS_TARGET.PRIMARY;
  if (record.value === fallbackIpv4) return DNS_TARGET.FALLBACK;
  const explicitRole = record.currentDnsRole ?? record.targetRole ?? record.target ?? record.route;
  if (explicitRole === DNS_ROLES.AWS || explicitRole === DNS_TARGET.PRIMARY || explicitRole === ROUTE_STATE.AWS_ACTIVE) {
    return DNS_TARGET.PRIMARY;
  }
  if (explicitRole === DNS_ROLES.FALLBACK || explicitRole === DNS_TARGET.FALLBACK || explicitRole === ROUTE_STATE.FALLBACK_ACTIVE) {
    return DNS_TARGET.FALLBACK;
  }
  return undefined;
}

function statusPolicyInput(status) {
  return {
    fallbackProductionDbIdentityCertified: status?.productionDbIdentityCertified === true,
    fallbackReleaseHealthy: status?.releaseHealthy === true,
    fallbackPassiveGatesHealthy: status?.passiveGatesHealthy === true,
    fallbackStatus: status,
  };
}

function assertDependencies({ stateStore, dnsClient, verifyHealth, readFallbackStatus, evaluatePolicy }) {
  if (!stateStore
    || typeof stateStore.read !== 'function'
    || typeof stateStore.create !== 'function'
    || typeof stateStore.update !== 'function'
    || typeof stateStore.claimReplayFingerprint !== 'function') {
    throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
  }
  if (!currentRecordReader(dnsClient) || !fallbackSwitcher(dnsClient)) {
    throw new FailoverWorkerError(WORKER_REASONS.DNS_READ_FAILED);
  }
  if (typeof verifyHealth !== 'function' || typeof readFallbackStatus !== 'function' || typeof evaluatePolicy !== 'function') {
    throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
  }
}

/**
 * Coordinate one signed Sentry event. The receiver calls acceptAuthenticatedEvent
 * and may return immediately after the VERIFYING state is durable; resumePending
 * drives the bounded asynchronous verification and DNS operation.
 */
export function createFailoverWorker({
  stateStore = createStateStore({ productionMode: true }),
  dnsClient,
  verifyHealth = verifyBoundedHealth,
  verify,
  readFallbackStatus = getFallbackStatus,
  fallbackStatus,
  evaluatePolicy = evaluateFailoverPolicy,
  policy,
  fallbackStatusRunner,
  expectedImageTag,
  expectedImageDigest,
  primaryIpv4,
  fallbackIpv4,
  dnsTargetResolver,
  healthConfig,
  fetch,
  sleep,
  clock = () => Date.now(),
  autoResume = true,
} = {}) {
  const healthVerifier = verify ?? verifyHealth;
  const statusReader = fallbackStatus ?? readFallbackStatus;
  const policyEvaluator = policy ?? evaluatePolicy;
  assertDependencies({
    stateStore,
    dnsClient,
    verifyHealth: healthVerifier,
    readFallbackStatus: statusReader,
    evaluatePolicy: policyEvaluator,
  });
  if (typeof autoResume !== 'boolean') throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
  const now = normalizeClock(clock);
  const inFlight = new Map();

  async function safeReadState() {
    try {
      return await stateStore.read();
    } catch {
      throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
    }
  }

  async function ensureState() {
    let state = await safeReadState();
    if (state) return state;
    try {
      state = await stateStore.create({ armed: false, at: now() });
    } catch {
      throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
    }
    if (!state) throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
    return state;
  }

  function result(status, state, fields = {}) {
    return {
      accepted: status !== WORKER_STATUS.BLOCKED,
      status,
      state: state ? clone(state) : undefined,
      ...fields,
    };
  }

  async function claimReplay(state, fingerprint) {
    try {
      return await stateStore.claimReplayFingerprint(fingerprint, {
        expectedGeneration: state.generation,
        at: now(),
      });
    } catch (error) {
      if (!(error instanceof StaleGenerationError) && !(error instanceof ConditionalStateWriteError)) {
        throw new FailoverWorkerError(WORKER_REASONS.STATE_UNAVAILABLE);
      }
      const current = await safeReadState();
      if (current?.replayFingerprints?.includes(fingerprint)) {
        return { claimed: false, state: current, generation: current.generation };
      }
      throw new FailoverWorkerError(WORKER_REASONS.STATE_GENERATION_STALE);
    }
  }

  async function persist(state, patch, reason = undefined) {
    try {
      const next = await stateStore.update({
        expectedGeneration: state.generation,
        expectedPhase: PHASES.VERIFYING,
        patch,
        at: now(),
      });
      return result(
        next.phase === PHASES.FALLBACK_ACTIVE
          ? WORKER_STATUS.FALLBACK_ACTIVE
          : next.phase === PHASES.AWS_ACTIVE
            ? WORKER_STATUS.AWS_ACTIVE
            : next.phase === PHASES.BLOCKED
              ? WORKER_STATUS.BLOCKED
              : WORKER_STATUS.VERIFYING,
        next,
        reason ? { reason } : {},
      );
    } catch (error) {
      if (error instanceof StaleGenerationError || error instanceof ConditionalStateWriteError) {
        const current = await safeReadState();
        const disarmed = await clearDisarmedVerification(current, state);
        if (disarmed) return disarmed;
        return result(WORKER_STATUS.BLOCKED, current, { reason: WORKER_REASONS.STATE_GENERATION_STALE });
      }
      const current = await safeReadState();
      return result(WORKER_STATUS.BLOCKED, current, { reason: WORKER_REASONS.STATE_UPDATE_FAILED });
    }
  }

  async function finishAws(state, reason) {
    return persist(state, {
      phase: PHASES.AWS_ACTIVE,
      currentDnsRole: DNS_ROLES.AWS,
      currentEventFingerprint: null,
      pendingIncident: null,
      terminalReason: null,
    }, reason);
  }

  async function finishBlocked(state, reason, dnsTarget = DNS_ROLES.AWS) {
    return persist(state, {
      phase: PHASES.BLOCKED,
      currentDnsRole: dnsTarget,
      pendingIncident: null,
      terminalReason: stableReason(reason, WORKER_REASONS.STATE_UPDATE_FAILED),
    }, reason);
  }

  async function finishFallback(state) {
    return persist(state, {
      phase: PHASES.FALLBACK_ACTIVE,
      currentDnsRole: DNS_ROLES.FALLBACK,
      pendingIncident: null,
      terminalReason: null,
    });
  }

  function samePendingLineage(current, expected) {
    const expectedFingerprint = expected?.pendingIncident?.eventFingerprint;
    const expectedPendingGeneration = expected?.pendingIncident?.generation;
    return current
      && expectedFingerprint
      && Number.isSafeInteger(expectedPendingGeneration)
      && current.phase === PHASES.VERIFYING
      && current.currentDnsRole === DNS_ROLES.AWS
      && current.currentEventFingerprint === expectedFingerprint
      && current.pendingIncident?.eventFingerprint === expectedFingerprint
      && current.pendingIncident?.generation === expectedPendingGeneration;
  }

  function isDisarmedVerification(current, expected) {
    return samePendingLineage(current, expected) && current.armed === false;
  }

  async function clearDisarmedVerification(current, expected) {
    if (!current) return undefined;
    if (
      current.armed === false
      && current.phase === PHASES.AWS_ACTIVE
      && current.currentDnsRole === DNS_ROLES.AWS
      && current.pendingIncident === null
      && current.currentEventFingerprint === null
    ) {
      return result(WORKER_STATUS.AWS_ACTIVE, current, {
        accepted: true,
        reason: WORKER_REASONS.CONTROLLER_DISARMED,
      });
    }
    if (!isDisarmedVerification(current, expected)) return undefined;
    try {
      const reset = await stateStore.update({
        expectedGeneration: current.generation,
        expectedPhase: PHASES.VERIFYING,
        patch: {
          armed: false,
          phase: PHASES.AWS_ACTIVE,
          currentDnsRole: DNS_ROLES.AWS,
          currentEventFingerprint: null,
          pendingIncident: null,
          terminalReason: null,
        },
        at: now(),
      });
      return result(WORKER_STATUS.AWS_ACTIVE, reset, {
        accepted: true,
        reason: WORKER_REASONS.CONTROLLER_DISARMED,
      });
    } catch (error) {
      if (!(error instanceof StaleGenerationError) && !(error instanceof ConditionalStateWriteError)) {
        return undefined;
      }
      const latest = await safeReadState();
      if (
        latest?.armed === false
        && latest.phase === PHASES.AWS_ACTIVE
        && latest.currentDnsRole === DNS_ROLES.AWS
        && latest.pendingIncident === null
      ) {
        return result(WORKER_STATUS.AWS_ACTIVE, latest, {
          accepted: true,
          reason: WORKER_REASONS.CONTROLLER_DISARMED,
        });
      }
      return undefined;
    }
  }

  async function readFallbackStatusSafe() {
    try {
      const status = await statusReader({
        runner: fallbackStatusRunner,
        expectedImageTag,
        expectedImageDigest,
      });
      if (!isRecord(status) || status.environment !== 'fallback-server') {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_STATUS_INVALID };
      }
      if (
        status.containerHealthy !== true
        || status.restartCount !== 0
        || status.dbReady !== true
        || status.schedulersEnabled !== false
        || status.documentJobsAccepting !== false
        || status.documentJobsWorker !== false
        || status.publicRoutingManaged !== false
      ) {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_STATUS_INVALID };
      }
      if (status.releaseHealthy !== true) {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_RELEASE_UNHEALTHY };
      }
      if (status.productionDbIdentityCertified !== true) {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED };
      }
      if (status.passiveGatesHealthy !== true) {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE };
      }
      return { ok: true, status };
    } catch (error) {
      if (error instanceof FallbackStatusError && error.code === FALLBACK_STATUS_ERROR_CODES.COMMAND_FAILED) {
        return { ok: false, reason: WORKER_REASONS.FALLBACK_STATUS_INVALID };
      }
      return { ok: false, reason: WORKER_REASONS.FALLBACK_STATUS_INVALID };
    }
  }

  async function readDnsTargetSafe() {
    const reader = currentRecordReader(dnsClient);
    try {
      const record = await reader();
      const target = classifyDnsTarget(record, { primaryIpv4, fallbackIpv4, dnsTargetResolver });
      return target ? { ok: true, target } : { ok: false, reason: WORKER_REASONS.DNS_DRIFT };
    } catch (error) {
      return {
        ok: false,
        reason: isDnsAmbiguous(error) ? WORKER_REASONS.DNS_AMBIGUOUS : WORKER_REASONS.DNS_READ_FAILED,
      };
    }
  }

  async function verifyHealthSafe() {
    try {
      const verification = await healthVerifier({
        config: healthConfig,
        fetch,
        sleep,
        clock: now,
      });
      if (!isRecord(verification)) return { ok: false, reason: WORKER_REASONS.HEALTH_VERIFICATION_BLOCKED };
      if (isPrimaryRecovered(verification)) return { ok: false, primaryRecovered: true, verification };
      if (!isVerificationEligible(verification)) {
        return { ok: false, reason: mapVerificationReason(verification), verification };
      }
      return { ok: true, verification };
    } catch {
      return { ok: false, reason: WORKER_REASONS.HEALTH_VERIFICATION_BLOCKED };
    }
  }

  async function guardDnsMutation(state) {
    const expectedFingerprint = state.pendingIncident?.eventFingerprint;
    const expectedPendingGeneration = state.pendingIncident?.generation;
    if (!expectedFingerprint || !Number.isSafeInteger(expectedPendingGeneration)) {
      return {
        ok: false,
        state,
        reason: WORKER_REASONS.STATE_GENERATION_STALE,
      };
    }

    const current = await safeReadState();
    const sameVerification = current
      && current.generation === state.generation
      && current.phase === PHASES.VERIFYING
      && current.armed === true
      && current.currentDnsRole === DNS_ROLES.AWS
      && current.currentEventFingerprint === expectedFingerprint
      && current.pendingIncident?.eventFingerprint === expectedFingerprint
      && current.pendingIncident?.generation === expectedPendingGeneration;
    if (sameVerification) return { ok: true, state: current };

    const disarmed = await clearDisarmedVerification(current, state);
    if (disarmed) {
      return { ok: false, state: disarmed.state, reason: WORKER_REASONS.CONTROLLER_DISARMED };
    }
    return { ok: false, state: current, reason: WORKER_REASONS.STATE_GENERATION_STALE };
  }

  async function runVerification(state) {
    const fallbackStatus = await readFallbackStatusSafe();
    if (!fallbackStatus.ok) return finishBlocked(state, fallbackStatus.reason);

    const dns = await readDnsTargetSafe();
    if (!dns.ok) return finishBlocked(state, dns.reason);
    if (dns.target === DNS_TARGET.PRIMARY && state.currentDnsRole !== DNS_ROLES.AWS) {
      return finishBlocked(state, WORKER_REASONS.DNS_DRIFT, DNS_ROLES.FALLBACK);
    }

    const health = await verifyHealthSafe();
    if (health.primaryRecovered) {
      if (dns.target === DNS_TARGET.FALLBACK) {
        return finishBlocked(state, WORKER_REASONS.DNS_DRIFT, DNS_ROLES.FALLBACK);
      }
      return finishAws(state, WORKER_REASONS.PRIMARY_NOT_FAILED);
    }
    if (!health.ok) return finishBlocked(state, health.reason, dns.target === DNS_TARGET.FALLBACK ? DNS_ROLES.FALLBACK : DNS_ROLES.AWS);

    const policyResult = policyEvaluator({
      controllerArmed: state.armed,
      sentryEventAccepted: true,
      state: ROUTE_STATE.AWS_ACTIVE,
      dnsCurrentTarget: dns.target,
      healthVerification: health.verification,
      ...statusPolicyInput(fallbackStatus.status),
    });
    if (!isRecord(policyResult) || policyResult.decision !== SWITCH_TO_FALLBACK) {
      const reason = mapPolicyReason(policyResult?.reason);
      if (RESET_TO_AWS_POLICY_REASONS.has(policyResult?.reason) || reason === WORKER_REASONS.PRIMARY_NOT_FAILED) {
        if (dns.target === DNS_TARGET.FALLBACK) {
          return finishBlocked(state, WORKER_REASONS.DNS_DRIFT, DNS_ROLES.FALLBACK);
        }
        return finishAws(state, reason);
      }
      if (dns.target === DNS_TARGET.FALLBACK && reason === WORKER_REASONS.DNS_DRIFT) {
        // A crash after a successful provider PATCH leaves DNS on Fallback.
        // The fresh status and 3/3 probes above are the required promotion
        // evidence; no second PATCH is issued.
        return finishFallback(state);
      }
      return finishBlocked(state, reason, dns.target === DNS_TARGET.FALLBACK ? DNS_ROLES.FALLBACK : DNS_ROLES.AWS);
    }

    if (dns.target === DNS_TARGET.FALLBACK) return finishFallback(state);

    const mutationGuard = await guardDnsMutation(state);
    if (!mutationGuard.ok) {
      if (mutationGuard.reason === WORKER_REASONS.CONTROLLER_DISARMED) {
        return result(WORKER_STATUS.AWS_ACTIVE, mutationGuard.state, {
          accepted: true,
          reason: WORKER_REASONS.CONTROLLER_DISARMED,
        });
      }
      return result(WORKER_STATUS.BLOCKED, mutationGuard.state, {
        reason: mutationGuard.reason,
      });
    }
    state = mutationGuard.state;

    const switcher = fallbackSwitcher(dnsClient);
    try {
      const switched = await switcher();
      if (!isRecord(switched)) return finishBlocked(state, WORKER_REASONS.DNS_UPDATE_FAILED);
      if (switched.route !== WORKER_STATUS.FALLBACK_ACTIVE && switched.route !== 'FALLBACK_ACTIVE') {
        return finishBlocked(state, WORKER_REASONS.DNS_UPDATE_FAILED);
      }
    } catch (error) {
      return finishBlocked(state, isDnsAmbiguous(error) ? WORKER_REASONS.DNS_AMBIGUOUS : WORKER_REASONS.DNS_UPDATE_FAILED);
    }
    return finishFallback(state);
  }

  function pendingKey(state) {
    return `${state.generation}:${state.pendingIncident?.eventFingerprint ?? ''}`;
  }

  function schedule(state) {
    const key = pendingKey(state);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const operation = runVerification(state)
      .catch(async () => {
        try {
          return await finishBlocked(state, WORKER_REASONS.STATE_UPDATE_FAILED);
        } catch {
          return result(WORKER_STATUS.BLOCKED, state, { reason: WORKER_REASONS.STATE_UPDATE_FAILED });
        }
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, operation);
    return operation;
  }

  async function acceptAuthenticatedEvent(authResult) {
    const fingerprint = normalizeFingerprint(authResult?.bodyFingerprint);
    const action = authResult?.action === 'triggered' || authResult?.action === 'event_alert.triggered';
    if (authResult?.resource !== 'event_alert' || !action || !fingerprint) {
      return result(WORKER_STATUS.BLOCKED, undefined, { reason: WORKER_REASONS.INVALID_EVENT });
    }

    let state;
    try {
      state = await ensureState();
    } catch (error) {
      return result(WORKER_STATUS.BLOCKED, undefined, { reason: error.code ?? WORKER_REASONS.STATE_UNAVAILABLE });
    }

    let claim;
    try {
      claim = await claimReplay(state, fingerprint);
    } catch (error) {
      return result(WORKER_STATUS.BLOCKED, await safeReadState().catch(() => undefined), {
        reason: error.code ?? WORKER_REASONS.STATE_GENERATION_STALE,
      });
    }
    state = claim.state;
    if (!claim.claimed) {
      return result(WORKER_STATUS.IGNORED, state, {
        accepted: true,
        duplicate: true,
        reason: WORKER_REASONS.DUPLICATE_EVENT,
      });
    }
    if (!state.armed) {
      return result(WORKER_STATUS.IGNORED, state, {
        accepted: true,
        reason: WORKER_REASONS.CONTROLLER_DISARMED,
      });
    }
    if (state.phase !== PHASES.AWS_ACTIVE || state.currentDnsRole !== DNS_ROLES.AWS) {
      return result(WORKER_STATUS.IGNORED, state, {
        accepted: true,
        reason: WORKER_REASONS.STATE_NOT_AWS_ACTIVE,
      });
    }

    const transitionGeneration = state.generation + 1;
    let verifying;
    try {
      verifying = await stateStore.update({
        expectedGeneration: state.generation,
        expectedPhase: PHASES.AWS_ACTIVE,
        patch: {
          phase: PHASES.VERIFYING,
          currentEventFingerprint: fingerprint,
          pendingIncident: {
            eventFingerprint: fingerprint,
            startedAt: now(),
            generation: transitionGeneration,
          },
          terminalReason: null,
        },
        at: now(),
      });
    } catch (error) {
      const current = await safeReadState().catch(() => state);
      if (current?.phase === PHASES.VERIFYING && current.pendingIncident?.eventFingerprint === fingerprint) {
        return result(WORKER_STATUS.VERIFYING, current, { accepted: true, reason: WORKER_REASONS.VERIFYING_IN_PROGRESS });
      }
      return result(WORKER_STATUS.BLOCKED, current, {
        reason: error?.code === 'STALE_GENERATION' ? WORKER_REASONS.STATE_GENERATION_STALE : WORKER_REASONS.STATE_UPDATE_FAILED,
      });
    }

    if (autoResume) void schedule(verifying).catch(() => undefined);
    return result(WORKER_STATUS.VERIFYING, verifying, {
      accepted: true,
      duplicate: false,
      reason: WORKER_REASONS.VERIFICATION_STARTED,
    });
  }

  async function resumePending() {
    const state = await safeReadState();
    if (!state) return result(WORKER_STATUS.IGNORED, undefined, { accepted: true, reason: WORKER_REASONS.NO_PENDING_VERIFICATION });
    if (state.phase !== PHASES.VERIFYING || !state.pendingIncident) {
      return result(WORKER_STATUS.IGNORED, state, { accepted: true, reason: WORKER_REASONS.NO_PENDING_VERIFICATION });
    }
    return schedule(state);
  }

  async function waitForIdle() {
    const pending = [...inFlight.values()];
    if (pending.length === 0) return undefined;
    return Promise.all(pending);
  }

  return {
    acceptAuthenticatedEvent,
    resumePending,
    waitForIdle,
  };
}
