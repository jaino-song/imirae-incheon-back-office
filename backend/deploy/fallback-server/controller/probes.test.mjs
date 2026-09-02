import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_URL,
  PROBE_MAX_BODY_BYTES,
  PROBE_REASONS,
  PROBE_STATUS,
  PROBE_TIMEOUT_MS,
  VERIFICATION_DECISION,
  VERIFICATION_REASONS,
  parseHealthConfig,
  probeReadiness,
  verifyBoundedHealth,
} from './probes.mjs';

const PRIMARY_URL = 'https://api.babyjamjam.com/health/ready';

function response(body, { status = 200, contentType = 'application/json', redirected = false } = {}) {
  return {
    status,
    redirected,
    headers: { get: (name) => (name === 'content-type' ? contentType : null) },
    body: null,
    text: async () => body,
  };
}

function streamingResponse(chunks, options = {}) {
  let index = 0;
  return {
    ...response('', options),
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = chunks[index];
          index += 1;
          return { done: false, value };
        },
        cancel: async () => {},
      }),
    },
  };
}

test('parseHealthConfig accepts only the primary API and exact loopback fallback URLs', () => {
  assert.deepEqual(parseHealthConfig({
    primaryReadinessUrl: PRIMARY_URL,
    fallbackReadinessUrl: FALLBACK_URL,
  }), {
    primaryReadinessUrl: PRIMARY_URL,
    fallbackReadinessUrl: FALLBACK_URL,
  });
});

test('parseHealthConfig rejects missing, unknown, credentialed, decorated, and SSRF URLs', () => {
  const cases = [
    {},
    { primaryReadinessUrl: PRIMARY_URL },
    { fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'http://api.babyjamjam.com/health/ready', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://user:pass@api.babyjamjam.com/health/ready', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://api.babyjamjam.com/health/ready?x=1', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://api.babyjamjam.com/health/ready#fragment', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://169.254.169.254/health/ready', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://attacker.example/health/ready', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: 'https://api.babyjamjam.com:8443/health/ready', fallbackReadinessUrl: FALLBACK_URL },
    { primaryReadinessUrl: PRIMARY_URL, fallbackReadinessUrl: 'https://127.0.0.1:3101/health/ready' },
    { primaryReadinessUrl: PRIMARY_URL, fallbackReadinessUrl: 'http://127.0.0.1:3101/health/ready?x=1' },
    { primaryReadinessUrl: PRIMARY_URL, fallbackReadinessUrl: 'http://localhost:3101/health/ready' },
    { primaryReadinessUrl: PRIMARY_URL, fallbackReadinessUrl: 'http://127.0.0.1:3001/health/ready' },
    { primaryReadinessUrl: PRIMARY_URL, fallbackReadinessUrl: FALLBACK_URL, unexpected: 'value' },
  ];
  for (const input of cases) {
    assert.throws(() => parseHealthConfig(input), (error) => {
      assert.equal(error.message, PROBE_REASONS.CONFIG_INVALID);
      assert.equal(JSON.stringify(error).includes('attacker'), false);
      return true;
    });
  }
});

test('probeReadiness sends a GET with redirect:error and cache:no-store and accepts exact JSON status', async () => {
  let request;
  const result = await probeReadiness(PRIMARY_URL, {
    fetch: async (url, options) => {
      request = { url, options };
      return response('{"status":"ok"}');
    },
  });
  assert.deepEqual(result, { status: PROBE_STATUS.OK, statusCode: 200 });
  assert.equal(request.url, PRIMARY_URL);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.cache, 'no-store');
  assert.deepEqual(request.options.headers, { accept: 'application/json' });
});

test('probeReadiness rejects non-200, redirects, non-JSON, malformed, and non-exact bodies', async () => {
  const scenarios = [
    [response('{"status":"ok"}', { status: 204 }), PROBE_STATUS.FAILED, PROBE_REASONS.HTTP_STATUS_NOT_OK],
    [response('', { status: 302, contentType: 'text/html' }), PROBE_STATUS.BLOCKED, PROBE_REASONS.REDIRECT_REJECTED],
    [response('{"status":"ok"}', { redirected: true }), PROBE_STATUS.BLOCKED, PROBE_REASONS.REDIRECT_REJECTED],
    [response('{"status":"ok"}', { contentType: 'text/html' }), PROBE_STATUS.BLOCKED, PROBE_REASONS.CONTENT_TYPE_NOT_JSON],
    [response('not-json'), PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_MALFORMED],
    [response('{"status":"degraded"}'), PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_NOT_EXACT],
    [response('{"status":"ok","detail":"extra"}'), PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_NOT_EXACT],
    [response('[]'), PROBE_STATUS.BLOCKED, PROBE_REASONS.BODY_NOT_EXACT],
  ];
  for (const [bodyResponse, status, reason] of scenarios) {
    const result = await probeReadiness(PRIMARY_URL, { fetch: async () => bodyResponse });
    assert.equal(result.status, status);
    assert.equal(result.reason, reason);
  }
});

test('probeReadiness bounds streamed and text bodies', async () => {
  const oversized = new Uint8Array(PROBE_MAX_BODY_BYTES + 1);
  const streamResult = await probeReadiness(PRIMARY_URL, {
    fetch: async () => streamingResponse([oversized]),
  });
  assert.deepEqual(streamResult, {
    status: PROBE_STATUS.BLOCKED,
    reason: PROBE_REASONS.BODY_TOO_LARGE,
    statusCode: 200,
  });

  const textResult = await probeReadiness(PRIMARY_URL, {
    fetch: async () => response('x'.repeat(PROBE_MAX_BODY_BYTES + 1)),
  });
  assert.equal(textResult.reason, PROBE_REASONS.BODY_TOO_LARGE);
});

test('probeReadiness handles timeout, external abort, invalid timeout, network errors, and never leaks details', async () => {
  const timeoutResult = await probeReadiness(PRIMARY_URL, {
    timeoutMs: 5,
    fetch: async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('secret body'), { name: 'AbortError' })), { once: true });
    }),
  });
  assert.deepEqual(timeoutResult, { status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.TIMEOUT });

  const controller = new AbortController();
  controller.abort();
  const abortedResult = await probeReadiness(PRIMARY_URL, { signal: controller.signal, fetch: async () => response('{"status":"ok"}') });
  assert.deepEqual(abortedResult, { status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.ABORTED });

  const invalidTimeout = await probeReadiness(PRIMARY_URL, { timeoutMs: PROBE_TIMEOUT_MS + 1, fetch: async () => response('{"status":"ok"}') });
  assert.deepEqual(invalidTimeout, { status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.CONFIG_INVALID });

  const failedResult = await probeReadiness(PRIMARY_URL, { fetch: async () => { throw new Error('secret URL/body'); } });
  assert.deepEqual(failedResult, { status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED });
  assert.equal(JSON.stringify(failedResult).includes('secret'), false);

  const ssrfResult = await probeReadiness('https://169.254.169.254/latest/meta-data', { fetch: async () => response('{"status":"ok"}') });
  assert.deepEqual(ssrfResult, { status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.CONFIG_INVALID });
});

test('verifyBoundedHealth requires exactly three primary failures and three fallback successes', async () => {
  const calls = { primary: 0, fallback: 0, sleeps: 0 };
  const result = await verifyBoundedHealth({
    intervalMs: 0,
    sleep: async () => { calls.sleeps += 1; },
    probePrimary: async () => { calls.primary += 1; return { status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }; },
    probeFallback: async () => { calls.fallback += 1; return { status: PROBE_STATUS.OK, statusCode: 200 }; },
  });
  assert.deepEqual(result, {
    decision: VERIFICATION_DECISION.ELIGIBLE,
    reason: null,
    primaryFailures: 3,
    fallbackSuccesses: 3,
  });
  assert.deepEqual(calls, { primary: 3, fallback: 3, sleeps: 0 });
});

test('verifyBoundedHealth can build its probes from the strict URL config', async () => {
  const requested = [];
  const result = await verifyBoundedHealth({
    primaryReadinessUrl: PRIMARY_URL,
    fallbackReadinessUrl: FALLBACK_URL,
    intervalMs: 0,
    fetch: async (url) => {
      requested.push(url);
      return requested.length <= 3
        ? response('{"status":"down"}', { status: 503 })
        : response('{"status":"ok"}');
    },
  });
  assert.equal(result.decision, VERIFICATION_DECISION.ELIGIBLE);
  assert.equal(requested.length, 6);
  assert.deepEqual([...new Set(requested)], [PRIMARY_URL, FALLBACK_URL]);
});

test('verifyBoundedHealth blocks when primary recovers or a probe is malformed/blocked', async () => {
  const primaryRecovers = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async ({ attempt }) => ({ status: attempt === 0 ? PROBE_STATUS.OK : PROBE_STATUS.FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(primaryRecovers.reason, VERIFICATION_REASONS.PRIMARY_NOT_FAILED);

  const primaryMalformed = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async () => ({ body: 'secret' }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(primaryMalformed.reason, VERIFICATION_REASONS.PRIMARY_PROBE_MALFORMED);
  assert.equal(JSON.stringify(primaryMalformed).includes('secret'), false);

  const primaryBlocked = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async () => ({ status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.TIMEOUT }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(primaryBlocked.reason, VERIFICATION_REASONS.PRIMARY_PROBE_BLOCKED);
});

test('verifyBoundedHealth blocks fallback failure and both-down conditions', async () => {
  const fallbackBlocked = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.BLOCKED, reason: PROBE_REASONS.BODY_MALFORMED }),
  });
  assert.equal(fallbackBlocked.reason, VERIFICATION_REASONS.FALLBACK_PROBE_BLOCKED);

  const fallbackMalformed = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({}),
  });
  assert.equal(fallbackMalformed.reason, VERIFICATION_REASONS.FALLBACK_PROBE_MALFORMED);

  const bothDown = await verifyBoundedHealth({
    intervalMs: 0,
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
  });
  assert.equal(bothDown.reason, VERIFICATION_REASONS.BOTH_ORIGINS_DOWN);
  assert.equal(bothDown.primaryFailures, 3);
  assert.equal(bothDown.fallbackSuccesses, 0);
});

test('verifyBoundedHealth honors injectable sleep/clock, abort, and deadline', async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = await verifyBoundedHealth({
    signal: controller.signal,
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(aborted.reason, VERIFICATION_REASONS.VERIFICATION_ABORTED);

  let now = 0;
  const deadline = await verifyBoundedHealth({
    intervalMs: 0,
    maxDurationMs: 10,
    clock: () => { now += 6; return now; },
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(deadline.reason, VERIFICATION_REASONS.VERIFICATION_DEADLINE_EXCEEDED);

  const sleepFailure = await verifyBoundedHealth({
    intervalMs: 1,
    sleep: async () => { throw new Error('secret sleep'); },
    probePrimary: async () => ({ status: PROBE_STATUS.FAILED, reason: PROBE_REASONS.REQUEST_FAILED }),
    probeFallback: async () => ({ status: PROBE_STATUS.OK }),
  });
  assert.equal(sleepFailure.reason, VERIFICATION_REASONS.VERIFICATION_SLEEP_FAILED);
  assert.equal(JSON.stringify(sleepFailure).includes('secret'), false);
});
