import { execFile as nodeExecFile } from 'node:child_process';

export const FALLBACK_OPERATOR_PATH = '/usr/local/sbin/babyjamjam-fallback-server';
export const FALLBACK_STATUS_COMMAND = FALLBACK_OPERATOR_PATH;
export const FALLBACK_STATUS_ARGS = Object.freeze(['status']);
export const FALLBACK_STATUS_MAX_BYTES = 16 * 1024;
export const FALLBACK_STATUS_TIMEOUT_MS = 5_000;

export const FALLBACK_STATUS_ERROR_CODES = Object.freeze({
  INVALID_OUTPUT: 'FALLBACK_STATUS_INVALID',
  OUTPUT_TOO_LARGE: 'FALLBACK_STATUS_TOO_LARGE',
  COMMAND_FAILED: 'FALLBACK_STATUS_COMMAND_FAILED',
});

const STATUS_KEYS = Object.freeze([
  'environment',
  'current_tag',
  'current_digest',
  'container_health',
  'restart_count',
  'db_readiness',
  'production_db_identity',
  'public_routing',
  'schedulers_enabled',
  'document_jobs_accepting',
  'document_jobs_worker',
]);

const STATUS_KEY_SET = new Set(STATUS_KEYS);
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_VALUE_PATTERN = /^[a-z0-9_.:-]{1,128}$/;

export class FallbackStatusError extends Error {
  constructor(code = FALLBACK_STATUS_ERROR_CODES.INVALID_OUTPUT) {
    super(code);
    this.name = 'FallbackStatusError';
    this.code = code;
    this.blocked = true;
  }
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function fail(code = FALLBACK_STATUS_ERROR_CODES.INVALID_OUTPUT) {
  throw new FallbackStatusError(code);
}

function parseOutputLines(output) {
  if (Buffer.isBuffer(output)) output = output.toString('utf8');
  if (typeof output !== 'string') fail();
  if (byteLength(output) > FALLBACK_STATUS_MAX_BYTES) {
    fail(FALLBACK_STATUS_ERROR_CODES.OUTPUT_TOO_LARGE);
  }
  const lines = output.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) fail();

  const values = Object.create(null);
  for (const line of lines) {
    if (line.length === 0 || line.includes('\r')) fail();
    const separator = line.indexOf('=');
    if (separator <= 0 || separator === line.length - 1) fail();
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!STATUS_KEY_SET.has(key) || Object.prototype.hasOwnProperty.call(values, key)) fail();
    if (!SAFE_VALUE_PATTERN.test(value)) fail();
    values[key] = value;
  }

  if (Object.keys(values).length !== STATUS_KEYS.length) fail();
  for (const key of STATUS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) fail();
  }
  return values;
}

function parseNonNegativeInteger(value) {
  if (!/^\d{1,9}$/.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail();
  return parsed;
}

function compareExpectedRelease(values, expectedImageTag, expectedImageDigest) {
  if (typeof expectedImageTag !== 'string' || !GIT_SHA_PATTERN.test(expectedImageTag)) fail();
  if (typeof expectedImageDigest !== 'string' || !IMAGE_DIGEST_PATTERN.test(expectedImageDigest)) fail();
  return values.current_tag === expectedImageTag && values.current_digest === expectedImageDigest;
}

/**
 * Parse the fixed, secret-free output emitted by the Fallback Server operator.
 * Only the allowlisted keys are read; raw image identities never leave this
 * function.
 */
export function parseFallbackStatus(output, {
  expectedImageTag,
  expectedImageDigest,
} = {}) {
  const values = parseOutputLines(output);
  if (values.environment !== 'fallback-server') fail();
  if (!GIT_SHA_PATTERN.test(values.current_tag) || !IMAGE_DIGEST_PATTERN.test(values.current_digest)) fail();
  if (values.container_health !== 'healthy') fail();
  if (parseNonNegativeInteger(values.restart_count) !== 0) fail();
  if (values.db_readiness !== 'ok') fail();
  if (values.production_db_identity !== 'ok') fail();
  if (values.public_routing !== 'not_managed') fail();
  if (values.schedulers_enabled !== 'false') fail();
  if (values.document_jobs_accepting !== 'false') fail();
  if (values.document_jobs_worker !== 'false') fail();

  const releaseHealthy = compareExpectedRelease(values, expectedImageTag, expectedImageDigest);
  return Object.freeze({
    environment: 'fallback-server',
    releaseHealthy,
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
}

function runExecFile(file, args, options) {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function invokeRunner(runner, file, args, options) {
  if (runner.length >= 4) {
    return new Promise((resolve, reject) => {
      runner(file, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }
  return runner(file, args, options);
}

function normalizeRunnerResult(result) {
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return { stdout: result, stderr: '' };
  }
  if (Array.isArray(result)) {
    return { stdout: result[0], stderr: result[1] };
  }
  if (result && typeof result === 'object') {
    return { stdout: result.stdout, stderr: result.stderr };
  }
  return { stdout: undefined, stderr: undefined };
}

/**
 * Execute exactly the fixed Fallback Server status command. Callers may inject
 * a runner for tests, but cannot supply another executable or argument list.
 */
export async function getFallbackStatus({
  runner = runExecFile,
  timeoutMs = FALLBACK_STATUS_TIMEOUT_MS,
  expectedImageTag,
  expectedImageDigest,
} = {}) {
  if (typeof runner !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new FallbackStatusError(FALLBACK_STATUS_ERROR_CODES.INVALID_OUTPUT);
  }
  let result;
  try {
    result = await invokeRunner(runner, FALLBACK_OPERATOR_PATH, [...FALLBACK_STATUS_ARGS], {
      shell: false,
      timeout: timeoutMs,
      maxBuffer: FALLBACK_STATUS_MAX_BYTES,
      windowsHide: true,
    });
  } catch {
    throw new FallbackStatusError(FALLBACK_STATUS_ERROR_CODES.COMMAND_FAILED);
  }
  let { stdout, stderr } = normalizeRunnerResult(result);
  if (Buffer.isBuffer(stderr)) stderr = stderr.toString('utf8');
  if (typeof stderr !== 'undefined' && stderr !== '') {
    throw new FallbackStatusError(FALLBACK_STATUS_ERROR_CODES.COMMAND_FAILED);
  }
  return parseFallbackStatus(stdout, { expectedImageTag, expectedImageDigest });
}

export const readFallbackStatus = getFallbackStatus;
export const runFallbackStatus = getFallbackStatus;
export const parseStatus = parseFallbackStatus;
