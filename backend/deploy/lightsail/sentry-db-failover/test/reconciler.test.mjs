import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RECONCILE_CONFIG,
  PHASES,
  ROUTES,
  createInitialState,
} from '../src/constants.mjs';
import { reconcileState } from '../src/reconciler.mjs';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function initial(overrides = {}) {
  return {
    ...createInitialState(0),
    ...overrides,
  };
}

test('requires three shared failures and three direct successes before switching', () => {
  let state = initial();
  for (let index = 0; index < 2; index += 1) {
    const result = reconcileState(state, { sharedOk: false, directOk: true }, (index + 1) * MINUTE);
    state = result.state;
    assert.equal(state.phase, PHASES.DEGRADED);
    assert.equal(result.action, 'none');
  }
  const result = reconcileState(state, { sharedOk: false, directOk: true }, 3 * MINUTE);
  assert.equal(result.state.phase, PHASES.SWITCHING_TO_DIRECT);
  assert.equal(result.state.activeRoute, ROUTES.SHARED);
  assert.equal(result.action, 'switch_to_direct');

  const confirmed = reconcileState(
    result.state,
    { sharedOk: false, directOk: true, activeRoute: ROUTES.DIRECT },
    4 * MINUTE,
  );
  assert.equal(confirmed.state.phase, PHASES.DIRECT_ACTIVE);
  assert.equal(confirmed.state.activeRoute, ROUTES.DIRECT);
  assert.equal(confirmed.state.directActivatedAt, 4 * MINUTE);
});
test('blocks when both routes fail and never chooses a new route on control-plane failure', () => {
  const direct = initial({
    phase: PHASES.DIRECT_ACTIVE,
    activeRoute: ROUTES.DIRECT,
    directActivatedAt: 0,
  });
  const bothDown = reconcileState(direct, { sharedOk: false, directOk: false }, MINUTE);
  assert.equal(bothDown.state.phase, PHASES.BLOCKED);
  assert.equal(bothDown.state.errorTerminalPhase, PHASES.BLOCKED);
  assert.equal(bothDown.state.activeRoute, ROUTES.DIRECT);

  const controlPlaneFailure = reconcileState(
    direct,
    { controlPlaneOk: false, sharedOk: true, directOk: false },
    2 * MINUTE,
  );
  assert.equal(controlPlaneFailure.state.activeRoute, ROUTES.DIRECT);
  assert.equal(controlPlaneFailure.state.phase, PHASES.DEGRADED);
  assert.equal(controlPlaneFailure.reason, 'control_plane_failure');
});

test('requires one hour and thirty consecutive shared successes for normal failback', () => {
  let state = initial({
    phase: PHASES.DIRECT_ACTIVE,
    activeRoute: ROUTES.DIRECT,
    directActivatedAt: 0,
    cooldownUntil: 0,
    sharedHealthySince: 0,
    sharedHealthyCount: 29,
  });
  const tooSoon = reconcileState(state, { sharedOk: true, directOk: true }, HOUR - MINUTE);
  assert.equal(tooSoon.state.phase, PHASES.DIRECT_ACTIVE);
  assert.equal(tooSoon.state.sharedHealthyCount, 30);

  state = tooSoon.state;
  const ready = reconcileState(state, { sharedOk: true, directOk: true }, HOUR);
  assert.equal(ready.state.phase, PHASES.SWITCHING_TO_SHARED);
  assert.equal(ready.state.pendingRoundTripKind, 'normal');
  assert.equal(ready.action, 'switch_to_shared');

  const confirmed = reconcileState(
    ready.state,
    { sharedOk: true, directOk: true, activeRoute: ROUTES.SHARED },
    HOUR + MINUTE,
  );
  assert.equal(confirmed.state.phase, PHASES.SHARED_ACTIVE);
  assert.equal(confirmed.state.activeRoute, ROUTES.SHARED);
  assert.equal(confirmed.state.recentRoundTripCount, 1);
});

test('uses emergency failback after three direct failures with shared success', () => {
  let state = initial({
    phase: PHASES.DIRECT_ACTIVE,
    activeRoute: ROUTES.DIRECT,
    directActivatedAt: 0,
  });
  for (let index = 0; index < 2; index += 1) {
    state = reconcileState(state, { sharedOk: true, directOk: false }, HOUR + index * MINUTE).state;
    assert.equal(state.phase, PHASES.DEGRADED);
  }
  const emergency = reconcileState(state, { sharedOk: true, directOk: false }, HOUR + 2 * MINUTE);
  assert.equal(emergency.state.phase, PHASES.RECOVERING_SHARED);
  assert.equal(emergency.state.pendingRoundTripKind, 'emergency');
  assert.equal(emergency.action, 'switch_to_shared');

  const confirmed = reconcileState(
    emergency.state,
    { sharedOk: true, directOk: false, activeRoute: ROUTES.SHARED },
    HOUR + 3 * MINUTE,
  );
  assert.equal(confirmed.state.phase, PHASES.SHARED_ACTIVE);
  assert.equal(confirmed.state.recentRoundTripCount, 0);
});

test('blocks the third normal round trip within six hours', () => {
  const state = initial({
    phase: PHASES.DIRECT_ACTIVE,
    activeRoute: ROUTES.DIRECT,
    directActivatedAt: 0,
    cooldownUntil: 0,
    sharedHealthyCount: DEFAULT_RECONCILE_CONFIG.sharedHealthyThreshold - 1,
    recentRoundTripHistory: [
      { at: 0, kind: 'normal', from: ROUTES.DIRECT, to: ROUTES.SHARED },
      { at: HOUR, kind: 'normal', from: ROUTES.DIRECT, to: ROUTES.SHARED },
    ],
  });
  const result = reconcileState(
    state,
    { sharedOk: true, directOk: true },
    2 * HOUR,
  );
  assert.equal(result.state.phase, PHASES.BLOCKED);
  assert.equal(result.state.errorTerminalPhase, PHASES.BLOCKED);
  assert.equal(result.reason, 'NORMAL_ROUND_TRIP_BUDGET_EXHAUSTED');
});

test('honors the post-switch cooldown before starting another direct switch', () => {
  let state = initial({ cooldownUntil: 10 * MINUTE });
  for (let index = 1; index <= 3; index += 1) {
    const result = reconcileState(
      state,
      { sharedOk: false, directOk: true },
      index * MINUTE,
    );
    state = result.state;
  }
  assert.equal(state.phase, PHASES.DEGRADED);
  assert.equal(state.sharedFailureCount, 3);
  assert.equal(state.directSuccessCount, 3);
  assert.equal(state.pendingTransition, null);

  const afterCooldown = reconcileState(
    state,
    { sharedOk: false, directOk: true },
    11 * MINUTE,
  );
  assert.equal(afterCooldown.state.phase, PHASES.SWITCHING_TO_DIRECT);
  assert.equal(afterCooldown.action, 'switch_to_direct');
});
