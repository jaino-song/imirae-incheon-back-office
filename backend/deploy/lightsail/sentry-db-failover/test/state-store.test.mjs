import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialState } from '../src/constants.mjs';
import {
  createDynamoStateStore,
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

function commands() {
  return { GetItemCommand, PutItemCommand, UpdateItemCommand };
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

  await store.save({ ...lease.state, lastErrorCode: 'TEST' }, { owner: 'worker-1', generation: 1, now: NOW + 10 });
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
