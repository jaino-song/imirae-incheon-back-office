import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  POLICY_REFUSAL_REASONS,
} from './policy.mjs';
import {
  VERIFICATION_DECISION,
  VERIFICATION_REASONS,
} from './probes.mjs';
import {
  DNS_ROLES,
  PHASES,
  createStateStore,
} from './state-store.mjs';
import {
  WORKER_REASONS,
  WORKER_STATUS,
  createFailoverWorker,
} from './worker.mjs';

const NOW = Date.parse('2026-08-31T00:00:00.000Z');
const PRIMARY_IP = '11.22.33.44';
const FALLBACK_IP = '55.66.77.88';

function fingerprint(character) {
  const value = String(character).codePointAt(0) ?? 0;
  return (value % 16).toString(16).repeat(64);
}

function authEvent(character = 'a') {
  return {
    resource: 'event_alert',
    action: 'triggered',
    bodyFingerprint: fingerprint(character),
    payload: {
      secret: 'must never be stored',
      event: 'opaque provider payload',
    },
  };
}

function healthyStatus(overrides = {}) {
  return {
    environment: 'fallback-server',
    releaseHealthy: true,
    containerHealthy: true,
    restartCount: 0,
    dbReady: true,
    productionDbIdentityCertified: true,
    passiveGatesHealthy: true,
    schedulersEnabled: false,
    documentJobsAccepting: false,
    documentJobsWorker: false,
    publicRoutingManaged: false,
    ...overrides,
  };
}

function eligibleHealth() {
  return {
    decision: VERIFICATION_DECISION.ELIGIBLE,
    reason: null,
    primaryFailures: 3,
    fallbackSuccesses: 3,
  };
}

async function fixture({ armed = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'babyjamjam-worker-'));
  const statePath = path.join(directory, 'state.json');
  const stateStore = createStateStore({ statePath, parentDir: directory, now: () => NOW });
  await stateStore.create({ armed, at: NOW });
  return { directory, stateStore };
}

function fakeDns({ target = 'primary', readError, switchError, onSwitch } = {}) {
  let current = target === 'fallback' ? FALLBACK_IP : PRIMARY_IP;
  let switchCalls = 0;
  return {
    get switchCalls() {
      return switchCalls;
    },
    async readCurrentRecord() {
      if (readError) throw readError;
      return {
        id: 'rec_test',
        name: 'api',
        type: 'A',
        ttl: 60,
        value: current,
      };
    },
    async switchToFallback() {
      switchCalls += 1;
      if (onSwitch) await onSwitch();
      if (switchError) throw switchError;
      current = FALLBACK_IP;
      return { changed: true, route: 'FALLBACK_ACTIVE' };
    },
  };
}

function workerFor(fixtureValue, {
  dnsClient = fakeDns(),
  status = healthyStatus(),
  verification = eligibleHealth(),
  evaluatePolicy,
    verifyHealth,
    readFallbackStatus,
    autoResume = false,
    afterDnsReservation,
  } = {}) {
  return createFailoverWorker({
    stateStore: fixtureValue.stateStore,
    dnsClient,
    primaryIpv4: PRIMARY_IP,
    fallbackIpv4: FALLBACK_IP,
    expectedImageTag: 'a'.repeat(40),
    expectedImageDigest: `sha256:${'b'.repeat(64)}`,
    readFallbackStatus: readFallbackStatus ?? (async () => status),
    verifyHealth: verifyHealth ?? (async () => verification),
    evaluatePolicy,
    clock: () => NOW,
    autoResume,
    afterDnsReservation,
  });
}

test('accept claims replay, durably records VERIFYING, and completes one-way failover', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, { dnsClient: dns });

  const accepted = await worker.acceptAuthenticatedEvent(authEvent('a'));
  assert.equal(accepted.status, WORKER_STATUS.VERIFYING);
  assert.equal(accepted.state.phase, PHASES.VERIFYING);
  assert.equal(accepted.state.pendingIncident.eventFingerprint, fingerprint('a'));

  const resumed = await worker.resumePending();
  assert.equal(resumed.status, WORKER_STATUS.FALLBACK_ACTIVE);
  assert.equal(resumed.state.phase, PHASES.FALLBACK_ACTIVE);
  assert.equal(resumed.state.currentDnsRole, DNS_ROLES.FALLBACK);
  assert.equal(resumed.state.pendingIncident, null);
  assert.equal(dns.switchCalls, 1);
  assert.equal((await value.stateStore.read()).phase, PHASES.FALLBACK_ACTIVE);
});

test('autoResume runs the bounded worker after the durable acceptance response', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, { dnsClient: dns, autoResume: true });

  const accepted = await worker.acceptAuthenticatedEvent(authEvent('o'));
  assert.equal(accepted.status, WORKER_STATUS.VERIFYING);
  await worker.waitForIdle();
  const state = await value.stateStore.read();
  assert.equal(state.phase, PHASES.FALLBACK_ACTIVE);
  assert.equal(dns.switchCalls, 1);
});

test('disarmed events are accepted and ignored after replay claim without transition', async (t) => {
  const value = await fixture({ armed: false });
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  let verifyCalls = 0;
  const worker = workerFor(value, {
    dnsClient: dns,
    verifyHealth: async () => {
      verifyCalls += 1;
      return eligibleHealth();
    },
  });

  const result = await worker.acceptAuthenticatedEvent(authEvent('b'));
  assert.equal(result.accepted, true);
  assert.equal(result.status, WORKER_STATUS.IGNORED);
  assert.equal(result.reason, WORKER_REASONS.CONTROLLER_DISARMED);
  assert.equal(result.state.phase, PHASES.AWS_ACTIVE);
  assert.equal(result.state.pendingIncident, null);
  assert.equal(result.state.replayFingerprints.length, 1);
  assert.equal(verifyCalls, 0);
  assert.equal(dns.switchCalls, 0);
});

test('duplicate deliveries are no-ops and never issue a second PATCH', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, { dnsClient: dns });
  const event = authEvent('c');

  await worker.acceptAuthenticatedEvent(event);
  const duplicate = await worker.acceptAuthenticatedEvent(event);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.status, WORKER_STATUS.IGNORED);
  assert.equal(duplicate.duplicate, true);
  await worker.resumePending();
  const after = await worker.acceptAuthenticatedEvent(event);
  assert.equal(after.duplicate, true);
  assert.equal(dns.switchCalls, 1);
});

test('events received after Fallback is active never trigger automatic failback', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const initialDns = fakeDns();
  const worker = workerFor(value, { dnsClient: initialDns });
  await worker.acceptAuthenticatedEvent(authEvent('r'));
  await worker.resumePending();
  assert.equal(initialDns.switchCalls, 1);

  const dns = fakeDns({ target: 'fallback' });
  const fallbackWorker = workerFor(value, { dnsClient: dns });
  const result = await fallbackWorker.acceptAuthenticatedEvent(authEvent('s'));
  assert.equal(result.status, WORKER_STATUS.IGNORED);
  assert.equal(result.reason, WORKER_REASONS.STATE_NOT_AWS_ACTIVE);
  assert.equal(dns.switchCalls, 0);
  assert.equal((await value.stateStore.read()).phase, PHASES.FALLBACK_ACTIVE);
});

test('primary recovery resets AWS_ACTIVE and clears the pending incident', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, {
    dnsClient: dns,
    verification: {
      decision: VERIFICATION_DECISION.BLOCKED,
      reason: VERIFICATION_REASONS.PRIMARY_NOT_FAILED,
      primaryFailures: 0,
      fallbackSuccesses: 0,
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('d'));
  const result = await worker.resumePending();
  assert.equal(result.status, WORKER_STATUS.AWS_ACTIVE);
  assert.equal(result.reason, WORKER_REASONS.PRIMARY_NOT_FAILED);
  assert.equal(result.state.phase, PHASES.AWS_ACTIVE);
  assert.equal(result.state.currentDnsRole, DNS_ROLES.AWS);
  assert.equal(result.state.pendingIncident, null);
  assert.equal(dns.switchCalls, 0);
});

test('primary recovery never auto-fails back when DNS is already on Fallback', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns({ target: 'fallback' });
  const worker = workerFor(value, {
    dnsClient: dns,
    verification: {
      decision: VERIFICATION_DECISION.BLOCKED,
      reason: VERIFICATION_REASONS.PRIMARY_NOT_FAILED,
      primaryFailures: 0,
      fallbackSuccesses: 0,
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('q'));
  const result = await worker.resumePending();
  assert.equal(result.status, WORKER_STATUS.BLOCKED);
  assert.equal(result.reason, WORKER_REASONS.DNS_DRIFT);
  assert.equal(result.state.currentDnsRole, DNS_ROLES.FALLBACK);
  assert.equal(dns.switchCalls, 0);
});

test('disarm during health verification clears pending state and prevents DNS mutation', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, {
    dnsClient: dns,
    verifyHealth: async () => {
      const current = await value.stateStore.read();
      await value.stateStore.update({
        expectedGeneration: current.generation,
        expectedPhase: PHASES.VERIFYING,
        patch: { armed: false },
        at: NOW + 1,
      });
      return eligibleHealth();
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('z'));
  const result = await worker.resumePending();
  const state = await value.stateStore.read();

  assert.equal(result.status, WORKER_STATUS.AWS_ACTIVE);
  assert.equal(result.reason, WORKER_REASONS.CONTROLLER_DISARMED);
  assert.equal(dns.switchCalls, 0);
  assert.equal(state.armed, false);
  assert.equal(state.phase, PHASES.AWS_ACTIVE);
  assert.equal(state.currentDnsRole, DNS_ROLES.AWS);
  assert.equal(state.pendingIncident, null);
  assert.equal(state.currentEventFingerprint, null);
});

test('disarm during a blocked verification clears pending state without leaving a retryable incident', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, {
    dnsClient: dns,
    verifyHealth: async () => {
      const current = await value.stateStore.read();
      await value.stateStore.update({
        expectedGeneration: current.generation,
        expectedPhase: PHASES.VERIFYING,
        patch: { armed: false },
        at: NOW + 1,
      });
      return {
        decision: VERIFICATION_DECISION.BLOCKED,
        reason: VERIFICATION_REASONS.BOTH_ORIGINS_DOWN,
        primaryFailures: 3,
        fallbackSuccesses: 0,
      };
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('y'));
  const result = await worker.resumePending();
  const state = await value.stateStore.read();

  assert.equal(result.status, WORKER_STATUS.AWS_ACTIVE);
  assert.equal(result.reason, WORKER_REASONS.CONTROLLER_DISARMED);
  assert.equal(dns.switchCalls, 0);
  assert.equal(state.armed, false);
  assert.equal(state.phase, PHASES.AWS_ACTIVE);
  assert.equal(state.pendingIncident, null);
});

test('disarm after DNS_COMMITTING reservation is refused and exactly one PATCH occurs', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  let disarmRejected = false;
  const worker = workerFor(value, {
    dnsClient: dns,
    afterDnsReservation: async () => {
      const current = await value.stateStore.read();
      await assert.rejects(
        value.stateStore.update({
          expectedGeneration: current.generation,
          expectedPhase: PHASES.DNS_COMMITTING,
          patch: { armed: false },
          at: NOW + 1,
        }),
        (error) => error.code === 'DNS_COMMITTING_DISARM_FORBIDDEN',
      );
      disarmRejected = true;
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('x'));
  const result = await worker.resumePending();
  const state = await value.stateStore.read();

  assert.equal(disarmRejected, true);
  assert.equal(result.status, WORKER_STATUS.FALLBACK_ACTIVE);
  assert.equal(state.phase, PHASES.FALLBACK_ACTIVE);
  assert.equal(state.armed, true);
  assert.equal(dns.switchCalls, 1);
});

test('DNS_COMMITTING recovery reconciles live DNS without blind promotion or a second PATCH', async (t) => {
  await t.test('fallback target finalizes', async (t2) => {
    const value = await fixture();
    t2.after(() => fs.rm(value.directory, { recursive: true, force: true }));
    const firstDns = fakeDns();
    const first = workerFor(value, {
      dnsClient: firstDns,
      afterDnsReservation: async () => {},
    });
    await first.acceptAuthenticatedEvent(authEvent('v'));
    await first.resumePending();

    const current = await value.stateStore.read();
    // Re-create the point-of-no-return record to model a crash before finalization.
    await value.stateStore.update({
      expectedGeneration: current.generation,
      expectedPhase: PHASES.FALLBACK_ACTIVE,
      patch: {
        phase: PHASES.DNS_COMMITTING,
        currentDnsRole: DNS_ROLES.AWS,
        currentEventFingerprint: current.lastEventFingerprint,
        pendingIncident: {
          eventFingerprint: current.lastEventFingerprint,
          startedAt: NOW,
          generation: current.generation + 1,
        },
        terminalReason: null,
      },
      at: NOW + 2,
    });
    const resumedDns = fakeDns({ target: 'fallback' });
    const resumed = workerFor(value, { dnsClient: resumedDns });
    const result = await resumed.resumePending();
    assert.equal(result.status, WORKER_STATUS.FALLBACK_ACTIVE);
    assert.equal(resumedDns.switchCalls, 0);
  });

  await t.test('primary target blocks safely', async (t2) => {
    const value = await fixture();
    t2.after(() => fs.rm(value.directory, { recursive: true, force: true }));
    const first = workerFor(value);
    await first.acceptAuthenticatedEvent(authEvent('w'));
    await first.resumePending();
    const current = await value.stateStore.read();
    await value.stateStore.update({
      expectedGeneration: current.generation,
      expectedPhase: PHASES.FALLBACK_ACTIVE,
      patch: {
        phase: PHASES.DNS_COMMITTING,
        currentDnsRole: DNS_ROLES.AWS,
        currentEventFingerprint: current.lastEventFingerprint,
        pendingIncident: {
          eventFingerprint: current.lastEventFingerprint,
          startedAt: NOW,
          generation: current.generation + 1,
        },
        terminalReason: null,
      },
      at: NOW + 2,
    });
    const resumedDns = fakeDns();
    const resumed = workerFor(value, { dnsClient: resumedDns });
    const result = await resumed.resumePending();
    assert.equal(result.status, WORKER_STATUS.BLOCKED);
    assert.equal(result.reason, WORKER_REASONS.DNS_COMMIT_PRIMARY_OBSERVED);
    assert.equal(resumedDns.switchCalls, 0);
  });
});

test('both origins down becomes a terminal blocked state with a stable reason', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, {
    dnsClient: dns,
    verification: {
      decision: VERIFICATION_DECISION.BLOCKED,
      reason: VERIFICATION_REASONS.BOTH_ORIGINS_DOWN,
      primaryFailures: 3,
      fallbackSuccesses: 0,
    },
  });

  await worker.acceptAuthenticatedEvent(authEvent('e'));
  const result = await worker.resumePending();
  assert.equal(result.accepted, false);
  assert.equal(result.status, WORKER_STATUS.BLOCKED);
  assert.equal(result.reason, WORKER_REASONS.BOTH_ORIGINS_DOWN);
  assert.equal(result.state.phase, PHASES.BLOCKED);
  assert.equal(result.state.terminalReason, WORKER_REASONS.BOTH_ORIGINS_DOWN);
  assert.equal(dns.switchCalls, 0);
});

test('fallback status, DB identity, image, and passive gate failures block before health probes', async (t) => {
  for (const [name, status, reason] of [
    ['status shape', null, WORKER_REASONS.FALLBACK_STATUS_INVALID],
    ['missing container gate', { environment: 'fallback-server', releaseHealthy: true, productionDbIdentityCertified: true, passiveGatesHealthy: true }, WORKER_REASONS.FALLBACK_STATUS_INVALID],
    ['release', healthyStatus({ releaseHealthy: false }), WORKER_REASONS.FALLBACK_RELEASE_UNHEALTHY],
    ['database identity', healthyStatus({ productionDbIdentityCertified: false }), WORKER_REASONS.FALLBACK_DB_IDENTITY_UNCERTIFIED],
    ['passive gates', healthyStatus({ passiveGatesHealthy: false }), WORKER_REASONS.FALLBACK_PASSIVE_GATES_UNSAFE],
  ]) {
    await t.test(name, async (t2) => {
      const value = await fixture();
      t2.after(() => fs.rm(value.directory, { recursive: true, force: true }));
      let verifyCalls = 0;
      const dns = fakeDns();
      const worker = workerFor(value, {
        dnsClient: dns,
        status,
        verifyHealth: async () => {
          verifyCalls += 1;
          return eligibleHealth();
        },
      });
      await worker.acceptAuthenticatedEvent(authEvent(name === 'status shape' ? 'f' : name[0]));
      const result = await worker.resumePending();
      assert.equal(result.status, WORKER_STATUS.BLOCKED);
      assert.equal(result.reason, reason);
      assert.equal(verifyCalls, 0);
      assert.equal(dns.switchCalls, 0);
    });
  }
});

test('DNS drift and ambiguous reads block without probing or switching', async (t) => {
  await t.test('drift', async (t2) => {
    const value = await fixture();
    t2.after(() => fs.rm(value.directory, { recursive: true, force: true }));
    const dns = fakeDns({ target: 'unknown' });
    let verifyCalls = 0;
    const worker = workerFor(value, {
      dnsClient: {
        ...dns,
        async readCurrentRecord() {
          return { id: 'rec_test', name: 'api', type: 'A', ttl: 60, value: '8.8.8.8' };
        },
      },
      verifyHealth: async () => {
        verifyCalls += 1;
        return eligibleHealth();
      },
    });
    await worker.acceptAuthenticatedEvent(authEvent('g'));
    const result = await worker.resumePending();
    assert.equal(result.reason, WORKER_REASONS.DNS_DRIFT);
    assert.equal(verifyCalls, 0);
  });

  await t.test('ambiguous read', async (t2) => {
    const value = await fixture();
    t2.after(() => fs.rm(value.directory, { recursive: true, force: true }));
    const worker = workerFor(value, {
      dnsClient: fakeDns({ readError: { code: 'MANUAL_CHECK', ambiguous: true } }),
    });
    await worker.acceptAuthenticatedEvent(authEvent('h'));
    const result = await worker.resumePending();
    assert.equal(result.reason, WORKER_REASONS.DNS_AMBIGUOUS);
  });
});

test('ambiguous DNS update becomes manual_check and does not retry', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns({ switchError: { code: 'MANUAL_CHECK', ambiguous: true } });
  const worker = workerFor(value, { dnsClient: dns });
  await worker.acceptAuthenticatedEvent(authEvent('i'));
  const result = await worker.resumePending();
  assert.equal(result.status, WORKER_STATUS.BLOCKED);
  assert.equal(result.reason, WORKER_REASONS.DNS_AMBIGUOUS);
  assert.equal(dns.switchCalls, 1);
  const duplicate = await worker.resumePending();
  assert.equal(duplicate.reason, WORKER_REASONS.NO_PENDING_VERIFICATION);
  assert.equal(dns.switchCalls, 1);
});

test('restart recovery finalizes a previously applied Fallback DNS target without a second PATCH', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  await workerFor(value).acceptAuthenticatedEvent(authEvent('j'));

  const dns = fakeDns({ target: 'fallback' });
  const restartedWorker = workerFor(value, { dnsClient: dns });
  const result = await restartedWorker.resumePending();
  assert.equal(result.status, WORKER_STATUS.FALLBACK_ACTIVE);
  assert.equal(result.state.phase, PHASES.FALLBACK_ACTIVE);
  assert.equal(dns.switchCalls, 0);
});

test('a non-eligible policy refusal restores AWS_ACTIVE instead of failback', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const dns = fakeDns();
  const worker = workerFor(value, {
    dnsClient: dns,
    evaluatePolicy: () => ({ decision: 'BLOCKED', reason: POLICY_REFUSAL_REASONS.CONTROLLER_DISARMED }),
  });

  await worker.acceptAuthenticatedEvent(authEvent('k'));
  const result = await worker.resumePending();
  assert.equal(result.status, WORKER_STATUS.AWS_ACTIVE);
  assert.equal(result.state.phase, PHASES.AWS_ACTIVE);
  assert.equal(result.state.pendingIncident, null);
  assert.equal(dns.switchCalls, 0);
});

test('concurrent acceptance of the same event has one claim and one VERIFYING transition', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const workerA = workerFor(value);
  const workerB = workerFor(value);
  const [first, second] = await Promise.all([
    workerA.acceptAuthenticatedEvent(authEvent('l')),
    workerB.acceptAuthenticatedEvent(authEvent('l')),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [WORKER_STATUS.IGNORED, WORKER_STATUS.VERIFYING].sort());
  assert.equal((await value.stateStore.read()).phase, PHASES.VERIFYING);
});

test('worker outcomes never echo provider payloads, URLs, IPs, tokens, or raw errors', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const worker = workerFor(value, {
    dnsClient: fakeDns({ readError: new Error('https://secret.invalid/10.0.0.1 token=secret') }),
  });
  await worker.acceptAuthenticatedEvent(authEvent('m'));
  const result = await worker.resumePending();
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret.invalid'), false);
  assert.equal(serialized.includes('10.0.0.1'), false);
  assert.equal(serialized.includes('token=secret'), false);
  assert.equal(serialized.includes('opaque provider payload'), false);
});

test('invalid authenticated events are rejected without touching state', async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.directory, { recursive: true, force: true }));
  const worker = workerFor(value);
  const result = await worker.acceptAuthenticatedEvent({
    resource: 'metric_alert',
    action: 'critical',
    bodyFingerprint: fingerprint('n'),
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, WORKER_REASONS.INVALID_EVENT);
  const state = await value.stateStore.read();
  assert.equal(state.generation, 0);
  assert.deepEqual(state.replayFingerprints, []);
});
