import { createHash, randomUUID } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
export const RECEIVER_DEADLINE_MS = 750;
export const RECEIVER_QUEUE_TIMEOUT_MS = 700;
export const DEFAULT_LEASE_MS = 55 * 1000;

export const HOST_RESULT_SCHEMA_VERSION = 1;
export const HOST_RESULT_SOURCE = 'babyjamjam-db-failover-host';
export const HOST_RESULT_MAX_TOKEN_LENGTH = 64;
export const HOST_RESULT_MAX_HISTORY_LENGTH = 128;
export const HOST_RESULT_MAX_NUMBER = 99_999_999_999;

export const CONTROL_PLANE_STATUS = Object.freeze({
  OK: 'OK',
  IN_FLIGHT: 'IN_FLIGHT',
  DEGRADED: 'DEGRADED',
  BLOCKED: 'BLOCKED',
});

export const HOST_RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'controlPlaneOk',
  'environment',
  'requestId',
  'hostGeneration',
  'activeRoute',
  'phase',
  'result',
  'sharedOk',
  'directOk',
  'sharedFailureCount',
  'directSuccessCount',
  'directFailureCount',
  'emergencySharedSuccessCount',
  'sharedHealthyCount',
  'directActivatedAt',
  'sharedHealthyStartedAt',
  'sharedHealthyLastAt',
  'cooldownUntil',
  'recentNormalRoundTrips',
  'transition',
  'terminalReason',
]);

export const HOST_TRANSITION_KEYS = Object.freeze([
  'previousRoute',
  'targetRoute',
  'startedAt',
  'generation',
  'terminalReason',
]);

export const ROUTES = Object.freeze({
  SHARED: 'SHARED',
  DIRECT: 'DIRECT',
});

export const PHASES = Object.freeze({
  SHARED_ACTIVE: 'SHARED_ACTIVE',
  SWITCHING_TO_DIRECT: 'SWITCHING_TO_DIRECT',
  DIRECT_ACTIVE: 'DIRECT_ACTIVE',
  RECOVERING_SHARED: 'RECOVERING_SHARED',
  SWITCHING_TO_SHARED: 'SWITCHING_TO_SHARED',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED',
});

export const ELIGIBLE_ISSUE_CODES = Object.freeze(['P1001', 'P1017']);
export const REJECTED_ISSUE_CODES = Object.freeze(['P2024']);
export const ELIGIBLE_ACTION = 'critical';
export const ELIGIBLE_RESOURCE = 'metric_alert';
export const EXPECTED_METRIC_AGGREGATE = 'count()';
export const EXPECTED_METRIC_TIME_WINDOW_MINUTES = 1;
export const EXPECTED_METRIC_THRESHOLD = 5;
export const FAILOVER_SIGNAL_CLASS = 'db_failover';
export const REQUIRED_QUERY_MARKERS = Object.freeze([
  'db.failover_eligible:true',
  'db.route:shared',
]);

export const DEFAULT_RECONCILE_CONFIG = Object.freeze({
  leaseMs: DEFAULT_LEASE_MS,
});

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function makeOpaqueRequestId(idFactory = randomUUID) {
  const candidate = idFactory();
  if (typeof candidate !== 'string' || !UUID_PATTERN.test(candidate)) {
    throw new Error('request id factory must return a UUID');
  }
  return candidate;
}

export function makeDeterministicRequestId(identity) {
  if (typeof identity !== 'string' || identity.length === 0 || identity.length > 512) {
    throw new TypeError('request identity must be a bounded non-empty string');
  }
  const digest = createHash('sha256')
    .update('babyjamjam-db-failover-request:')
    .update(identity)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function createInitialState(now = Date.now()) {
  return {
    stateKey: 'db-failover',
    generation: 0,
    hostGeneration: 0,
    hostResultSchemaVersion: null,
    hostResultSource: null,
    resultSchemaVersion: null,
    resultSource: null,
    hostEnvironment: null,
    phase: PHASES.SHARED_ACTIVE,
    activeRoute: ROUTES.SHARED,
    result: null,
    sharedOk: null,
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
    terminalPhase: null,
    terminalReason: null,
    lastHostResult: null,
    lastHostObservedAt: 0,
    lastHostObservationAt: 0,
    lastHostEnvelope: null,
    controlPlaneStatus: CONTROL_PLANE_STATUS.OK,
    controlPlaneError: null,
    leaseOwner: null,
    leaseExpiresAt: 0,
    lastSentryEventFingerprint: null,
    lastSentryEventAt: 0,
    recentSentryEventFingerprints: [],
    ssmCommandId: null,
    ssmRequestId: null,
    ssmRequestIdentity: null,
    ssmDispatchAttempted: false,
    ssmRecoveryRequestId: null,
    ssmRecoveryIdentity: null,
    lastObservedAt: now,
    updatedAt: now,
  };
}

export function parseBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return fallback;
}

export function parseCsv(value, fallback = []) {
  if (typeof value !== 'string') return [...fallback];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeLog(logger, level, event, fields = {}) {
  const target = logger?.[level];
  if (typeof target !== 'function') return;
  target({ event, ...fields });
}
