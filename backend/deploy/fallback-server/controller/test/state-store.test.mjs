import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {
  mkdtemp,
  readFile,
  readdir,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DNS_ROLES,
  MAX_REPLAY_FINGERPRINTS,
  PHASES,
  StateOwnershipError,
  StatePathError,
  StateLockError,
  StateValidationError,
  StaleGenerationError,
  createInitialState,
  createStateStore,
  parseState,
} from '../state-store.mjs';

const NOW = Date.parse('2026-08-31T00:00:00.000Z');

async function makeFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'babyjamjam-state-'));
  const statePath = path.join(directory, 'controller-state.json');
  const store = createStateStore({
    statePath,
    parentDir: directory,
    now: () => NOW,
  });
  return { directory, statePath, store };
}

async function cleanup(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

async function writeLock(statePath, metadata, { ageMs = 0 } = {}) {
  const lockPath = `${statePath}.lock`;
  const value = typeof metadata === 'string' ? metadata : `${JSON.stringify(metadata)}\n`;
  await writeFile(lockPath, value, { mode: 0o600 });
  if (ageMs > 0) {
    const old = new Date(Date.now() - ageMs);
    await utimes(lockPath, old, old);
  }
}

function lockName(statePath) {
  return path.basename(`${statePath}.lock`);
}

function fingerprint(character) {
  return character.repeat(64);
}

test('create, read, and conditional update persist the strict state envelope', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));

  const created = await fixture.store.create();
  assert.deepEqual(created, createInitialState(NOW));
  assert.equal((await fixture.store.read()).generation, 0);

  const updated = await fixture.store.update({
    expectedGeneration: 0,
    expectedPhase: PHASES.AWS_ACTIVE,
    patch: { armed: true },
    at: NOW + 1,
  });
  assert.equal(updated.generation, 1);
  assert.equal(updated.armed, true);
  assert.equal(updated.updatedAt, NOW + 1);
  assert.deepEqual(await fixture.store.get(), updated);

  const positional = await fixture.store.update(1, { armed: false }, { at: NOW + 2 });
  assert.equal(positional.generation, 2);
  assert.equal(positional.armed, false);

  const viaNowAlias = await fixture.store.update({
    expectedGeneration: 2,
    changes: { armed: true },
    now: NOW + 3,
  });
  assert.equal(viaNowAlias.generation, 3);
  assert.equal(viaNowAlias.updatedAt, NOW + 3);

  const raw = await readFile(fixture.statePath, 'utf8');
  assert.equal(JSON.parse(raw).schemaVersion, 1);
  const stats = await fs.lstat(fixture.statePath);
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(stats.isSymbolicLink(), false);
});

test('DNS_COMMITTING is a complete point-of-no-return phase and rejects disarm updates', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create({ armed: true });
  const eventFingerprint = fingerprint('e');
  const verifying = await fixture.store.update({
    expectedGeneration: 0,
    expectedPhase: PHASES.AWS_ACTIVE,
    patch: {
      phase: PHASES.VERIFYING,
      currentEventFingerprint: eventFingerprint,
      lastEventFingerprint: eventFingerprint,
      pendingIncident: {
        eventFingerprint,
        startedAt: NOW,
        generation: 1,
      },
    },
    at: NOW,
  });
  const committing = await fixture.store.update({
    expectedGeneration: verifying.generation,
    expectedPhase: PHASES.VERIFYING,
    patch: {
      phase: PHASES.DNS_COMMITTING,
      armed: true,
      pendingIncident: {
        ...verifying.pendingIncident,
        generation: verifying.generation + 1,
      },
    },
    at: NOW + 1,
  });
  assert.equal(committing.phase, PHASES.DNS_COMMITTING);
  assert.equal(committing.pendingIncident.generation, committing.generation);

  await assert.rejects(
    fixture.store.update({
      expectedGeneration: committing.generation,
      expectedPhase: PHASES.DNS_COMMITTING,
      patch: { armed: false },
      at: NOW + 2,
    }),
    (error) => error.code === 'DNS_COMMITTING_DISARM_FORBIDDEN',
  );
  assert.deepEqual(await fixture.store.read(), committing);
  const recovery = await fixture.store.startupRecovery();
  assert.equal(recovery.dnsCommitting, true);
  assert.deepEqual(recovery.pendingIncident, committing.pendingIncident);
  assert.equal(recovery.canPromoteToFallback, false);

  assert.throws(() => parseState({ ...committing, armed: false }), StateValidationError);
  assert.throws(() => parseState({
    ...committing,
    generation: committing.generation + 1,
  }), StateValidationError);
});

test('VERIFYING state is complete, recoverable, and never promoted by startup recovery', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create({ armed: true });

  const eventFingerprint = fingerprint('a');
  const verifying = await fixture.store.update({
    expectedGeneration: 0,
    expectedPhase: PHASES.AWS_ACTIVE,
    patch: {
      phase: PHASES.VERIFYING,
      currentEventFingerprint: eventFingerprint,
      lastEventFingerprint: eventFingerprint,
      pendingIncident: {
        eventFingerprint,
        startedAt: NOW + 10,
        generation: 1,
      },
    },
    at: NOW + 10,
  });
  assert.equal(verifying.phase, PHASES.VERIFYING);

  const recovery = await fixture.store.startupRecovery();
  assert.deepEqual(recovery.pendingIncident, verifying.pendingIncident);
  assert.equal(recovery.canPromoteToFallback, false);
  assert.equal((await fixture.store.read()).phase, PHASES.VERIFYING);
});

test('startup recovery reports no pending incident before initialization', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));

  const recovery = await fixture.store.startupRecovery();
  assert.equal(recovery.state, undefined);
  assert.equal(recovery.pendingIncident, null);
  assert.equal(recovery.canPromoteToFallback, false);
});

test('stale generation and phase conditions refuse updates without changing state', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();

  await assert.rejects(
    fixture.store.update({ expectedGeneration: 1, patch: { armed: true }, at: NOW + 1 }),
    (error) => error instanceof StaleGenerationError && error.code === 'STALE_GENERATION',
  );
  await assert.rejects(
    fixture.store.update({
      expectedGeneration: 0,
      expectedPhase: PHASES.VERIFYING,
      patch: { armed: true },
      at: NOW + 1,
    }),
    (error) => error.code === 'STATE_PHASE_MISMATCH',
  );
  assert.equal((await fixture.store.read()).generation, 0);
});

test('replay claims are idempotent and stale claims are refused', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();
  const eventFingerprint = fingerprint('b');

  const first = await fixture.store.claimReplayFingerprint(eventFingerprint, {
    expectedGeneration: 0,
    at: NOW + 1,
  });
  assert.equal(first.claimed, true);
  assert.equal(first.generation, 1);
  assert.equal(first.state.currentEventFingerprint, eventFingerprint);
  assert.equal(first.state.lastEventFingerprint, eventFingerprint);
  assert.equal(await fixture.store.hasProcessedFingerprint(eventFingerprint), true);

  const duplicate = await fixture.store.claimReplayFingerprint(eventFingerprint, {
    expectedGeneration: 1,
    at: NOW + 2,
  });
  assert.equal(duplicate.claimed, false);
  assert.deepEqual(duplicate.state, first.state);
  assert.equal(duplicate.generation, 1);

  await assert.rejects(
    fixture.store.claimReplayFingerprint(eventFingerprint, {
      expectedGeneration: 0,
      at: NOW + 3,
    }),
    (error) => error instanceof StaleGenerationError,
  );
  assert.deepEqual(await fixture.store.read(), first.state);
});

test('a stale replay claim does not create a state file', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));

  await assert.rejects(
    fixture.store.claimReplayFingerprint(fingerprint('d'), {
      expectedGeneration: 1,
      at: NOW,
    }),
    (error) => error instanceof StaleGenerationError,
  );
  assert.equal(await fixture.store.read(), undefined);
});

test('replay history remains bounded and evicts the oldest fingerprint', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();

  let generation = 0;
  const fingerprints = [];
  for (let index = 0; index < MAX_REPLAY_FINGERPRINTS + 4; index += 1) {
    const eventFingerprint = index.toString(16).padStart(2, '0').repeat(32);
    fingerprints.push(eventFingerprint);
    const result = await fixture.store.claimReplayFingerprint(eventFingerprint, {
      expectedGeneration: generation,
      at: NOW + index + 1,
    });
    generation = result.generation;
  }

  const state = await fixture.store.read();
  assert.equal(state.replayFingerprints.length, MAX_REPLAY_FINGERPRINTS);
  assert.equal(state.replayFingerprints.includes(fingerprints[0]), false);
  assert.equal(state.replayFingerprints.at(-1), fingerprints.at(-1));
});

test('atomic rename failure preserves the previous state and cleans the temp file', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();
  const before = await fixture.store.read();
  let failRename = true;
  const failingFs = {
    ...fs,
    async rename(...arguments_) {
      if (failRename) {
        failRename = false;
        const error = new Error('simulated rename failure');
        error.code = 'EIO';
        throw error;
      }
      return fs.rename(...arguments_);
    },
  };
  const failingStore = createStateStore({
    statePath: fixture.statePath,
    parentDir: fixture.directory,
    fsModule: failingFs,
    now: () => NOW,
  });

  await assert.rejects(
    failingStore.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 }),
    (error) => error.code === 'EIO',
  );
  assert.deepEqual(await fixture.store.read(), before);
  const names = await readdir(fixture.directory);
  assert.deepEqual(names, ['controller-state.json']);
});

test('stale lock metadata is reclaimed when the owner is dead, PID-reused, or from another boot', async (t) => {
  const scenarios = [
    { name: 'dead owner', metadata: { pid: 9_999, startToken: 'dead', bootId: 'boot' }, alive: false, observedStart: undefined },
    { name: 'pid reuse', metadata: { pid: 123, startToken: 'old-start', bootId: 'boot' }, alive: true, observedStart: 'new-start' },
    { name: 'boot mismatch', metadata: { pid: 123, startToken: 'same-start', bootId: 'old-boot' }, alive: true, observedStart: 'same-start' },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t2) => {
      const fixture = await makeFixture();
      t2.after(() => cleanup(fixture.directory));
      await fixture.store.create();
      const lockStore = createStateStore({
        statePath: fixture.statePath,
        parentDir: fixture.directory,
        lockIdentity: { pid: 123, startToken: 'current-start', bootId: 'boot' },
        isProcessAlive: async () => scenario.alive,
        readProcessStartToken: async () => scenario.observedStart,
        readBootId: async () => 'boot',
        now: () => NOW,
      });
      await writeLock(fixture.statePath, {
        schemaVersion: 1,
        ...scenario.metadata,
        token: '00000000-0000-4000-8000-000000000000',
        acquiredAt: NOW,
      });
      const updated = await lockStore.update({
        expectedGeneration: 0,
        patch: { armed: true },
        at: NOW + 1,
      });
      assert.equal(updated.generation, 1);
      assert.equal((await readdir(fixture.directory)).includes(lockName(fixture.statePath)), false);
    });
  }
});

test('fresh or live locks are never reclaimed, including malformed locks', async (t) => {
  await t.test('live metadata remains', async (t2) => {
    const fixture = await makeFixture();
    t2.after(() => cleanup(fixture.directory));
    await fixture.store.create();
    const lockStore = createStateStore({
      statePath: fixture.statePath,
      parentDir: fixture.directory,
      lockIdentity: { pid: 123, startToken: 'live-start', bootId: 'boot' },
      isProcessAlive: async () => true,
      readProcessStartToken: async () => 'live-start',
      readBootId: async () => 'boot',
      lockTimeoutMs: 0,
    });
    await writeLock(fixture.statePath, {
      schemaVersion: 1,
      pid: 123,
      startToken: 'live-start',
      bootId: 'boot',
      token: '00000000-0000-4000-8000-000000000001',
      acquiredAt: NOW,
    }, { ageMs: 120_000 });
    await assert.rejects(lockStore.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 }), StateLockError);
    assert.equal((await readdir(fixture.directory)).includes(lockName(fixture.statePath)), true);
  });

  await t.test('fresh malformed lock remains', async (t2) => {
    const fixture = await makeFixture();
    t2.after(() => cleanup(fixture.directory));
    await fixture.store.create();
    const lockStore = createStateStore({ statePath: fixture.statePath, parentDir: fixture.directory, lockTimeoutMs: 0 });
    await writeLock(fixture.statePath, 'partially-written-lock');
    await assert.rejects(lockStore.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 }), StateLockError);
    assert.equal((await readdir(fixture.directory)).includes(lockName(fixture.statePath)), true);
  });

  await t.test('old malformed lock is reclaimed', async (t2) => {
    const fixture = await makeFixture();
    t2.after(() => cleanup(fixture.directory));
    await fixture.store.create();
    const lockStore = createStateStore({
      statePath: fixture.statePath,
      parentDir: fixture.directory,
      lockStaleAfterMs: 60_000,
      now: () => NOW,
    });
    await writeLock(fixture.statePath, '', { ageMs: 120_000 });
    const updated = await lockStore.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 });
    assert.equal(updated.generation, 1);
    assert.equal((await readdir(fixture.directory)).includes(lockName(fixture.statePath)), false);
  });
});

test('lock symlinks are treated as unsafe and are not unlinked', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();
  await writeFile(path.join(fixture.directory, 'lock-target'), 'lock', { mode: 0o600 });
  await symlink('lock-target', `${fixture.statePath}.lock`);
  const lockStore = createStateStore({ statePath: fixture.statePath, parentDir: fixture.directory, lockTimeoutMs: 0 });
  await assert.rejects(lockStore.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 }), StateLockError);
  assert.equal((await fs.lstat(`${fixture.statePath}.lock`)).isSymbolicLink(), true);
});

test('strict parser rejects malformed JSON, unknown fields, invalid enums, and partial transitions', async () => {
  const initial = createInitialState(NOW);
  assert.throws(() => parseState('{not-json'), StateValidationError);
  assert.throws(() => parseState({ ...initial, secret: 'do-not-persist' }), StateValidationError);
  assert.throws(() => parseState({ ...initial, phase: 'UNKNOWN' }), StateValidationError);
  assert.throws(() => parseState({ ...initial, currentDnsRole: '198.51.100.1' }), StateValidationError);
  assert.throws(() => parseState({ ...initial, phase: PHASES.VERIFYING }), StateValidationError);
  assert.throws(() => parseState({
    ...initial,
    generation: 1,
    phase: PHASES.VERIFYING,
    currentEventFingerprint: fingerprint('c'),
    pendingIncident: {
      eventFingerprint: fingerprint('c'),
      startedAt: NOW,
      generation: 0,
    },
  }), StateValidationError);
  assert.throws(() => parseState({
    ...initial,
    phase: PHASES.BLOCKED,
  }), StateValidationError);
});

test('state file symlinks, unsafe modes, and production ownership are rejected', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await writeFile(path.join(fixture.directory, 'target.json'), '{}', { mode: 0o600 });
  await symlink('target.json', fixture.statePath);
  await assert.rejects(fixture.store.read(), (error) => error instanceof StateOwnershipError);

  await fs.unlink(fixture.statePath);
  await fixture.store.create();
  await fs.chmod(fixture.statePath, 0o644);
  await assert.rejects(fixture.store.read(), (error) => error instanceof StateOwnershipError);

  const productionStore = createStateStore({
    statePath: fixture.statePath,
    parentDir: fixture.directory,
    productionMode: true,
    now: () => NOW,
  });
  await assert.rejects(productionStore.read(), (error) => error instanceof StateOwnershipError);
});

test('path validation requires an absolute state path directly under the fixed parent', async () => {
  assert.throws(
    () => createStateStore({ statePath: 'relative.json', parentDir: '/tmp' }),
    StatePathError,
  );
  assert.throws(
    () => createStateStore({ statePath: 'relative.json' }),
    StatePathError,
  );
  assert.throws(
    () => createStateStore({ statePath: '/tmp/state.json', parentDir: '/tmp/other' }),
    StatePathError,
  );
});

test('secret-shaped fields and mutable metadata cannot be persisted', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();

  await assert.rejects(
    fixture.store.update({
      expectedGeneration: 0,
      patch: { token: 'secret-token' },
      at: NOW + 1,
    }),
    (error) => error instanceof StateValidationError,
  );
  await assert.rejects(
    fixture.store.update({
      expectedGeneration: 0,
      patch: { terminalReason: 'https://example.invalid/token' },
      at: NOW + 1,
    }),
    (error) => error instanceof StateValidationError,
  );
  assert.throws(() => parseState({
    ...createInitialState(NOW),
    terminalReason: '198.51.100.10',
  }), StateValidationError);
  assert.throws(() => parseState({
    ...createInitialState(NOW),
    currentDnsRole: 'https://aws.example.invalid',
  }), StateValidationError);
  assert.equal((await fixture.store.read()).generation, 0);
});

test('concurrent conditional updates serialize and reject the stale writer', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();

  const updates = await Promise.allSettled([
    fixture.store.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 1 }),
    fixture.store.update({ expectedGeneration: 0, patch: { armed: true }, at: NOW + 2 }),
  ]);
  assert.equal(updates.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(updates.filter((result) => result.status === 'rejected').length, 1);
  const rejection = updates.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason instanceof StaleGenerationError, true);
  assert.equal((await fixture.store.read()).generation, 1);
});

test('explicit phase transition to BLOCKED requires a safe terminal reason', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture.directory));
  await fixture.store.create();

  const blocked = await fixture.store.update({
    expectedGeneration: 0,
    expectedPhase: PHASES.AWS_ACTIVE,
    patch: {
      phase: PHASES.BLOCKED,
      terminalReason: 'aws_readiness_failed',
    },
    at: NOW + 1,
  });
  assert.equal(blocked.phase, PHASES.BLOCKED);
  assert.equal(blocked.currentDnsRole, DNS_ROLES.AWS);
  assert.equal(blocked.terminalReason, 'aws_readiness_failed');
});
