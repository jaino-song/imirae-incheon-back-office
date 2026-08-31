import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIG_ERROR_CODES,
  CONTROLLER_BIND_HOST,
  CONTROLLER_PORT,
  DEFAULT_STATE_PATH,
  HEALTH_PATH,
  WEBHOOK_PATH,
  ControllerConfigError,
  parseControllerConfig,
} from '../config.mjs';

const VALID_ENV = Object.freeze({
  FAILOVER_CONTROLLER_ENABLED: 'true',
  FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'true',
  FAILOVER_SENTRY_CLIENT_SECRET: 'unit-test-signing-key',
  FAILOVER_SENTRY_INSTALLATION_ID: '00000000-0000-4000-8000-000000000010',
  FAILOVER_SENTRY_ORGANIZATION_ID: '1234',
  FAILOVER_SENTRY_PROJECT_ID: '5678',
  FAILOVER_SENTRY_ALERT_ID: '91011',
  FAILOVER_PRIMARY_HEALTH_URL: 'https://api.babyjamjam.com/health/ready',
  FAILOVER_FALLBACK_HEALTH_URL: 'http://127.0.0.1:3101/health/ready',
  FAILOVER_VERCEL_API_TOKEN: 'unit-test-vercel-token',
  FAILOVER_VERCEL_TEAM_ID: 'team_test',
  FAILOVER_VERCEL_DNS_RECORD_ID: 'rec_test',
  FAILOVER_PRIMARY_IPV4: '8.8.8.8',
  FAILOVER_FALLBACK_IPV4: '1.1.1.1',
  FAILOVER_EXPECTED_IMAGE_TAG: 'a'.repeat(40),
  FAILOVER_EXPECTED_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
});

function expectConfigError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ControllerConfigError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, 503);
    assert.equal(error.blocked, true);
    assert.doesNotMatch(error.message, /unit-test|api\.babyjamjam|8\.8\.8\.8|1\.1\.1\.1/);
    return true;
  });
}

test('disabled by default with fixed loopback bind, path, and state settings', () => {
  const config = parseControllerConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.bindHost, CONTROLLER_BIND_HOST);
  assert.equal(config.port, CONTROLLER_PORT);
  assert.equal(config.webhookPath, WEBHOOK_PATH);
  assert.equal(config.healthPath, HEALTH_PATH);
  assert.equal(config.statePath, DEFAULT_STATE_PATH);
  assert.equal(config.sentryClientSecret, undefined);
  assert.equal(config.vercelApiToken, undefined);
});

test('accepts complete enabled configuration and does not expose mutable settings', () => {
  const config = parseControllerConfig(VALID_ENV);
  assert.equal(config.enabled, true);
  assert.equal(config.liveSentryPayloadContractVerified, true);
  assert.equal(config.sentryInstallationId, VALID_ENV.FAILOVER_SENTRY_INSTALLATION_ID);
  assert.equal(config.sentryOrganizationId, '1234');
  assert.equal(config.sentryProjectId, '5678');
  assert.equal(config.sentryAlertId, '91011');
  assert.equal(config.primaryHealthUrl, VALID_ENV.FAILOVER_PRIMARY_HEALTH_URL);
  assert.equal(config.fallbackHealthUrl, VALID_ENV.FAILOVER_FALLBACK_HEALTH_URL);
  assert.equal(config.expectedImageTag, VALID_ENV.FAILOVER_EXPECTED_IMAGE_TAG);
  assert.equal(config.expectedImageDigest, VALID_ENV.FAILOVER_EXPECTED_IMAGE_DIGEST);
  assert.equal(Object.isFrozen(config), true);
});

test('rejects unknown failover keys and malformed environment containers', () => {
  expectConfigError(() => parseControllerConfig(null), CONFIG_ERROR_CODES.INVALID_ENV);
  expectConfigError(() => parseControllerConfig([]), CONFIG_ERROR_CODES.INVALID_ENV);
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_UNKNOWN_KEY: 'value' }),
    CONFIG_ERROR_CODES.UNKNOWN_KEY,
  );
});

test('rejects enabled mode without explicit live payload verification', () => {
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'false' }),
    CONFIG_ERROR_CODES.PAYLOAD_CONTRACT_REQUIRED,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'not-bool' }),
    CONFIG_ERROR_CODES.INVALID_BOOLEAN,
  );
});

test('rejects missing or malformed Sentry allowlist and secret values', () => {
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_SENTRY_CLIENT_SECRET: '' }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_SENTRY_INSTALLATION_ID: 'not-a-uuid' }),
    CONFIG_ERROR_CODES.ALLOWLIST_REQUIRED,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_SENTRY_ALERT_ID: '', FAILOVER_SENTRY_MONITOR_ID: '' }),
    CONFIG_ERROR_CODES.ALLOWLIST_REQUIRED,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_SENTRY_MONITOR_ID: '12345' }),
    CONFIG_ERROR_CODES.MONITOR_ID_UNVERIFIED,
  );
});

test('rejects unsafe URLs, external origins, and decorated paths', () => {
  const values = [
    ['https://user:pass@api.babyjamjam.com/health/ready', CONFIG_ERROR_CODES.URL_CREDENTIALS],
    ['https://api.babyjamjam.com/health/ready?token=secret', CONFIG_ERROR_CODES.URL_NOT_ALLOWED],
    ['https://api.babyjamjam.com/other', CONFIG_ERROR_CODES.URL_NOT_ALLOWED],
    ['http://api.babyjamjam.com/health/ready', CONFIG_ERROR_CODES.URL_NOT_ALLOWED],
  ];
  for (const [value, code] of values) {
    expectConfigError(() => parseControllerConfig({ ...VALID_ENV, FAILOVER_PRIMARY_HEALTH_URL: value }), code);
  }
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_FALLBACK_HEALTH_URL: 'http://localhost:3101/health/ready' }),
    CONFIG_ERROR_CODES.URL_NOT_ALLOWED,
  );
});

test('rejects missing DNS values, private addresses, equal origins, and malformed identifiers', () => {
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_VERCEL_API_TOKEN: undefined }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_VERCEL_TEAM_ID: 'team bad' }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_VERCEL_DNS_RECORD_ID: 'record-1' }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_PRIMARY_IPV4: '127.0.0.1' }),
    CONFIG_ERROR_CODES.IPV4_NOT_PUBLIC,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_PRIMARY_IPV4: VALID_ENV.FAILOVER_FALLBACK_IPV4 }),
    CONFIG_ERROR_CODES.DNS_CONFIG_REQUIRED,
  );
});

test('requires complete immutable production release identity when enabled', () => {
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_TAG: undefined }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_DIGEST: undefined }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_TAG: '' }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_DIGEST: '' }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_TAG: 'A'.repeat(40) }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_TAG: 'a'.repeat(39) }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_DIGEST: `sha256:${'b'.repeat(63)}` }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({ ...VALID_ENV, FAILOVER_EXPECTED_IMAGE_DIGEST: `sha256:${'B'.repeat(64)}` }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
});

test('disabled mode may omit release identity but rejects malformed supplied values', () => {
  const disabled = parseControllerConfig({ FAILOVER_CONTROLLER_ENABLED: 'false' });
  assert.equal(disabled.expectedImageTag, undefined);
  assert.equal(disabled.expectedImageDigest, undefined);
  expectConfigError(
    () => parseControllerConfig({
      FAILOVER_CONTROLLER_ENABLED: 'false',
      FAILOVER_EXPECTED_IMAGE_TAG: 'not-a-commit',
    }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
  expectConfigError(
    () => parseControllerConfig({
      FAILOVER_CONTROLLER_ENABLED: 'false',
      FAILOVER_EXPECTED_IMAGE_DIGEST: 'sha256:not-a-digest',
    }),
    CONFIG_ERROR_CODES.INVALID_VALUE,
  );
});

test('disabled mode still rejects malformed explicitly supplied values', () => {
  expectConfigError(
    () => parseControllerConfig({ FAILOVER_CONTROLLER_ENABLED: 'false', FAILOVER_PRIMARY_HEALTH_URL: 'https://attacker.example/' }),
    CONFIG_ERROR_CODES.URL_NOT_ALLOWED,
  );
  expectConfigError(
    () => parseControllerConfig({ FAILOVER_CONTROLLER_ENABLED: 'false', FAILOVER_UNKNOWN: '1' }),
    CONFIG_ERROR_CODES.UNKNOWN_KEY,
  );
});
