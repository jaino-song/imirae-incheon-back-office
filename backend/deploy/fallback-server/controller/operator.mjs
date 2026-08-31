import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseControllerConfig } from './config.mjs';
import { getFallbackStatus } from './fallback-status.mjs';
import {
  createStateStore,
  DEFAULT_STATE_PATH,
  DNS_ROLES,
  PHASES,
} from './state-store.mjs';
import { VercelDnsClient } from './vercel-dns-client.mjs';

export const CONTROLLER_BUNDLE_ROOT = '/usr/local/libexec/babyjamjam-failover-controller';
export const CONTROLLER_CLI_PATH = '/usr/local/sbin/babyjamjam-failover-controller';
export const CONTROLLER_ENV_PATH = '/opt/babyjamjam-fallback-server/controller.env';
export const CONTROLLER_STATE_PATH = DEFAULT_STATE_PATH;
export const CONTROLLER_UNIT_PATH = '/etc/systemd/system/babyjamjam-failover-controller.service';
export const CONTROLLER_SERVICE_CHECK_ENV = 'BABYJAMJAM_CONTROLLER_SERVICE_CHECK';

export const OPERATOR_ACTIONS = Object.freeze(['status', 'arm', 'disarm']);

export const OPERATOR_REASONS = Object.freeze({
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  ROOT_REQUIRED: 'ROOT_REQUIRED',
  BUNDLE_INVALID: 'BUNDLE_INVALID',
  ENV_MISSING: 'ENV_MISSING',
  ENV_INVALID: 'ENV_INVALID',
  CONFIG_NOT_ARMABLE: 'CONFIG_NOT_ARMABLE',
  STATE_INVALID: 'STATE_INVALID',
  STATE_NOT_AWS_ACTIVE: 'STATE_NOT_AWS_ACTIVE',
  ALREADY_ARMED: 'ALREADY_ARMED',
  FALLBACK_STATUS_INVALID: 'FALLBACK_STATUS_INVALID',
  DNS_NOT_PRIMARY: 'DNS_NOT_PRIMARY',
  STATE_UPDATE_FAILED: 'STATE_UPDATE_FAILED',
});

export const CONTROLLER_RUNTIME_MODULES = Object.freeze([
  'config.mjs',
  'fallback-status.mjs',
  'main.mjs',
  'policy.mjs',
  'probes.mjs',
  'receiver.mjs',
  'security.mjs',
  'server.mjs',
  'state-store.mjs',
  'vercel-dns-client.mjs',
  'worker.mjs',
]);

const MANIFEST_ENTRIES = Object.freeze([
  ...CONTROLLER_RUNTIME_MODULES,
  'operator.mjs',
  'operator.sh',
  'controller.env.tpl',
  'systemd/babyjamjam-failover-controller.service',
]);

export const CONTROLLER_MANIFEST_ENTRIES = MANIFEST_ENTRIES;

const FILE_MODES = Object.freeze({
  module: 0o640,
  executable: 0o750,
  config: 0o640,
});

export class ControllerOperatorError extends Error {
  constructor(code = OPERATOR_REASONS.BUNDLE_INVALID) {
    super(code);
    this.name = 'ControllerOperatorError';
    this.code = code;
    this.blocked = true;
  }
}

function fail(code) {
  throw new ControllerOperatorError(code);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeMode(mode) {
  return Number(mode) & 0o777;
}

function isRegularFile(stats) {
  return stats && typeof stats.isFile === 'function' && stats.isFile();
}

function isSymlink(stats) {
  return stats && typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink();
}

async function lstat(fsModule, target) {
  try {
    return await fsModule.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertFile(fsModule, target, { requireRoot = true, mode } = {}) {
  const stats = await lstat(fsModule, target);
  if (!isRegularFile(stats) || isSymlink(stats)) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  if (requireRoot && (stats.uid !== 0 || stats.gid !== 0)) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  if (mode !== undefined && normalizeMode(stats.mode) !== mode) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  return stats;
}

async function readText(fsModule, target, code) {
  try {
    const value = await fsModule.readFile(target, 'utf8');
    if (typeof value !== 'string') fail(code);
    return value;
  } catch (error) {
    if (error instanceof ControllerOperatorError) throw error;
    fail(code);
  }
}

async function sha256File(fsModule, target) {
  let value;
  try {
    value = await fsModule.readFile(target);
  } catch {
    fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }
  return createHash('sha256').update(value).digest('hex');
}

function parseManifest(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== MANIFEST_ENTRIES.length) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  const entries = new Map();
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0 || separator === line.length - 1) fail(OPERATOR_REASONS.BUNDLE_INVALID);
    const name = line.slice(0, separator);
    const digest = line.slice(separator + 1);
    if (!MANIFEST_ENTRIES.includes(name) || entries.has(name) || !/^[0-9a-f]{64}$/u.test(digest)) {
      fail(OPERATOR_REASONS.BUNDLE_INVALID);
    }
    entries.set(name, digest);
  }
  for (const name of MANIFEST_ENTRIES) {
    if (!entries.has(name)) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }
  return entries;
}

function bundleMode(name) {
  if (name === 'operator.mjs' || name === 'operator.sh') return FILE_MODES.executable;
  if (CONTROLLER_RUNTIME_MODULES.includes(name)) return FILE_MODES.module;
  return FILE_MODES.config;
}

/**
 * Verify the immutable controller bundle and its installed service/CLI files.
 * The manifest is the only source of expected hashes; no file content is
 * returned to callers.
 */
export async function validateBundle({
  fsModule = nodeFs,
  bundleRoot = CONTROLLER_BUNDLE_ROOT,
  cliPath = CONTROLLER_CLI_PATH,
  unitPath = CONTROLLER_UNIT_PATH,
  requireRoot = true,
} = {}) {
  const rootStats = await lstat(fsModule, bundleRoot);
  if (!rootStats || isSymlink(rootStats) || typeof rootStats.isDirectory !== 'function' || !rootStats.isDirectory()) {
    fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }
  if (requireRoot && (rootStats.uid !== 0 || rootStats.gid !== 0)) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  if (normalizeMode(rootStats.mode) !== 0o700) fail(OPERATOR_REASONS.BUNDLE_INVALID);

  const manifestPath = path.join(bundleRoot, 'bundle.manifest');
  await assertFile(fsModule, manifestPath, { requireRoot, mode: FILE_MODES.config });
  const manifest = parseManifest(await readText(fsModule, manifestPath, OPERATOR_REASONS.BUNDLE_INVALID));

  for (const name of MANIFEST_ENTRIES) {
    const expectedMode = bundleMode(name);
    const bundlePath = path.join(bundleRoot, name);
    await assertFile(fsModule, bundlePath, { requireRoot, mode: expectedMode });
    const digest = await sha256File(fsModule, bundlePath);
    if (digest !== manifest.get(name)) fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }

  await assertFile(fsModule, cliPath, { requireRoot, mode: FILE_MODES.executable });
  if (await sha256File(fsModule, cliPath) !== manifest.get('operator.sh')) {
    fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }
  await assertFile(fsModule, unitPath, { requireRoot, mode: FILE_MODES.config });
  if (await sha256File(fsModule, unitPath) !== manifest.get('systemd/babyjamjam-failover-controller.service')) {
    fail(OPERATOR_REASONS.BUNDLE_INVALID);
  }
  return Object.freeze({ ok: true });
}

function unquote(value) {
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    if (value.length < 2 || value[value.length - 1] !== quote) fail(OPERATOR_REASONS.ENV_INVALID);
    value = value.slice(1, -1);
  } else if (value.includes('"') || value.includes("'")) {
    fail(OPERATOR_REASONS.ENV_INVALID);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail(OPERATOR_REASONS.ENV_INVALID);
  return value;
}

function parseEnvText(text) {
  if (typeof text !== 'string') fail(OPERATOR_REASONS.ENV_INVALID);
  const values = Object.create(null);
  for (const line of text.split('\n')) {
    if (line === '' || /^\s*#/u.test(line)) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match || !match[1].startsWith('FAILOVER_') || hasOwn(values, match[1])) {
      fail(OPERATOR_REASONS.ENV_INVALID);
    }
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

async function readControllerEnv({ fsModule, envPath, requireRoot }) {
  const stats = await lstat(fsModule, envPath);
  if (!stats) return Object.freeze({ exists: false, values: Object.freeze({}) });
  if (!isRegularFile(stats) || isSymlink(stats)) fail(OPERATOR_REASONS.ENV_INVALID);
  if (requireRoot && (stats.uid !== 0 || stats.gid !== 0)) fail(OPERATOR_REASONS.ENV_INVALID);
  if (normalizeMode(stats.mode) !== 0o600) fail(OPERATOR_REASONS.ENV_INVALID);
  return Object.freeze({
    exists: true,
    values: Object.freeze(parseEnvText(await readText(fsModule, envPath, OPERATOR_REASONS.ENV_INVALID))),
  });
}

function safeNow(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  if (!Number.isSafeInteger(value) || value < 0) fail(OPERATOR_REASONS.STATE_INVALID);
  return value;
}

function outputLines({ bundle = 'ok', env = 'ok', config, state, extra = {} }) {
  const lines = [
    `controller_bundle=${bundle}`,
    `controller_env=${env}`,
    `controller_enabled=${config?.enabled === true ? 'true' : 'false'}`,
  ];
  if (!state) {
    lines.push('state=missing', 'armed=false');
  } else {
    lines.push(
      `state_phase=${state.phase}`,
      `armed=${state.armed ? 'true' : 'false'}`,
      `current_dns_role=${state.currentDnsRole}`,
    );
  }
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}=${value}`);
  return Object.freeze(lines);
}

function assertStateForArm(state) {
  if (!isObject(state)) fail(OPERATOR_REASONS.STATE_INVALID);
  if (
    state.phase !== PHASES.AWS_ACTIVE
    || state.currentDnsRole !== DNS_ROLES.AWS
    || state.pendingIncident !== null
    || state.terminalReason !== null
  ) {
    fail(OPERATOR_REASONS.STATE_NOT_AWS_ACTIVE);
  }
  if (state.armed) fail(OPERATOR_REASONS.ALREADY_ARMED);
}

function assertFallbackStatus(status) {
  if (!isObject(status)) fail(OPERATOR_REASONS.FALLBACK_STATUS_INVALID);
  if (
    status.environment !== 'fallback-server'
    || status.containerHealthy !== true
    || status.restartCount !== 0
    || status.dbReady !== true
    || status.productionDbIdentityCertified !== true
    || status.releaseHealthy !== true
    || status.passiveGatesHealthy !== true
    || status.schedulersEnabled !== false
    || status.documentJobsAccepting !== false
    || status.documentJobsWorker !== false
    || status.publicRoutingManaged !== false
  ) {
    fail(OPERATOR_REASONS.FALLBACK_STATUS_INVALID);
  }
}

function assertPrimaryRecord(record, config) {
  if (!isObject(record) || record.value !== config.primaryIpv4) fail(OPERATOR_REASONS.DNS_NOT_PRIMARY);
}

function injected(options, key) {
  return hasOwn(options, key) && options[key] !== undefined;
}

/**
 * Build the fixed-path operator. All path/runner injections are test-only;
 * production actions always use the protected bundle and state locations.
 */
export function createOperator(options = {}) {
  if (!isObject(options)) throw new TypeError('options must be an object');
  const testMode = options.testMode === true;
  const injectionKeys = [
    'fsModule',
    'bundleRoot',
    'cliPath',
    'unitPath',
    'envPath',
    'statePath',
    'stateStore',
    'bundleValidator',
    'parseConfig',
    'fallbackStatusReader',
    'fallbackStatusRunner',
    'readCurrentDns',
    'dnsClient',
    'vercelFetch',
    'clock',
    'uid',
  ];
  if (!testMode && injectionKeys.some((key) => injected(options, key))) {
    throw new TypeError('operator dependency injection is test-only');
  }

  const fsModule = options.fsModule ?? nodeFs;
  const bundleRoot = testMode ? options.bundleRoot ?? CONTROLLER_BUNDLE_ROOT : CONTROLLER_BUNDLE_ROOT;
  const cliPath = testMode ? options.cliPath ?? CONTROLLER_CLI_PATH : CONTROLLER_CLI_PATH;
  const unitPath = testMode ? options.unitPath ?? CONTROLLER_UNIT_PATH : CONTROLLER_UNIT_PATH;
  const envPath = testMode ? options.envPath ?? CONTROLLER_ENV_PATH : CONTROLLER_ENV_PATH;
  const statePath = testMode ? options.statePath ?? CONTROLLER_STATE_PATH : CONTROLLER_STATE_PATH;
  const clock = options.clock ?? (() => Date.now());
  const uid = options.uid ?? (() => process.getuid?.() ?? -1);
  const parseConfig = options.parseConfig ?? parseControllerConfig;
  const bundleValidator = options.bundleValidator ?? (() => validateBundle({
    fsModule,
    bundleRoot,
    cliPath,
    unitPath,
    requireRoot: !testMode,
  }));
  const stateStore = options.stateStore ?? createStateStore({
    statePath,
    productionMode: !testMode,
    requireRootOwnership: !testMode,
    now: clock,
  });
  const fallbackStatusReader = options.fallbackStatusReader ?? getFallbackStatus;

  function requireRoot() {
    if (uid() !== 0) fail(OPERATOR_REASONS.ROOT_REQUIRED);
  }

  async function validate() {
    try {
      await bundleValidator();
    } catch (error) {
      if (error instanceof ControllerOperatorError) throw error;
      fail(OPERATOR_REASONS.BUNDLE_INVALID);
    }
  }

  async function loadEnvironment({ required = false } = {}) {
    let environment;
    try {
      environment = await readControllerEnv({ fsModule, envPath, requireRoot: !testMode });
    } catch (error) {
      if (error instanceof ControllerOperatorError) throw error;
      fail(OPERATOR_REASONS.ENV_INVALID);
    }
    if (required && !environment.exists) fail(OPERATOR_REASONS.ENV_MISSING);
    let config;
    try {
      config = parseConfig(environment.values);
    } catch {
      fail(OPERATOR_REASONS.ENV_INVALID);
    }
    return { environment, config };
  }

  async function readState() {
    try {
      return await stateStore.read();
    } catch {
      fail(OPERATOR_REASONS.STATE_INVALID);
    }
  }

  async function ensureState() {
    const existing = await readState();
    if (existing) return existing;
    try {
      return await stateStore.create({ armed: false, at: safeNow(clock) });
    } catch {
      fail(OPERATOR_REASONS.STATE_INVALID);
    }
  }

  async function readDns(config) {
    if (typeof options.readCurrentDns === 'function') {
      return options.readCurrentDns(config);
    }
    const client = options.dnsClient ?? new VercelDnsClient({
      vercelToken: config.vercelApiToken,
      teamId: config.vercelTeamId,
      recordId: config.vercelDnsRecordId,
      primaryIpv4: config.primaryIpv4,
      fallbackIpv4: config.fallbackIpv4,
      fetch: options.vercelFetch,
      clock,
    });
    return client.readCurrentRecord();
  }

  async function readHealthyFallbackStatus() {
    let status;
    try {
      status = await fallbackStatusReader({
        runner: options.fallbackStatusRunner,
        expectedImageTag: options.expectedImageTag,
        expectedImageDigest: options.expectedImageDigest,
      });
    } catch {
      fail(OPERATOR_REASONS.FALLBACK_STATUS_INVALID);
    }
    assertFallbackStatus(status);
    return status;
  }

  async function status() {
    requireRoot();
    await validate();
    const { environment, config } = await loadEnvironment();
    const state = await readState();
    return outputLines({
      env: environment.exists ? 'ok' : 'missing',
      config,
      state,
      extra: state?.phase === PHASES.FALLBACK_ACTIVE
        ? { automatic_failback: 'disabled' }
        : {},
    });
  }

  async function arm() {
    requireRoot();
    await validate();
    const { config } = await loadEnvironment({ required: true });
    if (config.enabled !== true || config.liveSentryPayloadContractVerified !== true) {
      fail(OPERATOR_REASONS.CONFIG_NOT_ARMABLE);
    }
    const state = await ensureState();
    assertStateForArm(state);
    await readHealthyFallbackStatus();
    let record;
    try {
      record = await readDns(config);
    } catch {
      fail(OPERATOR_REASONS.DNS_NOT_PRIMARY);
    }
    assertPrimaryRecord(record, config);
    let next;
    try {
      next = await stateStore.update({
        expectedGeneration: state.generation,
        expectedPhase: PHASES.AWS_ACTIVE,
        patch: { armed: true },
        at: safeNow(clock),
      });
    } catch {
      fail(OPERATOR_REASONS.STATE_UPDATE_FAILED);
    }
    return outputLines({
      config,
      state: next,
      extra: {
        production_db_identity: 'ok',
        fallback_release: 'healthy',
        fallback_passive_gates: 'healthy',
        dns_target: 'PRIMARY',
      },
    });
  }

  async function disarm() {
    requireRoot();
    await validate();
    const { config } = await loadEnvironment();
    const state = await ensureState();
    if (!state.armed) {
      return outputLines({ config, state, extra: { automatic_failback: 'disabled' } });
    }
    let next;
    try {
      next = await stateStore.update({
        expectedGeneration: state.generation,
        patch: { armed: false },
        at: safeNow(clock),
      });
    } catch {
      fail(OPERATOR_REASONS.STATE_UPDATE_FAILED);
    }
    return outputLines({ config, state: next, extra: { automatic_failback: 'disabled' } });
  }

  async function checkBundle() {
    requireRoot();
    await validate();
    return Object.freeze(['controller_bundle=ok']);
  }

  async function run(args) {
    if (!Array.isArray(args) || args.length !== 1 || !OPERATOR_ACTIONS.includes(args[0])) {
      fail(OPERATOR_REASONS.INVALID_ARGUMENTS);
    }
    if (args[0] === 'status') return status();
    if (args[0] === 'arm') return arm();
    return disarm();
  }

  return Object.freeze({ status, arm, disarm, checkBundle, run });
}

export async function runOperator(args, options = {}) {
  return createOperator(options).run(args);
}

function isDirectExecution() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  const args = process.argv.slice(2);
  const operator = createOperator();
  const operation = args.length === 1
    && args[0] === '--check-bundle'
    && process.env[CONTROLLER_SERVICE_CHECK_ENV] === '1'
    ? operator.checkBundle()
    : operator.run(args);
  operation.then((lines) => {
    process.stdout.write(`${lines.join('\n')}\n`);
  }).catch(() => {
    process.stderr.write('controller_operation=failed\n');
    process.exitCode = 1;
  });
}
