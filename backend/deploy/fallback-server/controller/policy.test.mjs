import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DNS_TARGET,
  POLICY_BLOCKED,
  POLICY_REFUSAL_REASONS,
  ROUTE_STATE,
  SWITCH_TO_FALLBACK,
  decideFailover,
  evaluateFailoverPolicy,
  isFailoverEligible,
} from './policy.mjs';
import { VERIFICATION_DECISION, VERIFICATION_REASONS } from './probes.mjs';

const eligibleInput = Object.freeze({
  controllerArmed: true,
  sentryEventAccepted: true,
  state: ROUTE_STATE.AWS_ACTIVE,
  dnsCurrentTarget: DNS_TARGET.PRIMARY,
  fallbackProductionDbIdentityCertified: true,
  fallbackReleaseHealthy: true,
  fallbackPassiveGatesHealthy: true,
  healthVerification: {
    decision: VERIFICATION_DECISION.ELIGIBLE,
    reason: null,
    primaryFailures: 3,
    fallbackSuccesses: 3,
  },
});

function withChanges(changes) {
  return { ...eligibleInput, ...changes };
}

test('evaluateFailoverPolicy permits only a fully verified one-way switch', () => {
  const result = evaluateFailoverPolicy(eligibleInput);
  assert.deepEqual(result, { decision: SWITCH_TO_FALLBACK, reason: null });
  assert.equal(decideFailover(eligibleInput), SWITCH_TO_FALLBACK);
  assert.equal(isFailoverEligible(eligibleInput), true);
});

test('evaluateFailoverPolicy refuses automatic failback and invalid route states', () => {
  const failback = evaluateFailoverPolicy(withChanges({ state: ROUTE_STATE.FALLBACK_ACTIVE }));
  assert.deepEqual(failback, { decision: POLICY_BLOCKED, reason: POLICY_REFUSAL_REASONS.AUTOMATIC_FAILBACK_DISABLED });

  const unknown = evaluateFailoverPolicy(withChanges({ state: 'UNKNOWN' }));
  assert.deepEqual(unknown, { decision: POLICY_BLOCKED, reason: POLICY_REFUSAL_REASONS.STATE_NOT_AWS_ACTIVE });

  const invalid = evaluateFailoverPolicy(null);
  assert.deepEqual(invalid, { decision: POLICY_BLOCKED, reason: POLICY_REFUSAL_REASONS.INVALID_POLICY_INPUT });
});

test('evaluateFailoverPolicy requires controller arm and an accepted Sentry event', () => {
  assert.equal(decideFailover(withChanges({ controllerArmed: false })), POLICY_REFUSAL_REASONS.CONTROLLER_DISARMED);
  assert.equal(decideFailover(withChanges({ armed: false, controllerArmed: undefined })), POLICY_REFUSAL_REASONS.CONTROLLER_DISARMED);
  assert.equal(decideFailover(withChanges({ sentryEventAccepted: false })), POLICY_REFUSAL_REASONS.SENTRY_EVENT_NOT_ACCEPTED);
  assert.equal(decideFailover(withChanges({ sentryEventAccepted: undefined, sentryAccepted: 'true' })), POLICY_REFUSAL_REASONS.SENTRY_EVENT_NOT_ACCEPTED);
});

test('evaluateFailoverPolicy requires AWS_ACTIVE and DNS still pointing to PRIMARY', () => {
  assert.equal(decideFailover(withChanges({ state: ROUTE_STATE.FALLBACK_ACTIVE })), POLICY_REFUSAL_REASONS.AUTOMATIC_FAILBACK_DISABLED);
  assert.equal(decideFailover(withChanges({ state: 'FALLBACK' })), POLICY_REFUSAL_REASONS.STATE_NOT_AWS_ACTIVE);
  assert.equal(decideFailover(withChanges({ dnsCurrentTarget: DNS_TARGET.FALLBACK })), POLICY_REFUSAL_REASONS.DNS_TARGET_NOT_PRIMARY);
  assert.equal(decideFailover(withChanges({ currentDnsTarget: DNS_TARGET.FALLBACK, dnsCurrentTarget: undefined })), POLICY_REFUSAL_REASONS.DNS_TARGET_NOT_PRIMARY);
});

test('evaluateFailoverPolicy requires certified Production DB identity and healthy release/passive status', () => {
  assert.equal(
    decideFailover(withChanges({ fallbackProductionDbIdentityCertified: false })),
    POLICY_REFUSAL_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED,
  );
  assert.equal(
    decideFailover(withChanges({ fallbackProductionDbIdentityCertified: 'failed' })),
    POLICY_REFUSAL_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED,
  );
  assert.equal(
    decideFailover(withChanges({ fallbackReleaseHealthy: false })),
    POLICY_REFUSAL_REASONS.FALLBACK_RELEASE_NOT_HEALTHY,
  );
  assert.equal(
    decideFailover(withChanges({ fallbackPassiveGatesHealthy: false })),
    POLICY_REFUSAL_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE,
  );

  const statusObject = withChanges({
    fallbackProductionDbIdentityCertified: undefined,
    fallbackReleaseHealthy: undefined,
    fallbackPassiveGatesHealthy: undefined,
    fallbackStatus: { productionDbIdentity: 'certified', release: 'healthy', passiveGates: 'healthy' },
  });
  assert.equal(decideFailover(statusObject), SWITCH_TO_FALLBACK);
});

test('evaluateFailoverPolicy blocks any failed or incomplete health verification', () => {
  const reasons = [
    [
      { decision: VERIFICATION_DECISION.BLOCKED, reason: VERIFICATION_REASONS.PRIMARY_NOT_FAILED },
      POLICY_REFUSAL_REASONS.PRIMARY_NOT_FAILED,
    ],
    [
      { decision: VERIFICATION_DECISION.BLOCKED, reason: VERIFICATION_REASONS.FALLBACK_NOT_READY },
      POLICY_REFUSAL_REASONS.FALLBACK_NOT_READY,
    ],
    [
      { decision: VERIFICATION_DECISION.BLOCKED, reason: VERIFICATION_REASONS.BOTH_ORIGINS_DOWN },
      POLICY_REFUSAL_REASONS.BOTH_ORIGINS_DOWN,
    ],
    [
      { decision: VERIFICATION_DECISION.BLOCKED, reason: VERIFICATION_REASONS.VERIFICATION_ABORTED },
      POLICY_REFUSAL_REASONS.VERIFICATION_ABORTED,
    ],
    [
      { decision: VERIFICATION_DECISION.BLOCKED, reason: VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED },
      POLICY_REFUSAL_REASONS.VERIFICATION_DEADLINE_EXCEEDED,
    ],
    [undefined, POLICY_REFUSAL_REASONS.HEALTH_VERIFICATION_BLOCKED],
    [{ decision: VERIFICATION_DECISION.ELIGIBLE, primaryFailures: 2, fallbackSuccesses: 3 }, POLICY_REFUSAL_REASONS.HEALTH_VERIFICATION_BLOCKED],
    [
      { decision: VERIFICATION_DECISION.ELIGIBLE, reason: VERIFICATION_REASONS.BOTH_ORIGINS_DOWN, primaryFailures: 3, fallbackSuccesses: 3 },
      POLICY_REFUSAL_REASONS.BOTH_ORIGINS_DOWN,
    ],
  ];
  for (const [verification, expected] of reasons) {
    assert.equal(decideFailover(withChanges({ healthVerification: verification })), expected);
  }
});

test('policy outputs only stable codes and never echoes URL, IP, body, or error details', () => {
  const input = withChanges({
    healthVerification: { decision: VERIFICATION_DECISION.BLOCKED, reason: 'https://secret.example/10.0.0.1/body' },
    secretBody: 'password=secret',
  });
  const result = evaluateFailoverPolicy(input);
  assert.equal(result.decision, POLICY_BLOCKED);
  assert.equal(/https?:|10\.0\.0\.1|password|secret/.test(JSON.stringify(result)), false);
  assert.equal(/https?:|10\.0\.0\.1|password|secret/.test(decideFailover(input)), false);
});
