import { randomUUID } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
export const RECEIVER_DEADLINE_MS = 750;
export const RECEIVER_QUEUE_TIMEOUT_MS = 700;
export const DEFAULT_LEASE_MS = 55 * 1000;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
export const DIRECT_MINIMUM_MS = 60 * 60 * 1000;
export const ROUND_TRIP_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SHARED_FAILURE_THRESHOLD = 3;
export const DIRECT_SUCCESS_THRESHOLD = 3;
export const SHARED_HEALTHY_THRESHOLD = 30;
export const EMERGENCY_SHARED_SUCCESS_THRESHOLD = 3;
export const MAX_NORMAL_ROUND_TRIPS = 3;

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
  sharedFailureThreshold: SHARED_FAILURE_THRESHOLD,
  directSuccessThreshold: DIRECT_SUCCESS_THRESHOLD,
  directMinimumMs: DIRECT_MINIMUM_MS,
  sharedHealthyThreshold: SHARED_HEALTHY_THRESHOLD,
  emergencySharedSuccessThreshold: EMERGENCY_SHARED_SUCCESS_THRESHOLD,
  maxNormalRoundTrips: MAX_NORMAL_ROUND_TRIPS,
  roundTripWindowMs: ROUND_TRIP_WINDOW_MS,
  cooldownMs: DEFAULT_COOLDOWN_MS,
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

export function createInitialState(now = Date.now()) {
  return {
    stateKey: 'db-failover',
    generation: 0,
    phase: PHASES.SHARED_ACTIVE,
    activeRoute: ROUTES.SHARED,
    leaseOwner: null,
    leaseExpiresAt: 0,
    lastSentryEventFingerprint: null,
    lastSentryEventAt: 0,
    directActivatedAt: null,
    sharedHealthySince: null,
    sharedHealthyCount: 0,
    sharedFailureCount: 0,
    directSuccessCount: 0,
    directFailureCount: 0,
    emergencySharedSuccessCount: 0,
    cooldownUntil: 0,
    recentRoundTripCount: 0,
    recentRoundTripHistory: [],
    recentSentryEventFingerprints: [],
    ssmCommandId: null,
    errorTerminalPhase: null,
    lastErrorCode: null,
    lastObservedAt: now,
    updatedAt: now,
    pendingTransition: null,
    pendingRoundTripKind: null,
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
