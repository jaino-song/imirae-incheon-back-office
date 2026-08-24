import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialState } from '../src/constants.mjs';
import {
  createDynamoStateStore,
  createMemoryStateStore,
  marshallItem,
  unmarshallItem,
} from '../src/state-store.mjs';

const NOW = Date.parse('2026-08-24T00:00:00.000Z');

class GetItemCommand {
  constructor(input) { this.input = input; }
}

class PutItemCommand {
  constructor(input) { this.input = input; }
}

class UpdateItemCommand {
  constructor(input) { this.input = input; }
}

class TransactWriteItemsCommand {
  constructor(input) { this.input = input; }
}

function commands() {
  return { GetItemCommand, PutItemCommand, UpdateItemCommand, TransactWriteItemsCommand };
}

test('Dynamo state store uses generation and lease-owner conditions for every write', async () => {
  let item;
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof GetItemCommand) return { Item: item };
      if (command instanceof PutItemCommand) {
        item = command.input.Item;
        return {};
      }
      if (command instanceof UpdateItemCommand) {
        const state = unmarshallItem(item);
        state.leaseOwner = null;
        state.leaseExpiresAt = 0;
        state.updatedAt = NOW + 10;
        item = marshallItem(state);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  const store = createDynamoStateStore({
    client,
    commands: commands(),
    tableName: 'state-table',
    stateKey: 'db-failover/preview',
  });

  const first = await store.get();
  assert.equal(first, undefined);
  const lease = await store.acquireLease({ owner: 'worker-1', now: NOW, leaseMs: 1_000 });
  assert.equal(lease.acquired, true);
  assert.equal(lease.generation, 1);
  assert.equal(lease.state.leaseOwner, 'worker-1');

  const putForLease = calls.find((call) => call instanceof PutItemCommand);
  assert.match(putForLease.input.ConditionExpression, /attribute_not_exists/);
  assert.match(putForLease.input.ConditionExpression, /#generation = :expectedGeneration/);
  assert.match(putForLease.input.ConditionExpression, /#leaseExpiresAt <= :now/);
  assert.match(putForLease.input.ConditionExpression, /#leaseOwner = :owner/);

  await store.save({ ...lease.state, controlPlaneError: 'TEST' }, { owner: 'worker-1', generation: 1, now: NOW + 10 });
  const putForSave = calls.filter((call) => call instanceof PutItemCommand).at(-1);
  assert.match(putForSave.input.ConditionExpression, /#generation = :generation/);
  assert.match(putForSave.input.ConditionExpression, /#leaseOwner = :owner/);
  assert.match(putForSave.input.ConditionExpression, /#leaseExpiresAt > :now/);

  await store.releaseLease({ owner: 'worker-1', generation: 1, now: NOW + 10 });
  const release = calls.find((call) => call instanceof UpdateItemCommand);
  assert.match(release.input.ConditionExpression, /#generation = :generation/);
  assert.match(release.input.ConditionExpression, /#leaseOwner = :owner/);
  assert.equal((await store.get()).leaseOwner, null);
});

test('Dynamo conditional lease races fail closed and expose the current holder', async () => {
  const current = {
    ...createInitialState(NOW),
    stateKey: 'db-failover/preview',
    leaseOwner: 'worker-2',
    leaseExpiresAt: NOW + 10_000,
  };
  const client = {
    async send(command) {
      if (command instanceof GetItemCommand) return { Item: marshallItem(current) };
      throw Object.assign(new Error('conditional race'), { name: 'ConditionalCheckFailedException' });
    },
  };
  const store = createDynamoStateStore({
    client,
    commands: commands(),
    tableName: 'state-table',
    stateKey: 'db-failover/preview',
  });
  const result = await store.acquireLease({ owner: 'worker-1', now: NOW, leaseMs: 1_000 });
  assert.equal(result.acquired, false);
  assert.equal(result.state.leaseOwner, 'worker-2');
});

test('Dynamo replay claim and mirrored state are one transaction with no TTL', async () => {
  const fingerprint = 'a'.repeat(64);
  const calls = [];
  const current = {
    ...createInitialState(NOW),
    stateKey: 'db-failover/preview',
    generation: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: NOW + 1_000,
  };
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof TransactWriteItemsCommand) return {};
      if (command instanceof GetItemCommand) {
        const requestedKey = command.input.Key.stateKey.S;
        return requestedKey === current.stateKey ? { Item: marshallItem(current) } : {};
      }
      throw new Error('unexpected command');
    },
  };
  const store = createDynamoStateStore({
    client,
    commands: commands(),
    tableName: 'state-table',
    stateKey: current.stateKey,
  });
  const next = { ...current, lastSentryEventFingerprint: fingerprint };
  await store.saveAndMarkFingerprint(next, {
    owner: 'worker-1',
    generation: 1,
    now: NOW,
    fingerprint,
  });
  const transaction = calls.find((call) => call instanceof TransactWriteItemsCommand);
  assert.equal(transaction.input.ReturnCancellationReasons, true);
  assert.equal(transaction.input.TransactItems.length, 2);
  assert.match(transaction.input.TransactItems[0].Put.ConditionExpression, /#leaseOwner = :owner/);
  assert.match(transaction.input.TransactItems[1].Put.ConditionExpression, /attribute_not_exists/);
  assert.equal('ttl' in transaction.input.TransactItems[1].Put.Item, false);
  assert.equal(transaction.input.TransactItems[1].Put.Item.replayFingerprint.S, fingerprint);
});

test('Dynamo replay transaction cancellation distinguishes duplicate claims from retryable state races', async () => {
  const fingerprint = 'b'.repeat(64);
  let mode = 'duplicate';
  const client = {
    async send(command) {
      if (command instanceof TransactWriteItemsCommand) {
        if (mode === 'duplicate') {
          throw Object.assign(new Error('duplicate'), {
            name: 'TransactionCanceledException',
            CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
          });
        }
        throw Object.assign(new Error('lease race'), {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
        });
      }
      throw new Error('unexpected command');
    },
  };
  const store = createDynamoStateStore({
    client,
    commands: commands(),
    tableName: 'state-table',
    stateKey: 'db-failover/preview',
  });
  const state = { ...createInitialState(NOW), stateKey: 'db-failover/preview' };
  await assert.rejects(
    store.saveAndMarkFingerprint(state, {
      owner: 'worker-1',
      generation: 1,
      now: NOW,
      fingerprint,
    }),
    (error) => error.name === 'ReplayFingerprintExistsError',
  );
  mode = 'lease';
  await assert.rejects(
    store.saveAndMarkFingerprint(state, {
      owner: 'worker-1',
      generation: 1,
      now: NOW,
      fingerprint,
    }),
    (error) => error.name === 'ConditionalStateWriteError' && error.retryable === true,
  );
});

test('host mirror save alias preserves the lease-only conditional write boundary', async () => {
  let item = marshallItem({
    ...createInitialState(NOW),
    stateKey: 'db-failover/preview',
    generation: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: NOW + 1_000,
  });
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof PutItemCommand) {
        item = command.input.Item;
        return {};
      }
      if (command instanceof GetItemCommand) return { Item: item };
      throw new Error('unexpected command');
    },
  };
  const store = createDynamoStateStore({
    client,
    commands: commands(),
    tableName: 'state-table',
    stateKey: 'db-failover/preview',
  });
  await store.saveHostMirror({
    ...createInitialState(NOW),
    stateKey: 'db-failover/preview',
    generation: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: NOW + 1_000,
    hostGeneration: 4,
    phase: 'DIRECT_ACTIVE',
    activeRoute: 'DIRECT',
  }, { owner: 'worker-1', generation: 1, now: NOW });
  const write = calls.find((call) => call instanceof PutItemCommand);
  assert.match(write.input.ConditionExpression, /#generation = :generation/);
  assert.equal(write.input.Item.hostGeneration.N, '4');
  assert.equal(write.input.Item.activeRoute.S, 'DIRECT');
});

test('memory host mirror transaction alias retains replay atomicity', async () => {
  const store = createMemoryStateStore({ now: NOW });
  const current = store.snapshot();
  const lease = await store.acquireLease({ owner: 'worker-1', now: NOW, leaseMs: 1_000 });
  const fingerprint = 'c'.repeat(64);
  await store.saveHostMirrorAndMarkFingerprint({
    ...current,
    ...lease.state,
    hostGeneration: 1,
    lastHostResult: 'shared_healthy',
  }, {
    owner: 'worker-1',
    generation: lease.generation,
    now: NOW,
    fingerprint,
  });
  assert.equal(store.snapshot().hostGeneration, 1);
  assert.equal(await store.hasProcessedFingerprint(fingerprint), true);
});
