import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONTROLLER_MANIFEST_ENTRIES,
  ControllerOperatorError,
  OPERATOR_REASONS,
  createOperator,
  validateBundle,
} from './operator.mjs';

const PRIMARY_IP = '8.8.8.8';
const FALLBACK_IP = '1.1.1.1';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function state({ phase = 'AWS_ACTIVE', armed = false, currentDnsRole = 'AWS' } = {}) {
  return {
    schemaVersion: 1,
    generation: 0,
    phase,
    armed,
    currentDnsRole,
    currentEventFingerprint: null,
    lastEventFingerprint: null,
    pendingIncident: null,
    terminalReason: null,
    replayFingerprints: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function healthyFallbackStatus(overrides = {}) {
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

function enabledConfig() {
  return {
    enabled: true,
    liveSentryPayloadContractVerified: true,
    primaryIpv4: PRIMARY_IP,
    fallbackIpv4: FALLBACK_IP,
    vercelApiToken: 'token',
    vercelTeamId: 'team_test',
    vercelDnsRecordId: 'rec_test',
    expectedImageTag: 'a'.repeat(40),
    expectedImageDigest: `sha256:${'b'.repeat(64)}`,
  };
}

async function makeOperator({ currentState = state(), envText = 'FAILOVER_CONTROLLER_ENABLED=false\n', config = { enabled: false }, fallbackStatus = healthyFallbackStatus(), dnsRecord = { value: PRIMARY_IP }, uid = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyjamjam-controller-operator-'));
  const envPath = path.join(root, 'controller.env');
  await fs.writeFile(envPath, envText, { mode: 0o600 });
  const calls = {
    updates: [],
    fallbackStatus: 0,
    expectedImageTag: undefined,
    expectedImageDigest: undefined,
    dns: 0,
  };
  let stored = clone(currentState);
  const store = {
    async read() { return clone(stored); },
    async create({ armed = false, at = 1 } = {}) {
      if (!stored) stored = state({ armed });
      stored.updatedAt = at;
      return clone(stored);
    },
    async update(options) {
      calls.updates.push(options);
      stored = { ...stored, ...clone(options.patch), generation: stored.generation + 1, updatedAt: options.at };
      return clone(stored);
    },
  };
  const operator = createOperator({
    testMode: true,
    envPath,
    statePath: path.join(root, 'state.json'),
    bundleValidator: async () => {},
    stateStore: store,
    parseConfig: () => config,
    fallbackStatusReader: async ({ expectedImageTag, expectedImageDigest }) => {
      calls.fallbackStatus += 1;
      calls.expectedImageTag = expectedImageTag;
      calls.expectedImageDigest = expectedImageDigest;
      return clone(fallbackStatus);
    },
    readCurrentDns: async () => {
      calls.dns += 1;
      return clone(dnsRecord);
    },
    uid: () => uid,
    clock: () => 2,
  });
  return {
    operator,
    calls,
    store,
    root,
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function expectReason(operation, reason) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ControllerOperatorError);
    assert.equal(error.code, reason);
    assert.doesNotMatch(error.message, /token|8\.8\.8\.8|1\.1\.1\.1|secret/i);
    return true;
  });
}

test('status is secret-free, reports a missing env safely, and validates the bundle first', async () => {
  const fixture = await makeOperator({ currentState: state(), config: { enabled: false } });
  try {
    const lines = await fixture.operator.status();
    assert.deepEqual(lines, [
      'controller_bundle=ok',
      'controller_env=ok',
      'controller_enabled=false',
      'state_phase=AWS_ACTIVE',
      'armed=false',
      'current_dns_role=AWS',
    ]);
    assert.equal(JSON.stringify(lines).includes('token'), false);
  } finally {
    await fixture.cleanup();
  }

  const missing = await makeOperator({ config: { enabled: false } });
  await fs.rm(path.join(missing.root, 'controller.env'), { force: true });
  try {
    const lines = await missing.operator.status();
    assert.equal(lines[1], 'controller_env=missing');
    assert.equal(lines[2], 'controller_enabled=false');
  } finally {
    await missing.cleanup();
  }
});

test('arm requires enabled/live configuration, healthy fallback status, primary DNS, and clean AWS_ACTIVE state', async () => {
  const fixture = await makeOperator({ config: enabledConfig() });
  try {
    const lines = await fixture.operator.arm();
    assert.equal(lines[0], 'controller_bundle=ok');
    assert.equal(lines.includes('armed=true'), true);
    assert.equal(lines.includes('production_db_identity=ok'), true);
    assert.equal(lines.includes('fallback_release=healthy'), true);
    assert.equal(lines.includes('fallback_passive_gates=healthy'), true);
    assert.equal(lines.includes('dns_target=PRIMARY'), true);
    assert.equal(fixture.calls.fallbackStatus, 1);
    assert.equal(fixture.calls.expectedImageTag, 'a'.repeat(40));
    assert.equal(fixture.calls.expectedImageDigest, `sha256:${'b'.repeat(64)}`);
    assert.equal(fixture.calls.dns, 1);
    assert.deepEqual(fixture.calls.updates[0].patch, { armed: true });
    assert.equal(fixture.calls.updates[0].expectedPhase, 'AWS_ACTIVE');
  } finally {
    await fixture.cleanup();
  }
});

test('arm refuses missing or malformed expected production release identity', async () => {
  for (const config of [
    { ...enabledConfig(), expectedImageTag: undefined },
    { ...enabledConfig(), expectedImageDigest: undefined },
    { ...enabledConfig(), expectedImageTag: 'not-a-commit' },
    { ...enabledConfig(), expectedImageDigest: 'sha256:not-a-digest' },
  ]) {
    const fixture = await makeOperator({ config });
    try {
      await expectReason(fixture.operator.arm(), OPERATOR_REASONS.CONFIG_NOT_ARMABLE);
      assert.equal(fixture.calls.fallbackStatus, 0);
      assert.equal(fixture.calls.dns, 0);
    } finally {
      await fixture.cleanup();
    }
  }
});

test('arm refuses a fallback status whose release identity is not healthy', async () => {
  const fixture = await makeOperator({
    config: enabledConfig(),
    fallbackStatus: healthyFallbackStatus({ releaseHealthy: false }),
  });
  try {
    await expectReason(fixture.operator.arm(), OPERATOR_REASONS.FALLBACK_STATUS_INVALID);
    assert.equal(fixture.calls.fallbackStatus, 1);
    assert.equal(fixture.calls.dns, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('arm fails closed for incomplete configuration, fallback drift, and DNS drift', async () => {
  const disabled = await makeOperator({ config: { enabled: false } });
  try {
    await expectReason(disabled.operator.arm(), OPERATOR_REASONS.CONFIG_NOT_ARMABLE);
  } finally {
    await disabled.cleanup();
  }

  const unhealthy = await makeOperator({ config: enabledConfig(), fallbackStatus: healthyFallbackStatus({ productionDbIdentityCertified: false }) });
  try {
    await expectReason(unhealthy.operator.arm(), OPERATOR_REASONS.FALLBACK_STATUS_INVALID);
    assert.equal(unhealthy.calls.dns, 0);
  } finally {
    await unhealthy.cleanup();
  }

  const drift = await makeOperator({ config: enabledConfig(), dnsRecord: { value: FALLBACK_IP } });
  try {
    await expectReason(drift.operator.arm(), OPERATOR_REASONS.DNS_NOT_PRIMARY);
  } finally {
    await drift.cleanup();
  }
});

test('arm refuses already armed, non-AWS, pending, and terminal states', async () => {
  for (const currentState of [
    state({ armed: true }),
    state({ phase: 'FALLBACK_ACTIVE', currentDnsRole: 'FALLBACK' }),
    { ...state(), pendingIncident: { eventFingerprint: 'a'.repeat(64), startedAt: 1, generation: 0 } },
    { ...state(), terminalReason: 'dns_drift' },
  ]) {
    const fixture = await makeOperator({ config: enabledConfig(), currentState });
    try {
      await expectReason(
        fixture.operator.arm(),
        currentState.armed ? OPERATOR_REASONS.ALREADY_ARMED : OPERATOR_REASONS.STATE_NOT_AWS_ACTIVE,
      );
      assert.equal(fixture.calls.dns, 0);
    } finally {
      await fixture.cleanup();
    }
  }
});

test('disarm is atomic, idempotent, and never performs failback or DNS mutation', async () => {
  const fixture = await makeOperator({
    config: { enabled: false },
    currentState: state({ phase: 'FALLBACK_ACTIVE', armed: true, currentDnsRole: 'FALLBACK' }),
  });
  try {
    const lines = await fixture.operator.disarm();
    assert.equal(lines.includes('armed=false'), true);
    assert.equal(lines.includes('automatic_failback=disabled'), true);
    assert.equal(fixture.calls.dns, 0);
    assert.deepEqual(fixture.calls.updates[0].patch, { armed: false });
  } finally {
    await fixture.cleanup();
  }

  const idempotent = await makeOperator({ config: { enabled: false }, currentState: state({ armed: false }) });
  try {
    await idempotent.operator.disarm();
    assert.equal(idempotent.calls.updates.length, 0);
    assert.equal(idempotent.calls.dns, 0);
  } finally {
    await idempotent.cleanup();
  }
});

test('CLI rejects arbitrary arguments and non-root callers', async () => {
  const fixture = await makeOperator({ uid: 1000 });
  try {
    await expectReason(fixture.operator.run(['shell']), OPERATOR_REASONS.INVALID_ARGUMENTS);
    await expectReason(fixture.operator.run(['status']), OPERATOR_REASONS.ROOT_REQUIRED);
  } finally {
    await fixture.cleanup();
  }
});

test('controller environment parsing rejects non-FAILOVER keys and duplicate assignments', async () => {
  for (const envText of [
    'NODE_ENV=production\n',
    'FAILOVER_CONTROLLER_ENABLED=false\nFAILOVER_CONTROLLER_ENABLED=true\n',
    'FAILOVER_CONTROLLER_ENABLED="unterminated\n',
  ]) {
    const fixture = await makeOperator({ envText, config: { enabled: false } });
    try {
      await expectReason(fixture.operator.status(), OPERATOR_REASONS.ENV_INVALID);
    } finally {
      await fixture.cleanup();
    }
  }
});

test('validateBundle rejects a missing or malformed fixed bundle without revealing paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyjamjam-controller-bundle-'));
  try {
    await fs.chmod(root, 0o700);
    await assert.rejects(
      validateBundle({ bundleRoot: root, cliPath: path.join(root, 'cli'), unitPath: path.join(root, 'unit'), requireRoot: false }),
      (error) => {
        assert.ok(error instanceof ControllerOperatorError);
        assert.equal(error.code, OPERATOR_REASONS.BUNDLE_INVALID);
        assert.equal(error.message.includes(root), false);
        return true;
      },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.ok(CONTROLLER_MANIFEST_ENTRIES.includes('main.mjs'));
});
