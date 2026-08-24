import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASES, ROUTES, createInitialState } from '../src/constants.mjs';
import {
  HostEnvelopeValidationError,
  HostResultReplayError,
  markControlPlaneFailure,
  mirrorHostEnvelope,
  normalizeHostEnvelope,
  normalizeState,
} from '../src/reconciler.mjs';

const NOW = Date.parse('2026-08-24T00:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'babyjamjam-db-failover-host',
    controlPlaneOk: true,
    environment: 'preview',
    requestId: REQUEST_ID,
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

function initial(overrides = {}) {
  return {
    ...createInitialState(NOW),
    ...overrides,
  };
}

test('normalizes persisted SSM dispatch and recovery markers fail closed', () => {
  const defaults = normalizeState({}, NOW);
  assert.equal(defaults.ssmDispatchAttempted, false);
  assert.equal(defaults.ssmRetryPending, false);
  assert.equal(defaults.ssmRecoveryRequestId, null);
  assert.equal(defaults.ssmRecoveryIdentity, null);

  const malformed = normalizeState({
    ...createInitialState(NOW),
    ssmDispatchAttempted: 'true',
    ssmRetryPending: 'true',
    ssmRecoveryRequestId: 'not-a-uuid',
    ssmRecoveryIdentity: 42,
  }, NOW);
  assert.equal(malformed.ssmDispatchAttempted, true);
  assert.equal(malformed.ssmRetryPending, false);
  assert.equal(malformed.ssmRecoveryRequestId, null);
  assert.equal(malformed.ssmRecoveryIdentity, null);

  const valid = normalizeState({
    ...createInitialState(NOW),
    ssmDispatchAttempted: true,
    ssmRetryPending: true,
    ssmRecoveryRequestId: REQUEST_ID,
    ssmRecoveryIdentity: 'recovery:SWITCHING_TO_DIRECT:SHARED:DIRECT:100:1',
  }, NOW);
  assert.equal(valid.ssmDispatchAttempted, true);
  assert.equal(valid.ssmRetryPending, true);
  assert.equal(valid.ssmRecoveryRequestId, REQUEST_ID);
  assert.equal(valid.ssmRecoveryIdentity, 'recovery:SWITCHING_TO_DIRECT:SHARED:DIRECT:100:1');
});

test('normalizes the complete host result envelope without dropping fields', () => {
  const value = envelope({
    hostGeneration: 4,
    sharedFailureCount: 2,
    directSuccessCount: 3,
    recentNormalRoundTrips: [100, 200],
  });
  const normalized = normalizeHostEnvelope(value, { environment: 'preview', requestId: REQUEST_ID });
  assert.deepEqual(normalized, value);
  assert.notEqual(normalized.transition, value.transition);
  assert.notEqual(normalized.recentNormalRoundTrips, value.recentNormalRoundTrips);
});

test('rejects partial, extra, wrong-identity, and malformed host results', () => {
  for (const mutate of [
    (value) => { delete value.result; },
    (value) => { value.untrusted = 'shell'; },
    (value) => { value.schemaVersion = 2; },
    (value) => { value.source = 'lambda'; },
    (value) => { value.environment = 'production'; },
    (value) => { value.requestId = '10000000-0000-4000-8000-000000000001'; },
    (value) => { value.hostGeneration = -1; },
    (value) => { value.sharedFailureCount = 1.5; },
    (value) => { value.recentNormalRoundTrips = [2, 1]; },
    (value) => { value.transition.targetRoute = ROUTES.DIRECT; },
  ]) {
    const value = envelope();
    mutate(value);
    assert.throws(
      () => normalizeHostEnvelope(value, { environment: 'preview', requestId: REQUEST_ID }),
      HostEnvelopeValidationError,
    );
  }
});

test('rejects secret-like and oversized result tokens or history arrays', () => {
  assert.throws(
    () => normalizeHostEnvelope(envelope({ result: 'https://attacker.invalid' })),
    HostEnvelopeValidationError,
  );
  assert.throws(
    () => normalizeHostEnvelope(envelope({ result: 'x'.repeat(65) })),
    HostEnvelopeValidationError,
  );
  assert.throws(
    () => normalizeHostEnvelope(envelope({ recentNormalRoundTrips: Array.from({ length: 129 }, (_, i) => i) })),
    HostEnvelopeValidationError,
  );
});

test('enforces host phase, route, transition, and terminal-reason combinations', () => {
  const switching = envelope({
    activeRoute: ROUTES.SHARED,
    phase: PHASES.SWITCHING_TO_DIRECT,
    result: 'transition_started',
    transition: {
      previousRoute: ROUTES.SHARED,
      targetRoute: ROUTES.DIRECT,
      startedAt: 100,
      generation: 1,
      terminalReason: null,
    },
  });
  assert.doesNotThrow(() => normalizeHostEnvelope(switching));

  assert.doesNotThrow(() => normalizeHostEnvelope(envelope({
    activeRoute: ROUTES.DIRECT,
    phase: PHASES.RECOVERING_SHARED,
    result: 'shared_healthy_emergency_wait',
    directOk: false,
  })));

  assert.throws(
    () => normalizeHostEnvelope({ ...switching, activeRoute: ROUTES.DIRECT }),
    HostEnvelopeValidationError,
  );
  assert.throws(
    () => normalizeHostEnvelope({ ...switching, transition: { ...switching.transition, generation: 2 } }),
    HostEnvelopeValidationError,
  );

  const degraded = envelope({
    phase: PHASES.DEGRADED,
    result: 'compensation_failed',
    terminalReason: 'compensation_failed',
    transition: {
      previousRoute: null,
      targetRoute: null,
      startedAt: 0,
      generation: 0,
      terminalReason: 'compensation_failed',
    },
  });
  assert.doesNotThrow(() => normalizeHostEnvelope(degraded));
  assert.throws(
    () => normalizeHostEnvelope({ ...degraded, terminalReason: null }),
    HostEnvelopeValidationError,
  );
});

test('mirrors a newer host result losslessly, including terminal result fields', () => {
  const host = envelope({
    hostGeneration: 3,
    phase: PHASES.BLOCKED,
    activeRoute: ROUTES.DIRECT,
    result: 'both_routes_failed',
    sharedOk: false,
    directOk: false,
    sharedFailureCount: 3,
    directFailureCount: 3,
    recentNormalRoundTrips: [100, 200],
    terminalReason: 'both_routes_failed',
    transition: {
      previousRoute: null,
      targetRoute: null,
      startedAt: 0,
      generation: 0,
      terminalReason: 'both_routes_failed',
    },
  });
  const result = mirrorHostEnvelope(initial(), host, NOW, {
    environment: 'preview',
    requestId: REQUEST_ID,
  });
  assert.equal(result.status, 'mirrored');
  assert.equal(result.state.hostGeneration, 3);
  assert.equal(result.state.phase, PHASES.BLOCKED);
  assert.equal(result.state.activeRoute, ROUTES.DIRECT);
  assert.equal(result.state.terminalPhase, PHASES.BLOCKED);
  assert.equal(result.state.terminalReason, 'both_routes_failed');
  assert.equal(result.state.lastHostResult, 'both_routes_failed');
  assert.equal(result.state.lastHostObservedAt, NOW);
  assert.deepEqual(result.state.recentNormalRoundTrips, [100, 200]);
  assert.deepEqual(result.state.transition, host.transition);
});

test('mirrors stale-transition compensation as the host-provided prior active phase', () => {
  const state = initial({
    hostGeneration: 2,
    phase: PHASES.SWITCHING_TO_DIRECT,
    activeRoute: ROUTES.SHARED,
    transition: {
      previousRoute: ROUTES.SHARED,
      targetRoute: ROUTES.DIRECT,
      startedAt: 100,
      generation: 2,
      terminalReason: null,
    },
  });
  const host = envelope({
    hostGeneration: 3,
    phase: PHASES.SHARED_ACTIVE,
    activeRoute: ROUTES.SHARED,
    result: 'stale_transition_compensated',
  });
  const result = mirrorHostEnvelope(state, host, NOW, {
    environment: 'preview',
    requestId: REQUEST_ID,
  });
  assert.equal(result.state.phase, PHASES.SHARED_ACTIVE);
  assert.equal(result.state.activeRoute, ROUTES.SHARED);
  assert.equal(result.state.result, 'stale_transition_compensated');
  assert.deepEqual(result.state.transition, host.transition);
});

test('rejects out-of-order or conflicting duplicate generations without state residue', () => {
  const first = envelope({ hostGeneration: 2 });
  const mirrored = mirrorHostEnvelope(initial(), first, NOW, { environment: 'preview', requestId: REQUEST_ID });
  const duplicate = mirrorHostEnvelope(mirrored.state, first, NOW + 1, {
    environment: 'preview',
    requestId: REQUEST_ID,
  });
  assert.equal(duplicate.status, 'duplicate');
  assert.deepEqual(duplicate.state, mirrored.state);

  assert.throws(
    () => mirrorHostEnvelope(mirrored.state, envelope({ hostGeneration: 1 }), NOW + 2, {
      environment: 'preview',
      requestId: REQUEST_ID,
    }),
    HostResultReplayError,
  );
  assert.throws(
    () => mirrorHostEnvelope(mirrored.state, envelope({ hostGeneration: 2, result: 'different' }), NOW + 2, {
      environment: 'preview',
      requestId: REQUEST_ID,
    }),
    HostResultReplayError,
  );
});

test('control-plane failure changes only control-plane status and preserves host route and phase', () => {
  const state = initial({
    activeRoute: ROUTES.DIRECT,
    phase: PHASES.DIRECT_ACTIVE,
    hostGeneration: 7,
    sharedFailureCount: 2,
    lastHostResult: 'direct_healthy',
  });
  const failed = markControlPlaneFailure(state, {
    status: 'DEGRADED',
    error: 'AWS_CONTROL_PLANE_FAILURE',
    now: NOW + 1,
  });
  assert.equal(failed.phase, PHASES.DIRECT_ACTIVE);
  assert.equal(failed.activeRoute, ROUTES.DIRECT);
  assert.equal(failed.hostGeneration, 7);
  assert.equal(failed.sharedFailureCount, 2);
  assert.equal(failed.controlPlaneStatus, 'DEGRADED');
  assert.equal(failed.controlPlaneError, 'AWS_CONTROL_PLANE_FAILURE');
});
