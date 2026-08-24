import { createInitialState } from './constants.mjs';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function replayStateKey(fingerprint) {
  if (typeof fingerprint !== 'string' || !SHA256_HEX_PATTERN.test(fingerprint)) {
    throw new TypeError('replay fingerprint must be a SHA-256 hex digest');
  }
  return `replay/${fingerprint.toLowerCase()}`;
}
export function marshallValue(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === 'boolean') return { BOOL: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { N: String(value) };
  if (typeof value === 'string') return { S: value };
  if (Array.isArray(value)) return { L: value.map((entry) => marshallValue(entry)) };
  if (typeof value === 'object') {
    return {
      M: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, marshallValue(entry)])),
    };
  }
  throw new TypeError(`unsupported DynamoDB value type: ${typeof value}`);
}

export function marshallItem(item) {
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, marshallValue(value)]));
}

export function unmarshallValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('NULL' in value) return null;
  if ('BOOL' in value) return value.BOOL;
  if ('S' in value) return value.S;
  if ('N' in value) return Number(value.N);
  if ('L' in value) return value.L.map((entry) => unmarshallValue(entry));
  if ('M' in value) return Object.fromEntries(
    Object.entries(value.M).map(([key, entry]) => [key, unmarshallValue(entry)]),
  );
  return undefined;
}

export function unmarshallItem(item) {
  if (!item || typeof item !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, unmarshallValue(value)]),
  );
}

export class ConditionalStateWriteError extends Error {
  constructor(message = 'conditional state write failed') {
    super(message);
    this.name = 'ConditionalStateWriteError';
    this.code = 'CONDITIONAL_STATE_WRITE_FAILED';
    this.retryable = true;
  }
}

export class ReplayFingerprintExistsError extends Error {
  constructor() {
    super('replay fingerprint already exists');
    this.name = 'ReplayFingerprintExistsError';
    this.code = 'REPLAY_FINGERPRINT_EXISTS';
    this.retryable = false;
  }
}

function isConditionalFailure(error) {
  return error?.name === 'ConditionalCheckFailedException'
    || error?.code === 'ConditionalCheckFailedException';
}

export function createDynamoStateStore({ client, commands, tableName, stateKey }) {
  if (!client || typeof client.send !== 'function') throw new TypeError('DynamoDB client is required');
  if (
    !commands?.GetItemCommand
    || !commands?.PutItemCommand
    || !commands?.UpdateItemCommand
    || !commands?.TransactWriteItemsCommand
  ) {
    throw new TypeError('DynamoDB command constructors are required');
  }
  if (!tableName || !stateKey) throw new TypeError('state table name and key are required');

  const key = { stateKey: { S: stateKey } };

  async function getByKey(itemKey) {
    const response = await client.send(new commands.GetItemCommand({
      TableName: tableName,
      Key: { stateKey: { S: itemKey } },
      ConsistentRead: true,
    }));
    return unmarshallItem(response.Item);
  }

  async function get() {
    return getByKey(stateKey);
  }

  async function hasProcessedFingerprint(fingerprint) {
    return Boolean(await getByKey(replayStateKey(fingerprint)));
  }

  async function acquireLease({ owner, now, leaseMs }) {
    const existing = (await get()) ?? { ...createInitialState(now), stateKey };
    const leaseAvailable = existing.leaseExpiresAt <= now || existing.leaseOwner === owner;
    if (!leaseAvailable) return { acquired: false, state: existing };

    const next = {
      ...existing,
      stateKey,
      generation: (existing.generation ?? 0) + 1,
      leaseOwner: owner,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
    };
    try {
      await client.send(new commands.PutItemCommand({
        TableName: tableName,
        Item: marshallItem(next),
        ConditionExpression: 'attribute_not_exists(#stateKey) OR (#generation = :expectedGeneration AND (#leaseExpiresAt <= :now OR #leaseOwner = :owner))',
        ExpressionAttributeNames: {
          '#stateKey': 'stateKey',
          '#generation': 'generation',
          '#leaseExpiresAt': 'leaseExpiresAt',
          '#leaseOwner': 'leaseOwner',
        },
        ExpressionAttributeValues: {
          ':expectedGeneration': { N: String(existing.generation ?? 0) },
          ':now': { N: String(now) },
          ':owner': { S: owner },
        },
      }));
      return { acquired: true, state: next, generation: next.generation };
    } catch (error) {
      if (isConditionalFailure(error)) {
        return { acquired: false, state: (await get()) ?? existing };
      }
      throw error;
    }
  }

  async function save(state, { owner, generation, now: at = Date.now() }) {
    const next = { ...state, stateKey };
    try {
      await client.send(new commands.PutItemCommand({
        TableName: tableName,
        Item: marshallItem(next),
        ConditionExpression: '#generation = :generation AND #leaseOwner = :owner AND #leaseExpiresAt > :now',
        ExpressionAttributeNames: {
          '#generation': 'generation',
          '#leaseOwner': 'leaseOwner',
          '#leaseExpiresAt': 'leaseExpiresAt',
        },
        ExpressionAttributeValues: {
          ':generation': { N: String(generation) },
          ':owner': { S: owner },
          ':now': { N: String(at) },
        },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) throw new ConditionalStateWriteError();
      throw error;
    }
  }

  async function saveAndMarkFingerprint(
    state,
    { owner, generation, now: at = Date.now(), fingerprint },
  ) {
    const replayKey = replayStateKey(fingerprint);
    const next = { ...state, stateKey };
    try {
      await client.send(new commands.TransactWriteItemsCommand({
        ReturnCancellationReasons: true,
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: marshallItem(next),
              ConditionExpression: '#generation = :generation AND #leaseOwner = :owner AND #leaseExpiresAt > :now',
              ExpressionAttributeNames: {
                '#generation': 'generation',
                '#leaseOwner': 'leaseOwner',
                '#leaseExpiresAt': 'leaseExpiresAt',
              },
              ExpressionAttributeValues: {
                ':generation': { N: String(generation) },
                ':owner': { S: owner },
                ':now': { N: String(at) },
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                stateKey: { S: replayKey },
                replayFingerprint: { S: fingerprint.toLowerCase() },
              },
              ConditionExpression: 'attribute_not_exists(#stateKey)',
              ExpressionAttributeNames: { '#stateKey': 'stateKey' },
            },
          },
        ],
      }));
    } catch (error) {
      const replayReason = error?.CancellationReasons?.[1];
      if (replayReason?.Code === 'ConditionalCheckFailed') {
        throw new ReplayFingerprintExistsError();
      }
      if (isConditionalFailure(error) || error?.name === 'TransactionCanceledException') {
        throw new ConditionalStateWriteError();
      }
      throw error;
    }
  }

  async function releaseLease({ owner, generation, now }) {
    try {
      await client.send(new commands.UpdateItemCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #leaseOwner = :none, #leaseExpiresAt = :zero, #updatedAt = :now',
        ConditionExpression: '#generation = :generation AND #leaseOwner = :owner',
        ExpressionAttributeNames: {
          '#generation': 'generation',
          '#leaseOwner': 'leaseOwner',
          '#leaseExpiresAt': 'leaseExpiresAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':generation': { N: String(generation) },
          ':owner': { S: owner },
          ':none': { NULL: true },
          ':zero': { N: '0' },
          ':now': { N: String(now) },
        },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) throw new ConditionalStateWriteError('lease release lost ownership');
      throw error;
    }
  }

  // Host mirrors use the same lease-conditional writes as every other control
  // update. The Sentry path additionally uses the replay transaction below so
  // a host mirror and its durable body claim commit or roll back together.
  async function saveHostMirror(state, options) {
    return save(state, options);
  }

  async function saveHostMirrorAndMarkFingerprint(state, options) {
    return saveAndMarkFingerprint(state, options);
  }

  return {
    get,
    hasProcessedFingerprint,
    acquireLease,
    save,
    saveAndMarkFingerprint,
    saveHostMirror,
    saveHostMirrorAndMarkFingerprint,
    releaseLease,
  };
}

export function createMemoryStateStore({ initialState, now = Date.now() } = {}) {
  let current = clone(initialState ?? { ...createInitialState(now), stateKey: 'db-failover' });
  const replayFingerprints = new Set();

  return {
    async get() {
      return clone(current);
    },
    async acquireLease({ owner, now: at, leaseMs }) {
      if (current.leaseExpiresAt > at && current.leaseOwner !== owner) {
        return { acquired: false, state: clone(current) };
      }
      current = {
        ...current,
        generation: current.generation + 1,
        leaseOwner: owner,
        leaseExpiresAt: at + leaseMs,
        updatedAt: at,
      };
      return { acquired: true, state: clone(current), generation: current.generation };
    },
    async save(state, { owner, generation, now: at = Date.now() }) {
      if (
        current.generation !== generation
        || current.leaseOwner !== owner
        || current.leaseExpiresAt <= at
      ) {
        throw new ConditionalStateWriteError();
      }
      current = clone(state);
    },
    async saveHostMirror(state, options) {
      return this.save(state, options);
    },
    async hasProcessedFingerprint(fingerprint) {
      const key = replayStateKey(fingerprint);
      return replayFingerprints.has(key.slice('replay/'.length));
    },
    async saveAndMarkFingerprint(
      state,
      { owner, generation, now: at = Date.now(), fingerprint },
    ) {
      const normalizedFingerprint = replayStateKey(fingerprint).slice('replay/'.length);
      if (replayFingerprints.has(normalizedFingerprint)) {
        throw new ReplayFingerprintExistsError();
      }
      if (
        current.generation !== generation
        || current.leaseOwner !== owner
        || current.leaseExpiresAt <= at
      ) {
        throw new ConditionalStateWriteError();
      }
      current = clone(state);
      replayFingerprints.add(normalizedFingerprint);
    },
    async saveHostMirrorAndMarkFingerprint(state, options) {
      return this.saveAndMarkFingerprint(state, options);
    },
    async releaseLease({ owner, generation, now: at }) {
      if (current.generation !== generation || current.leaseOwner !== owner) {
        throw new ConditionalStateWriteError('lease release lost ownership');
      }
      current = { ...current, leaseOwner: null, leaseExpiresAt: 0, updatedAt: at };
    },
    snapshot() {
      return clone(current);
    },
  };
}
