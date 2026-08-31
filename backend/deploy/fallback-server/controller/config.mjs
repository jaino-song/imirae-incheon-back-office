import { DEFAULT_STATE_PATH } from './state-store.mjs';
import { validateSecurityConfig } from './security.mjs';

export { DEFAULT_STATE_PATH };

export const CONTROLLER_BIND_HOST = '127.0.0.1';
export const CONTROLLER_PORT = 3102;
export const WEBHOOK_PATH = '/sentry/uptime-alert';
export const HEALTH_PATH = '/health';
export const REQUEST_TIMEOUT_MS = 5_000;
export const HEADERS_TIMEOUT_MS = 5_000;
export const KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const MAX_CONNECTIONS = 32;

const PRIMARY_HEALTH_URL = 'https://api.babyjamjam.com/health/ready';
const FALLBACK_HEALTH_URL = 'http://127.0.0.1:3101/health/ready';
const MAX_SECRET_LENGTH = 4_096;
const MAX_ENV_VALUE_LENGTH = 8_192;
const SAFE_VALUE_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;
const TEAM_ID_PATTERN = /^team_[A-Za-z0-9_-]+$/u;
const RECORD_ID_PATTERN = /^rec_[A-Za-z0-9_-]+$/u;
const NUMERIC_ID_PATTERN = /^\d+$/u;
const IPV4_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u;
const IMAGE_TAG_PATTERN = /^[0-9a-f]{40}$/u;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const CONFIG_KEYS = new Set([
  'FAILOVER_CONTROLLER_ENABLED',
  'FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED',
  'FAILOVER_SENTRY_CLIENT_SECRET',
  'FAILOVER_SENTRY_INSTALLATION_ID',
  'FAILOVER_SENTRY_ORGANIZATION_ID',
  'FAILOVER_SENTRY_PROJECT_ID',
  'FAILOVER_SENTRY_ALERT_ID',
  'FAILOVER_SENTRY_MONITOR_ID',
  'FAILOVER_PRIMARY_HEALTH_URL',
  'FAILOVER_FALLBACK_HEALTH_URL',
  'FAILOVER_VERCEL_API_TOKEN',
  'FAILOVER_VERCEL_TEAM_ID',
  'FAILOVER_VERCEL_DNS_RECORD_ID',
  'FAILOVER_PRIMARY_IPV4',
  'FAILOVER_FALLBACK_IPV4',
  'FAILOVER_EXPECTED_IMAGE_TAG',
  'FAILOVER_EXPECTED_IMAGE_DIGEST',
]);

export const CONFIG_ERROR_CODES = Object.freeze({
  INVALID_ENV: 'CONFIG_INVALID_ENV',
  UNKNOWN_KEY: 'CONFIG_UNKNOWN_KEY',
  INVALID_BOOLEAN: 'CONFIG_INVALID_BOOLEAN',
  INVALID_VALUE: 'CONFIG_INVALID_VALUE',
  ALLOWLIST_REQUIRED: 'CONFIG_ALLOWLIST_REQUIRED',
  PAYLOAD_CONTRACT_REQUIRED: 'CONFIG_PAYLOAD_CONTRACT_REQUIRED',
  URL_INVALID: 'CONFIG_URL_INVALID',
  URL_CREDENTIALS: 'CONFIG_URL_CREDENTIALS',
  URL_NOT_ALLOWED: 'CONFIG_URL_NOT_ALLOWED',
  IPV4_INVALID: 'CONFIG_IPV4_INVALID',
  IPV4_NOT_PUBLIC: 'CONFIG_IPV4_NOT_PUBLIC',
  DNS_CONFIG_REQUIRED: 'CONFIG_DNS_REQUIRED',
  MONITOR_ID_UNVERIFIED: 'CONFIG_MONITOR_ID_UNVERIFIED',
});

export class ControllerConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ControllerConfigError';
    this.code = code;
    this.statusCode = 503;
    this.blocked = true;
  }
}

function fail(code) {
  throw new ControllerConfigError(code);
}

function own(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function readValue(env, key) {
  if (!own(env, key)) return undefined;
  const value = env[key];
  if (typeof value !== 'string' || value.length > MAX_ENV_VALUE_LENGTH || !SAFE_VALUE_PATTERN.test(value)) {
    fail(CONFIG_ERROR_CODES.INVALID_VALUE);
  }
  return value;
}

function parseBoolean(env, key, defaultValue = false) {
  const value = readValue(env, key);
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(CONFIG_ERROR_CODES.INVALID_BOOLEAN);
}

function requireString(env, key, { maxLength = MAX_ENV_VALUE_LENGTH, pattern } = {}) {
  const value = readValue(env, key);
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(CONFIG_ERROR_CODES.INVALID_VALUE);
  }
  if (pattern && !pattern.test(value)) fail(CONFIG_ERROR_CODES.INVALID_VALUE);
  return value;
}

function optionalString(env, key, { maxLength = MAX_ENV_VALUE_LENGTH, pattern } = {}) {
  if (!own(env, key) || env[key] === '') return undefined;
  const value = requireString(env, key, { maxLength, pattern });
  return value;
}

function parseUrl(value, expected, code) {
  if (value === undefined || value === '') return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(CONFIG_ERROR_CODES.URL_INVALID);
  }
  if (parsed.username !== '' || parsed.password !== '') fail(CONFIG_ERROR_CODES.URL_CREDENTIALS);
  if (parsed.search !== '' || parsed.hash !== '') fail(CONFIG_ERROR_CODES.URL_NOT_ALLOWED);
  if (value !== expected || parsed.href !== expected) fail(code);
  return expected;
}

function parseIpv4(value) {
  if (typeof value !== 'string' || !IPV4_PATTERN.test(value)) fail(CONFIG_ERROR_CODES.IPV4_INVALID);
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) fail(CONFIG_ERROR_CODES.IPV4_INVALID);
  return octets;
}

function assertPublicIpv4(value) {
  const [first, second] = parseIpv4(value);
  if (
    first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 192 && second === 2)
    || (first === 192 && second === 88)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
  ) {
    fail(CONFIG_ERROR_CODES.IPV4_NOT_PUBLIC);
  }
  return value;
}

function rejectUnknownFailoverKeys(env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('FAILOVER_') && !CONFIG_KEYS.has(key)) {
      fail(CONFIG_ERROR_CODES.UNKNOWN_KEY);
    }
  }
}

function normalizeEnabledConfig(env, enabled, payloadContractVerified) {
  const sentryClientSecret = requireString(env, 'FAILOVER_SENTRY_CLIENT_SECRET', {
    maxLength: MAX_SECRET_LENGTH,
  });
  const sentryInstallationId = requireString(env, 'FAILOVER_SENTRY_INSTALLATION_ID');
  const sentryOrganizationId = requireString(env, 'FAILOVER_SENTRY_ORGANIZATION_ID', { pattern: NUMERIC_ID_PATTERN });
  const sentryProjectId = requireString(env, 'FAILOVER_SENTRY_PROJECT_ID', { pattern: NUMERIC_ID_PATTERN });
  const sentryAlertId = optionalString(env, 'FAILOVER_SENTRY_ALERT_ID', { pattern: NUMERIC_ID_PATTERN });
  const sentryMonitorId = optionalString(env, 'FAILOVER_SENTRY_MONITOR_ID', { pattern: NUMERIC_ID_PATTERN });
  if (!sentryAlertId && !sentryMonitorId) fail(CONFIG_ERROR_CODES.ALLOWLIST_REQUIRED);
  if (sentryMonitorId) fail(CONFIG_ERROR_CODES.MONITOR_ID_UNVERIFIED);

  const primaryHealthUrl = parseUrl(
    requireString(env, 'FAILOVER_PRIMARY_HEALTH_URL'),
    PRIMARY_HEALTH_URL,
    CONFIG_ERROR_CODES.URL_NOT_ALLOWED,
  );
  const fallbackHealthUrl = parseUrl(
    requireString(env, 'FAILOVER_FALLBACK_HEALTH_URL'),
    FALLBACK_HEALTH_URL,
    CONFIG_ERROR_CODES.URL_NOT_ALLOWED,
  );
  const vercelApiToken = requireString(env, 'FAILOVER_VERCEL_API_TOKEN', {
    maxLength: MAX_SECRET_LENGTH,
  });
  const vercelTeamId = requireString(env, 'FAILOVER_VERCEL_TEAM_ID', { pattern: TEAM_ID_PATTERN });
  const vercelDnsRecordId = requireString(env, 'FAILOVER_VERCEL_DNS_RECORD_ID', { pattern: RECORD_ID_PATTERN });
  const primaryIpv4 = assertPublicIpv4(requireString(env, 'FAILOVER_PRIMARY_IPV4'));
  const fallbackIpv4 = assertPublicIpv4(requireString(env, 'FAILOVER_FALLBACK_IPV4'));
  if (primaryIpv4 === fallbackIpv4) fail(CONFIG_ERROR_CODES.DNS_CONFIG_REQUIRED);
  const expectedImageTag = requireString(env, 'FAILOVER_EXPECTED_IMAGE_TAG', {
    pattern: IMAGE_TAG_PATTERN,
  });
  const expectedImageDigest = requireString(env, 'FAILOVER_EXPECTED_IMAGE_DIGEST', {
    pattern: IMAGE_DIGEST_PATTERN,
  });

  if (!payloadContractVerified) fail(CONFIG_ERROR_CODES.PAYLOAD_CONTRACT_REQUIRED);

  let security;
  try {
    security = validateSecurityConfig({
      installationId: sentryInstallationId,
      organizationId: sentryOrganizationId,
      projectId: sentryProjectId,
      alertId: sentryAlertId,
      monitorId: sentryMonitorId,
    });
  } catch (error) {
    if (error instanceof ControllerConfigError) throw error;
    fail(CONFIG_ERROR_CODES.ALLOWLIST_REQUIRED);
  }

  return {
    enabled,
    liveSentryPayloadContractVerified: payloadContractVerified,
    bindHost: CONTROLLER_BIND_HOST,
    port: CONTROLLER_PORT,
    webhookPath: WEBHOOK_PATH,
    healthPath: HEALTH_PATH,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    headersTimeoutMs: HEADERS_TIMEOUT_MS,
    keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
    maxConnections: MAX_CONNECTIONS,
    statePath: DEFAULT_STATE_PATH,
    sentryClientSecret,
    sentryInstallationId,
    sentryOrganizationId,
    sentryProjectId,
    sentryAlertId: security.alertId,
    sentryMonitorId: security.monitorId,
    sentryTimestampToleranceMs: security.timestampToleranceMs,
    primaryHealthUrl,
    fallbackHealthUrl,
    vercelApiToken,
    vercelTeamId,
    vercelDnsRecordId,
    primaryIpv4,
    fallbackIpv4,
    expectedImageTag,
    expectedImageDigest,
  };
}

function validateOptionalDisabledValues(env) {
  if (own(env, 'FAILOVER_SENTRY_CLIENT_SECRET') && env.FAILOVER_SENTRY_CLIENT_SECRET !== '') {
    requireString(env, 'FAILOVER_SENTRY_CLIENT_SECRET', { maxLength: MAX_SECRET_LENGTH });
  }
  for (const key of [
    'FAILOVER_SENTRY_INSTALLATION_ID',
    'FAILOVER_SENTRY_ORGANIZATION_ID',
    'FAILOVER_SENTRY_PROJECT_ID',
  ]) {
    if (own(env, key) && env[key] !== '') requireString(env, key);
  }
  optionalString(env, 'FAILOVER_SENTRY_ALERT_ID', { pattern: NUMERIC_ID_PATTERN });
  const monitorId = optionalString(env, 'FAILOVER_SENTRY_MONITOR_ID', { pattern: NUMERIC_ID_PATTERN });
  if (monitorId) fail(CONFIG_ERROR_CODES.MONITOR_ID_UNVERIFIED);

  if (own(env, 'FAILOVER_PRIMARY_HEALTH_URL') && env.FAILOVER_PRIMARY_HEALTH_URL !== '') {
    parseUrl(env.FAILOVER_PRIMARY_HEALTH_URL, PRIMARY_HEALTH_URL, CONFIG_ERROR_CODES.URL_NOT_ALLOWED);
  }
  if (own(env, 'FAILOVER_FALLBACK_HEALTH_URL') && env.FAILOVER_FALLBACK_HEALTH_URL !== '') {
    parseUrl(env.FAILOVER_FALLBACK_HEALTH_URL, FALLBACK_HEALTH_URL, CONFIG_ERROR_CODES.URL_NOT_ALLOWED);
  }
  if (own(env, 'FAILOVER_VERCEL_API_TOKEN') && env.FAILOVER_VERCEL_API_TOKEN !== '') {
    requireString(env, 'FAILOVER_VERCEL_API_TOKEN', { maxLength: MAX_SECRET_LENGTH });
  }
  if (own(env, 'FAILOVER_VERCEL_TEAM_ID') && env.FAILOVER_VERCEL_TEAM_ID !== '') {
    requireString(env, 'FAILOVER_VERCEL_TEAM_ID', { pattern: TEAM_ID_PATTERN });
  }
  if (own(env, 'FAILOVER_VERCEL_DNS_RECORD_ID') && env.FAILOVER_VERCEL_DNS_RECORD_ID !== '') {
    requireString(env, 'FAILOVER_VERCEL_DNS_RECORD_ID', { pattern: RECORD_ID_PATTERN });
  }
  const primaryIpv4 = own(env, 'FAILOVER_PRIMARY_IPV4') && env.FAILOVER_PRIMARY_IPV4 !== ''
    ? assertPublicIpv4(requireString(env, 'FAILOVER_PRIMARY_IPV4'))
    : undefined;
  const fallbackIpv4 = own(env, 'FAILOVER_FALLBACK_IPV4') && env.FAILOVER_FALLBACK_IPV4 !== ''
    ? assertPublicIpv4(requireString(env, 'FAILOVER_FALLBACK_IPV4'))
    : undefined;
  if (own(env, 'FAILOVER_EXPECTED_IMAGE_TAG') && env.FAILOVER_EXPECTED_IMAGE_TAG !== '') {
    requireString(env, 'FAILOVER_EXPECTED_IMAGE_TAG', { pattern: IMAGE_TAG_PATTERN });
  }
  if (own(env, 'FAILOVER_EXPECTED_IMAGE_DIGEST') && env.FAILOVER_EXPECTED_IMAGE_DIGEST !== '') {
    requireString(env, 'FAILOVER_EXPECTED_IMAGE_DIGEST', { pattern: IMAGE_DIGEST_PATTERN });
  }
  if (primaryIpv4 && fallbackIpv4 && primaryIpv4 === fallbackIpv4) {
    fail(CONFIG_ERROR_CODES.DNS_CONFIG_REQUIRED);
  }
}

/**
 * Parse the controller's server-only environment. Bind address, endpoint
 * paths, state path, and timeouts are constants; they are never accepted from
 * an environment variable or webhook payload.
 */
export function parseControllerConfig(env = process.env) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    fail(CONFIG_ERROR_CODES.INVALID_ENV);
  }
  rejectUnknownFailoverKeys(env);
  const enabled = parseBoolean(env, 'FAILOVER_CONTROLLER_ENABLED', false);
  const payloadContractVerified = parseBoolean(
    env,
    'FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED',
    false,
  );

  if (enabled && !payloadContractVerified) {
    fail(CONFIG_ERROR_CODES.PAYLOAD_CONTRACT_REQUIRED);
  }

  if (!enabled) {
    validateOptionalDisabledValues(env);
    return Object.freeze({
      enabled: false,
      liveSentryPayloadContractVerified: payloadContractVerified,
      bindHost: CONTROLLER_BIND_HOST,
      port: CONTROLLER_PORT,
      webhookPath: WEBHOOK_PATH,
      healthPath: HEALTH_PATH,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
      maxConnections: MAX_CONNECTIONS,
      statePath: DEFAULT_STATE_PATH,
    });
  }

  return Object.freeze(normalizeEnabledConfig(env, enabled, payloadContractVerified));
}

export const readControllerConfig = parseControllerConfig;
