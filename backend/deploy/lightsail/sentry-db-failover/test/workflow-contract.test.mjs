import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../../../../../.github/workflows/db-failover-infra.yml', import.meta.url), 'utf8');

test('workflow action references are immutable commit SHAs', () => {
  const uses = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 3);
  for (const reference of uses) {
    assert.match(reference, /@[0-9a-f]{40}$/i, `unpinned action: ${reference}`);
  }
});
test('workflow validates, tests, builds, and packages without automatic deployment', () => {
  assert.match(workflow, /node --test test\/\*\.test\.mjs/);
  assert.match(workflow, /sam validate --lint/);
  assert.match(workflow, /sam build/);
  assert.match(workflow, /sam package/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /inputs\.enable_deploy == true/);
  assert.match(workflow, /inputs\.enable_failover == true/);
  assert.match(workflow, /environment:\n\s+name: preview/);
  assert.match(workflow, /environment:\n\s+name: production/);
});

test('push and pull request paths contain only validation job triggers', () => {
  const deployConditions = [...workflow.matchAll(/deploy-(?:preview|production):[\s\S]*?if: >-([\s\S]*?)needs:/g)]
    .map((match) => match[1]);
  assert.equal(deployConditions.length, 2);
  for (const condition of deployConditions) {
    assert.match(condition, /workflow_dispatch/);
    assert.match(condition, /enable_deploy/);
    assert.match(condition, /enable_failover/);
  }
});
