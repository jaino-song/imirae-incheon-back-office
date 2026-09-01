import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';

export const STATE_SCHEMA_VERSION = 1;
export const DEFAULT_STATE_PATH = '/opt/babyjamjam-fallback-server/state/failover-controller-state.json';
export const MAX_REPLAY_FINGERPRINTS = 64;
export const MAX_REPLAY_FINGERPRINT_HISTORY = MAX_REPLAY_FINGERPRINTS;
export const MAX_TERMINAL_REASON_LENGTH = 128;
export const MAX_PATH_LENGTH = 4_096;

export const PHASES = Object.freeze({
  AWS_ACTIVE: 'AWS_ACTIVE',
  VERIFYING: 'VERIFYING',
  DNS_COMMITTING: 'DNS_COMMITTING',
  FALLBACK_ACTIVE: 'FALLBACK_ACTIVE',
  BLOCKED: 'BLOCKED',
});

export const DNS_ROLES = Object.freeze({
  AWS: 'AWS',
  FALLBACK: 'FALLBACK',
});

const STATE_KEYS = Object.freeze([
  'schemaVersion',
  'generation',
  'phase',
  'armed',
  'currentDnsRole',
  'currentEventFingerprint',
  'lastEventFingerprint',
  'pendingIncident',
  'terminalReason',
  'replayFingerprints',
  'createdAt',
  'updatedAt',
]);

const PENDING_INCIDENT_KEYS = Object.freeze([
  'eventFingerprint',
  'startedAt',
  'generation',
]);

const MUTABLE_STATE_KEYS = Object.freeze([
  'phase',
  'armed',
  'currentDnsRole',
  'currentEventFingerprint',
  'lastEventFingerprint',
  'pendingIncident',
  'terminalReason',
  'replayFingerprints',
]);

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_TERMINAL_REASON_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
const IPV4_PATTERN = /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])/;
const IPV6_PATTERN = /(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]{0,19}/i;
const LOCK_SCHEMA_VERSION = 1;
const LOCK_RETRY_DELAY_MS = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_STALE_AFTER_MS = 60_000;
const LOCK_METADATA_KEYS = Object.freeze([
  'schemaVersion',
  'pid',
  'startToken',
  'bootId',
  'token',
  'acquiredAt',
]);
const LOCK_TOKEN_PATTERN = /^[0-9a-f-]{36}$/i;
const LOCK_IDENTITY_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set(['EINVAL', 'ENOTSUP', 'EISDIR']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) {
    throw new StateValidationError(`${label} must be an object`);
  }
  const actualKeys = Object.keys(value).sort();
  const allowedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== allowedKeys.length
    || actualKeys.some((key, index) => key !== allowedKeys[index])
  ) {
    throw new StateValidationError(`${label} contains unknown or missing fields`);
  }
}

function assertSafeTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StateValidationError(`${label} must be a non-negative integer`);
  }
}

function normalizeFingerprint(value, label, { nullable = true } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new StateValidationError(`${label} must be a SHA-256 hex digest`);
  }
  return value.toLowerCase();
}

function normalizeTerminalReason(value) {
  if (value === null) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_TERMINAL_REASON_LENGTH
    || !SAFE_TERMINAL_REASON_PATTERN.test(value)
    || IPV4_PATTERN.test(value)
    || IPV6_PATTERN.test(value)
  ) {
    throw new StateValidationError('terminalReason must be a bounded safe reason token');
  }
  return value;
}

function normalizePendingIncident(value, stateGeneration) {
  if (value === null) return null;
  assertExactKeys(value, PENDING_INCIDENT_KEYS, 'pendingIncident');
  const eventFingerprint = normalizeFingerprint(value.eventFingerprint, 'pendingIncident.eventFingerprint', {
    nullable: false,
  });
  assertSafeTimestamp(value.startedAt, 'pendingIncident.startedAt');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    throw new StateValidationError('pendingIncident.generation must be a positive integer');
  }
  if (value.generation > stateGeneration) {
    throw new StateValidationError('pendingIncident.generation cannot be ahead of state generation');
  }
  return {
    eventFingerprint,
    startedAt: value.startedAt,
    generation: value.generation,
  };
}

function normalizeReplayFingerprints(value) {
  if (!Array.isArray(value)) {
    throw new StateValidationError('replayFingerprints must be an array');
  }
  if (value.length > MAX_REPLAY_FINGERPRINTS) {
    throw new StateValidationError('replayFingerprints exceeds the bounded history');
  }
  const normalized = value.map((fingerprint, index) => normalizeFingerprint(
    fingerprint,
    `replayFingerprints[${index}]`,
    { nullable: false },
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new StateValidationError('replayFingerprints must not contain duplicates');
  }
  return normalized;
}

function normalizeState(value) {
  assertExactKeys(value, STATE_KEYS, 'state');
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new StateValidationError('unsupported state schemaVersion');
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) {
    throw new StateValidationError('generation must be a non-negative integer');
  }
  if (!Object.values(PHASES).includes(value.phase)) {
    throw new StateValidationError('unknown state phase');
  }
  if (typeof value.armed !== 'boolean') {
    throw new StateValidationError('armed must be a boolean');
  }
  if (!Object.values(DNS_ROLES).includes(value.currentDnsRole)) {
    throw new StateValidationError('unknown currentDnsRole');
  }
  const currentEventFingerprint = normalizeFingerprint(
    value.currentEventFingerprint,
    'currentEventFingerprint',
  );
  const lastEventFingerprint = normalizeFingerprint(value.lastEventFingerprint, 'lastEventFingerprint');
  const pendingIncident = normalizePendingIncident(value.pendingIncident, value.generation);
  const terminalReason = normalizeTerminalReason(value.terminalReason);
  const replayFingerprints = normalizeReplayFingerprints(value.replayFingerprints);
  assertSafeTimestamp(value.createdAt, 'createdAt');
  assertSafeTimestamp(value.updatedAt, 'updatedAt');

  if (
    (value.phase === PHASES.VERIFYING || value.phase === PHASES.DNS_COMMITTING)
    && pendingIncident === null
  ) {
    throw new StateValidationError(`${value.phase} requires a complete pendingIncident`);
  }
  if (
    value.phase !== PHASES.VERIFYING
    && value.phase !== PHASES.DNS_COMMITTING
    && pendingIncident !== null
  ) {
    throw new StateValidationError('pendingIncident is only valid during verification or DNS commit');
  }
  if (pendingIncident && currentEventFingerprint !== pendingIncident.eventFingerprint) {
    throw new StateValidationError('pendingIncident fingerprint must match currentEventFingerprint');
  }
  if (value.phase === PHASES.AWS_ACTIVE && value.currentDnsRole !== DNS_ROLES.AWS) {
    throw new StateValidationError('AWS_ACTIVE requires the AWS DNS role');
  }
  if (value.phase === PHASES.VERIFYING && value.currentDnsRole !== DNS_ROLES.AWS) {
    throw new StateValidationError('VERIFYING requires the AWS DNS role before cutover');
  }
  if (value.phase === PHASES.DNS_COMMITTING && value.currentDnsRole !== DNS_ROLES.AWS) {
    throw new StateValidationError('DNS_COMMITTING requires the AWS DNS role before cutover');
  }
  if (value.phase === PHASES.DNS_COMMITTING && value.armed !== true) {
    throw new StateValidationError('DNS_COMMITTING requires the controller to remain armed');
  }
  if (
    value.phase === PHASES.DNS_COMMITTING
    && pendingIncident
    && pendingIncident.generation !== value.generation
  ) {
    throw new StateValidationError('DNS_COMMITTING pendingIncident must match state generation');
  }
  if (value.phase === PHASES.FALLBACK_ACTIVE && value.currentDnsRole !== DNS_ROLES.FALLBACK) {
    throw new StateValidationError('FALLBACK_ACTIVE requires the Fallback DNS role');
  }
  if (value.phase === PHASES.BLOCKED && terminalReason === null) {
    throw new StateValidationError('BLOCKED requires terminalReason');
  }
  if (value.phase !== PHASES.BLOCKED && terminalReason !== null) {
    throw new StateValidationError('terminalReason is only valid for BLOCKED');
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    generation: value.generation,
    phase: value.phase,
    armed: value.armed,
    currentDnsRole: value.currentDnsRole,
    currentEventFingerprint,
    lastEventFingerprint,
    pendingIncident,
    terminalReason,
    replayFingerprints,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  assertSafeTimestamp(value, 'now');
  return value;
}

function normalizeStateInput(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new StateValidationError('state JSON is malformed');
    }
  }
  return value;
}

export class StateStoreError extends Error {
  constructor(message, code = 'STATE_STORE_ERROR', options = {}) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class StateValidationError extends StateStoreError {
  constructor(message = 'state is invalid') {
    super(message, 'STATE_INVALID');
  }
}

export class StateNotFoundError extends StateStoreError {
  constructor() {
    super('state file is missing', 'STATE_NOT_FOUND');
  }
}

export class StatePathError extends StateStoreError {
  constructor(message = 'state path is invalid') {
    super(message, 'STATE_PATH_INVALID');
  }
}

export class StateOwnershipError extends StateStoreError {
  constructor(message = 'state file ownership or mode is unsafe') {
    super(message, 'STATE_OWNERSHIP_INVALID');
  }
}

export class StateLockError extends StateStoreError {
  constructor() {
    super('state lock is unavailable', 'STATE_LOCK_UNAVAILABLE');
    this.retryable = true;
  }
}

export class ConditionalStateWriteError extends StateStoreError {
  constructor(message = 'conditional state write failed', code = 'CONDITIONAL_STATE_WRITE_FAILED') {
    super(message, code);
    this.retryable = true;
  }
}

export class StaleGenerationError extends ConditionalStateWriteError {
  constructor() {
    super('state generation is stale', 'STALE_GENERATION');
  }
}

export class StatePhaseMismatchError extends ConditionalStateWriteError {
  constructor() {
    super('state phase does not match the expected phase', 'STATE_PHASE_MISMATCH');
  }
}

export class DnsCommitDisarmError extends ConditionalStateWriteError {
  constructor() {
    super('cannot disarm during DNS commit', 'DNS_COMMITTING_DISARM_FORBIDDEN');
    this.retryable = false;
  }
}

export class ReplayFingerprintExistsError extends ConditionalStateWriteError {
  constructor() {
    super('replay fingerprint already exists', 'REPLAY_FINGERPRINT_EXISTS');
    this.retryable = false;
  }
}

export function createInitialState(now = Date.now(), { armed = false } = {}) {
  let initialNow = now;
  let initialArmed = armed;
  if (isPlainObject(now)) {
    const options = now;
    initialNow = options.now ?? Date.now();
    initialArmed = options.armed ?? armed;
  }
  const timestamp = resolveNow(initialNow);
  if (typeof initialArmed !== 'boolean') throw new StateValidationError('armed must be a boolean');
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    generation: 0,
    phase: PHASES.AWS_ACTIVE,
    armed: initialArmed,
    currentDnsRole: DNS_ROLES.AWS,
    currentEventFingerprint: null,
    lastEventFingerprint: null,
    pendingIncident: null,
    terminalReason: null,
    replayFingerprints: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function parseState(value) {
  return clone(normalizeState(normalizeStateInput(value)));
}

export function serializeState(value) {
  return `${JSON.stringify(parseState(value))}\n`;
}

function asFsModule(fsModule) {
  const candidate = fsModule?.promises ?? fsModule;
  const requiredMethods = ['lstat', 'readFile', 'open', 'rename', 'unlink'];
  for (const method of requiredMethods) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`fsModule.${method} is required`);
    }
  }
  return candidate;
}

function normalizePathOption(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new StatePathError(`${label} is required`);
  }
  if (value.includes('\0')) throw new StatePathError(`${label} contains a null byte`);
  if (!path.isAbsolute(value)) throw new StatePathError(`${label} must be absolute`);
  return path.resolve(value);
}

function assertExpectedGeneration(expectedGeneration) {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
    throw new TypeError('expectedGeneration must be a non-negative integer');
  }
}

function normalizePatch(patch) {
  if (!isPlainObject(patch)) throw new StateValidationError('state patch must be an object');
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!MUTABLE_STATE_KEYS.includes(key)) {
      throw new StateValidationError(`state patch field is not mutable: ${key}`);
    }
  }
  return patch;
}

function isNotFound(error) {
  return error?.code === 'ENOENT';
}

function isAlreadyExists(error) {
  return error?.code === 'EEXIST';
}

function isUnsupportedDirectoryFsync(error) {
  return UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(error?.code);
}

function isProcessMissing(error) {
  return error?.code === 'ESRCH';
}

function isPermissionDenied(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES';
}

function safeLockIdentityPart(value) {
  return typeof value === 'string' && LOCK_IDENTITY_PATTERN.test(value);
}

function parseLockMetadata(raw) {
  if (typeof raw !== 'string') return undefined;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...LOCK_METADATA_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return undefined;
  }
  if (value.schemaVersion !== LOCK_SCHEMA_VERSION || !Number.isSafeInteger(value.pid) || value.pid < 1) {
    return undefined;
  }
  if (!safeLockIdentityPart(value.startToken) || !safeLockIdentityPart(value.bootId)) return undefined;
  if (typeof value.token !== 'string' || !LOCK_TOKEN_PATTERN.test(value.token)) return undefined;
  if (!Number.isSafeInteger(value.acquiredAt) || value.acquiredAt < 0) return undefined;
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    pid: value.pid,
    startToken: value.startToken,
    bootId: value.bootId,
    token: value.token,
    acquiredAt: value.acquiredAt,
  };
}

function sameLockFile(statsA, statsB) {
  if (!statsA || !statsB) return false;
  return statsA.dev === statsB.dev
    && statsA.ino === statsB.ino
    && statsA.size === statsB.size
    && statsA.mtimeMs === statsB.mtimeMs;
}

async function closeQuietly(handle) {
  if (!handle || typeof handle.close !== 'function') return;
  try {
    await handle.close();
  } catch {
    // Preserve the original operation failure.
  }
}

export function createStateStore({
  statePath = DEFAULT_STATE_PATH,
  parentDir,
  productionMode = false,
  requireRootOwnership = productionMode,
  fsModule = nodeFs,
  now = () => Date.now(),
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  lockStaleAfterMs = DEFAULT_LOCK_STALE_AFTER_MS,
  lockIdentity,
  isProcessAlive,
  readProcessStartToken,
  readBootId,
} = {}) {
  const fs = asFsModule(fsModule);
  const resolvedStatePath = normalizePathOption(statePath, 'statePath');
  const resolvedParentDir = normalizePathOption(parentDir ?? path.dirname(resolvedStatePath), 'parentDir');
  if (path.dirname(resolvedStatePath) !== resolvedParentDir) {
    throw new StatePathError('statePath must be directly inside parentDir');
  }
  if (typeof productionMode !== 'boolean' || typeof requireRootOwnership !== 'boolean') {
    throw new TypeError('productionMode and requireRootOwnership must be booleans');
  }
  const mustBeRootOwned = productionMode || requireRootOwnership;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new TypeError('lockTimeoutMs must be a non-negative integer');
  }
  if (!Number.isSafeInteger(lockStaleAfterMs) || lockStaleAfterMs < 0) {
    throw new TypeError('lockStaleAfterMs must be a non-negative integer');
  }
  const lockPath = `${resolvedStatePath}.lock`;

  async function inspectDirectory() {
    let stats;
    try {
      stats = await fs.lstat(resolvedParentDir);
    } catch (error) {
      if (isNotFound(error)) throw new StatePathError('state parent directory is missing');
      throw error;
    }
    if (stats.isSymbolicLink?.() || !stats.isDirectory?.()) {
      throw new StatePathError('state parent directory must be a real directory');
    }
    if (mustBeRootOwned && (stats.uid !== 0 || stats.gid !== 0)) {
      throw new StateOwnershipError('state parent directory must be root-owned');
    }
    if (mustBeRootOwned && ((stats.mode & 0o022) !== 0)) {
      throw new StateOwnershipError('state parent directory must not be group/world writable');
    }
  }

  async function inspectStateFile({ allowMissing = true } = {}) {
    let stats;
    try {
      stats = await fs.lstat(resolvedStatePath);
    } catch (error) {
      if (isNotFound(error) && allowMissing) return null;
      if (isNotFound(error)) throw new StateNotFoundError();
      throw error;
    }
    if (stats.isSymbolicLink?.()) throw new StateOwnershipError('state file must not be a symlink');
    if (!stats.isFile?.()) throw new StateOwnershipError('state path must be a regular file');
    if ((stats.mode & 0o777) !== 0o600) {
      throw new StateOwnershipError('state file must be mode 0600');
    }
    if (mustBeRootOwned && (stats.uid !== 0 || stats.gid !== 0)) {
      throw new StateOwnershipError('state file must be root-owned');
    }
    return stats;
  }

  async function readUnlocked() {
    await inspectDirectory();
    const stats = await inspectStateFile();
    if (stats === null) return undefined;
    let raw;
    try {
      raw = await fs.readFile(resolvedStatePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) throw new StateNotFoundError();
      throw error;
    }
    return parseState(raw);
  }

  async function readBootIdentifier() {
    if (typeof readBootId === 'function') {
      try {
        const value = await readBootId();
        return safeLockIdentityPart(value) ? value : 'unknown-boot';
      } catch {
        return 'unknown-boot';
      }
    }
    try {
      const value = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      return safeLockIdentityPart(value) ? value : 'unknown-boot';
    } catch {
      return 'unknown-boot';
    }
  }

  async function readStartIdentifier(pid) {
    if (typeof readProcessStartToken === 'function') {
      try {
        const value = await readProcessStartToken(pid);
        return safeLockIdentityPart(value) ? value : undefined;
      } catch {
        return undefined;
      }
    }
    try {
      const raw = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const closingParenthesis = raw.lastIndexOf(')');
      if (closingParenthesis < 0) return undefined;
      const fields = raw.slice(closingParenthesis + 2).trim().split(/\s+/u);
      const startToken = fields[19];
      return safeLockIdentityPart(startToken) ? startToken : undefined;
    } catch {
      return undefined;
    }
  }

  async function currentLockIdentity() {
    if (lockIdentity !== undefined) {
      if (!isPlainObject(lockIdentity)) throw new StateOwnershipError('lock identity is invalid');
      const value = {
        pid: lockIdentity.pid,
        startToken: lockIdentity.startToken,
        bootId: lockIdentity.bootId,
      };
      if (!Number.isSafeInteger(value.pid) || value.pid < 1) throw new StateOwnershipError('lock identity is invalid');
      if (!safeLockIdentityPart(value.startToken) || !safeLockIdentityPart(value.bootId)) {
        throw new StateOwnershipError('lock identity is invalid');
      }
      return value;
    }
    const pid = process.pid;
    const startToken = await readStartIdentifier(pid) ?? `node-${pid}-${Math.floor(process.uptime() * 1_000)}`;
    return { pid, startToken, bootId: await readBootIdentifier() };
  }

  async function processIsAlive(pid) {
    if (typeof isProcessAlive === 'function') {
      try {
        return (await isProcessAlive(pid)) === true;
      } catch {
        return false;
      }
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (isProcessMissing(error)) return false;
      if (isPermissionDenied(error)) return true;
      return false;
    }
  }

  async function lockMetadata() {
    const identity = await currentLockIdentity();
    return {
      schemaVersion: LOCK_SCHEMA_VERSION,
      pid: identity.pid,
      startToken: identity.startToken,
      bootId: identity.bootId,
      token: randomUUID(),
      acquiredAt: resolveNow(now),
    };
  }

  async function readLockFile() {
    let stats;
    try {
      stats = await fs.lstat(lockPath);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    if (stats.isSymbolicLink?.() || !stats.isFile?.()) {
      return { stale: false, unsafe: true, stats };
    }
    if ((stats.mode & 0o777) !== 0o600) {
      return { stale: false, unsafe: true, stats };
    }
    if (mustBeRootOwned && (stats.uid !== 0 || stats.gid !== 0)) {
      return { stale: false, unsafe: true, stats };
    }
    let raw;
    try {
      raw = await fs.readFile(lockPath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    const metadata = parseLockMetadata(raw);
    if (!metadata) {
      const age = Date.now() - Number(stats.mtimeMs ?? 0);
      return {
        stale: Number.isFinite(age) && age >= lockStaleAfterMs,
        unsafe: false,
        stats,
      };
    }
    const identity = await currentLockIdentity();
    if (metadata.bootId !== identity.bootId) return { stale: true, unsafe: false, metadata, stats };
    if (!(await processIsAlive(metadata.pid))) return { stale: true, unsafe: false, metadata, stats };
    const observedStartToken = await readStartIdentifier(metadata.pid);
    if (observedStartToken !== undefined && observedStartToken !== metadata.startToken) {
      return { stale: true, unsafe: false, metadata, stats };
    }
    return { stale: false, unsafe: false, metadata, stats };
  }

  async function reclaimStaleLock(observed) {
    if (!observed?.stale || observed.unsafe) return false;
    const latest = await readLockFile();
    if (!latest) return true;
    if (!sameLockFile(latest.stats, observed.stats)) return false;
    if (latest.metadata?.token !== observed.metadata?.token) return false;
    const quarantinePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
    let quarantineOwned = false;
    try {
      await fs.rename(lockPath, quarantinePath);
    } catch (error) {
      if (isNotFound(error)) return true;
      return false;
    }
    try {
      let quarantineRaw;
      try {
        quarantineRaw = await fs.readFile(quarantinePath, 'utf8');
      } catch {
        quarantineRaw = undefined;
      }
      const quarantineMetadata = parseLockMetadata(quarantineRaw);
      const sameToken = observed.metadata?.token === undefined
        ? quarantineMetadata === undefined
        : quarantineMetadata?.token === observed.metadata.token;
      if (!sameToken) {
        // Do not unlink a replacement lock that appeared between the final
        // identity check and rename. The quarantine is intentionally retained
        // for manual inspection rather than risking a live-owner unlink. If
        // the path is still vacant, restore the quarantined lock first.
        try {
          await fs.lstat(lockPath);
        } catch (error) {
          if (isNotFound(error)) {
            try {
              await fs.rename(quarantinePath, lockPath);
              quarantineOwned = false;
            } catch {
              // Leave the quarantine for a later bounded reconciliation.
            }
          }
        }
        return false;
      }
      quarantineOwned = true;
      return true;
    } finally {
      if (quarantineOwned) {
        try {
          await fs.unlink(quarantinePath);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
    }
  }

  async function syncParentDirectory() {
    let handle;
    try {
      handle = await fs.open(resolvedParentDir, 'r');
      if (typeof handle.sync === 'function') await handle.sync();
    } catch (error) {
      if (!isUnsupportedDirectoryFsync(error)) throw error;
    } finally {
      await closeQuietly(handle);
    }
  }

  async function atomicWrite(state) {
    const validated = parseState(state);
    await inspectDirectory();
    const temporaryPath = `${resolvedStatePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      if (typeof handle.writeFile !== 'function') throw new StateStoreError('fs handle.writeFile is required');
      await handle.writeFile(serializeState(validated), 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
      await closeQuietly(handle);
      handle = null;

      const temporaryStats = await fs.lstat(temporaryPath);
      if (temporaryStats.isSymbolicLink?.() || !temporaryStats.isFile?.()) {
        throw new StateOwnershipError('temporary state file must be regular');
      }
      if ((temporaryStats.mode & 0o777) !== 0o600) {
        throw new StateOwnershipError('temporary state file must be mode 0600');
      }
      if (mustBeRootOwned && (temporaryStats.uid !== 0 || temporaryStats.gid !== 0)) {
        throw new StateOwnershipError('temporary state file must be root-owned');
      }

      await fs.rename(temporaryPath, resolvedStatePath);
      await syncParentDirectory();
    } catch (error) {
      await closeQuietly(handle);
      try {
        await fs.unlink(temporaryPath);
      } catch (unlinkError) {
        if (!isNotFound(unlinkError)) {
          // The original error is more useful and the old state remains intact.
        }
      }
      throw error;
    }
    return clone(validated);
  }

  async function acquireLock() {
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      let handle;
      let created = false;
      try {
        handle = await fs.open(lockPath, 'wx', 0o600);
        created = true;
        if (typeof handle.writeFile !== 'function') {
          throw new StateStoreError('fs lock handle.writeFile is required');
        }
        const metadata = await lockMetadata();
        await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
        if (typeof handle.sync === 'function') await handle.sync();
        return { handle, token: metadata.token };
      } catch (error) {
        await closeQuietly(handle);
        if (created) {
          try {
            await fs.unlink(lockPath);
          } catch (unlinkError) {
            if (!isNotFound(unlinkError)) throw unlinkError;
          }
        }
        if (!isAlreadyExists(error)) throw error;
        const observed = await readLockFile();
        if (await reclaimStaleLock(observed)) continue;
        if (Date.now() >= deadline) throw new StateLockError();
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      }
    }
  }

  async function releaseLock(lock) {
    await closeQuietly(lock?.handle);
    let observed;
    try {
      observed = await readLockFile();
    } catch {
      return;
    }
    if (observed?.metadata?.token !== lock?.token) return;
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async function withMutationLock(operation) {
    await inspectDirectory();
    const lock = await acquireLock();
    try {
      return await operation();
    } finally {
      await releaseLock(lock);
    }
  }

  async function create({ armed = false, at, now: optionNow } = {}) {
    const timestamp = resolveNow(at ?? optionNow ?? now);
    return withMutationLock(async () => {
      const existing = await readUnlocked();
      if (existing) return clone(existing);
      const initial = createInitialState(timestamp, { armed });
      return atomicWrite(initial);
    });
  }

  async function read() {
    return readUnlocked();
  }

  async function get() {
    return read();
  }

  async function update(options = {}, positionalPatch, positionalOptions = {}) {
    const normalizedOptions = Number.isSafeInteger(options)
      ? { ...positionalOptions, expectedGeneration: options, patch: positionalPatch }
      : options;
    const {
      expectedPhase,
    } = normalizedOptions ?? {};
    const expectedGeneration = normalizedOptions?.expectedGeneration ?? normalizedOptions?.generation;
    const patch = normalizedOptions?.patch ?? normalizedOptions?.changes ?? {};
    assertExpectedGeneration(expectedGeneration);
    const timestamp = resolveNow(normalizedOptions?.at ?? normalizedOptions?.now ?? now);
    const normalizedPatch = normalizePatch(patch);
    return withMutationLock(async () => {
      const current = await readUnlocked();
      if (!current) throw new StateNotFoundError();
      if (current.generation !== expectedGeneration) throw new StaleGenerationError();
      if (expectedPhase !== undefined && current.phase !== expectedPhase) {
        throw new StatePhaseMismatchError();
      }
      const nextPhase = normalizedPatch.phase ?? current.phase;
      const nextArmed = normalizedPatch.armed ?? current.armed;
      if (
        current.armed === true
        && nextArmed === false
        && (current.phase === PHASES.DNS_COMMITTING || nextPhase === PHASES.DNS_COMMITTING)
      ) {
        throw new DnsCommitDisarmError();
      }
      const next = {
        ...current,
        ...clone(normalizedPatch),
        generation: current.generation + 1,
        updatedAt: timestamp,
      };
      return atomicWrite(next);
    });
  }

  async function updateIfGeneration(expectedGeneration, patch, options = {}) {
    return update({ ...options, expectedGeneration, patch });
  }

  async function updateIfPhase(expectedGeneration, expectedPhase, patch, options = {}) {
    return update({ ...options, expectedGeneration, expectedPhase, patch });
  }

  async function conditionalUpdate(options) {
    return update(options);
  }

  async function claimReplayFingerprint(fingerprint, options = {}) {
    const normalizedOptions = Number.isSafeInteger(options)
      ? { expectedGeneration: options }
      : options;
    const expectedGeneration = normalizedOptions?.expectedGeneration ?? normalizedOptions?.generation;
    const normalizedFingerprint = normalizeFingerprint(fingerprint, 'fingerprint', { nullable: false });
    if (expectedGeneration !== undefined) assertExpectedGeneration(expectedGeneration);
    const timestamp = resolveNow(normalizedOptions?.at ?? normalizedOptions?.now ?? now);
    return withMutationLock(async () => {
      let current = await readUnlocked();
      if (!current) {
        if (expectedGeneration !== undefined && expectedGeneration !== 0) {
          throw new StaleGenerationError();
        }
        current = await atomicWrite(createInitialState(timestamp));
      }
      if (expectedGeneration !== undefined && current.generation !== expectedGeneration) {
        throw new StaleGenerationError();
      }
      if (current.replayFingerprints.includes(normalizedFingerprint)) {
        return {
          claimed: false,
          state: clone(current),
          generation: current.generation,
        };
      }
      const replayFingerprints = [
        ...current.replayFingerprints,
        normalizedFingerprint,
      ].slice(-MAX_REPLAY_FINGERPRINTS);
      const next = {
        ...current,
        generation: current.generation + 1,
        currentEventFingerprint: current.phase === PHASES.AWS_ACTIVE
          ? normalizedFingerprint
          : current.currentEventFingerprint,
        lastEventFingerprint: normalizedFingerprint,
        replayFingerprints,
        updatedAt: timestamp,
      };
      const state = await atomicWrite(next);
      return { claimed: true, state, generation: state.generation };
    });
  }

  async function hasProcessedFingerprint(fingerprint) {
    const normalizedFingerprint = normalizeFingerprint(fingerprint, 'fingerprint', { nullable: false });
    const current = await readUnlocked();
    return Boolean(current?.replayFingerprints.includes(normalizedFingerprint));
  }

  async function startupRecovery() {
    const state = await readUnlocked();
    if (!state) {
      return {
        state: undefined,
        pendingIncident: null,
        dnsCommitting: false,
        canPromoteToFallback: false,
      };
    }
    return {
      state: clone(state),
      pendingIncident: state.phase === PHASES.VERIFYING || state.phase === PHASES.DNS_COMMITTING
        ? clone(state.pendingIncident)
        : null,
      dnsCommitting: state.phase === PHASES.DNS_COMMITTING,
      canPromoteToFallback: false,
    };
  }

  return {
    statePath: resolvedStatePath,
    parentDir: resolvedParentDir,
    lockPath,
    create,
    initialize: create,
    ensure: create,
    read,
    load: read,
    get,
    update,
    conditionalUpdate,
    updateIfGeneration,
    updateIfPhase,
    claimReplayFingerprint,
    hasProcessedFingerprint,
    startupRecovery,
    recover: startupRecovery,
  };
}

export const createFileStateStore = createStateStore;
