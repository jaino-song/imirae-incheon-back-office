import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_OPERATOR_PATH,
  FALLBACK_STATUS_ERROR_CODES,
  FallbackStatusError,
  getFallbackStatus,
  parseFallbackStatus,
} from './fallback-status.mjs';

const IMAGE_TAG = 'a'.repeat(40);
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;

function output(overrides = {}) {
  const fields = {
    environment: 'fallback-server',
    current_tag: IMAGE_TAG,
    current_digest: IMAGE_DIGEST,
    container_health: 'healthy',
    restart_count: '0',
    db_readiness: 'ok',
    production_db_identity: 'ok',
    public_routing: 'not_managed',
    schedulers_enabled: 'false',
    document_jobs_accepting: 'false',
    document_jobs_worker: 'false',
    ...overrides,
  };
  return `${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function parseWithExpected(overrides = {}) {
  return parseFallbackStatus(output(overrides), {
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
  });
}

test('parseFallbackStatus accepts only the exact safe healthy envelope', () => {
  const status = parseFallbackStatus(output(), {
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
  });
  assert.deepEqual(status, {
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
  });
});

test('getFallbackStatus invokes only the fixed executable and status argument', async () => {
  const calls = [];
  const status = await getFallbackStatus({
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
    runner: async (...args) => {
      calls.push(args);
      return { stdout: output(), stderr: '' };
    },
  });
  assert.equal(status.releaseHealthy, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], FALLBACK_OPERATOR_PATH);
  assert.deepEqual(calls[0][1], ['status']);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].maxBuffer > 0, true);
});

test('getFallbackStatus also supports an injected execFile-style callback runner', async () => {
  const status = await getFallbackStatus({
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
    runner(file, args, options, callback) {
      assert.equal(file, FALLBACK_OPERATOR_PATH);
      assert.deepEqual(args, ['status']);
      assert.equal(options.shell, false);
      callback(null, output(), '');
    },
  });
  assert.equal(status.environment, 'fallback-server');
});

test('getFallbackStatus accepts provider stdout buffers without exposing them', async () => {
  const status = await getFallbackStatus({
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
    runner: async () => ({ stdout: Buffer.from(output()), stderr: Buffer.alloc(0) }),
  });
  assert.equal(status.releaseHealthy, true);
});

test('release identity mismatch returns an unhealthy result without exposing image values', () => {
  const status = parseFallbackStatus(output(), {
    expectedImageTag: 'c'.repeat(40),
    expectedImageDigest: `sha256:${'d'.repeat(64)}`,
  });
  assert.equal(status.releaseHealthy, false);
  assert.equal(JSON.stringify(status).includes(IMAGE_TAG), false);
  assert.equal(JSON.stringify(status).includes(IMAGE_DIGEST), false);
});

test('release identity expectations are required for every status read', async () => {
  assert.throws(
    () => parseFallbackStatus(output()),
    (error) => error instanceof FallbackStatusError,
  );
  await assert.rejects(
    getFallbackStatus({
      runner: async () => ({ stdout: output(), stderr: '' }),
    }),
    (error) => error instanceof FallbackStatusError,
  );
  assert.throws(
    () => parseFallbackStatus(output(), { expectedImageTag: IMAGE_TAG }),
    (error) => error instanceof FallbackStatusError,
  );
  assert.throws(
    () => parseFallbackStatus(output(), { expectedImageDigest: IMAGE_DIGEST }),
    (error) => error instanceof FallbackStatusError,
  );
});

test('parser rejects missing, duplicate, unknown, malformed, or unsafe status fields', () => {
  assert.throws(() => parseFallbackStatus(''), (error) => error instanceof FallbackStatusError);
  assert.throws(() => parseWithExpected({ unknown: 'value' }), FallbackStatusError);
  assert.throws(() => parseFallbackStatus(`${output()}environment=fallback-server\n`, {
    expectedImageTag: IMAGE_TAG,
    expectedImageDigest: IMAGE_DIGEST,
  }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ environment: 'covenant-server' }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ restart_count: '1' }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ schedulers_enabled: 'true' }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ current_tag: 'not-a-commit' }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ current_digest: 'https://secret.invalid' }), FallbackStatusError);
});

test('parser enforces bounded output and rejects raw multiline or credential-shaped values', () => {
  assert.throws(
    () => parseFallbackStatus(`${output()}${'x'.repeat(20_000)}`, {
      expectedImageTag: IMAGE_TAG,
      expectedImageDigest: IMAGE_DIGEST,
    }),
    (error) => error.code === FALLBACK_STATUS_ERROR_CODES.OUTPUT_TOO_LARGE,
  );
  assert.throws(() => parseWithExpected({ db_readiness: 'ok\npassword=secret' }), FallbackStatusError);
  assert.throws(() => parseWithExpected({ public_routing: 'https://secret.invalid' }), FallbackStatusError);
});

test('command failures and stderr are sanitized', async () => {
  await assert.rejects(
    getFallbackStatus({
      expectedImageTag: IMAGE_TAG,
      expectedImageDigest: IMAGE_DIGEST,
      runner: async () => {
        throw new Error('password=secret https://private.invalid');
      },
    }),
    (error) => {
      assert.equal(error.code, FALLBACK_STATUS_ERROR_CODES.COMMAND_FAILED);
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
  await assert.rejects(
    getFallbackStatus({
      expectedImageTag: IMAGE_TAG,
      expectedImageDigest: IMAGE_DIGEST,
      runner: async () => ({ stdout: output(), stderr: 'secret stderr' }),
    }),
    (error) => error.code === FALLBACK_STATUS_ERROR_CODES.COMMAND_FAILED,
  );
});
