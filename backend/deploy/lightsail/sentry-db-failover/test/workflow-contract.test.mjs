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
  assert.match(workflow, /inputs\.confirm_sentry_rule_audit == true/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /SentryClientSecretName/);
  assert.doesNotMatch(workflow, /SENTRY_CLIENT_SECRET_ARN|SentryClientSecretArn/);
  assert.match(workflow, /environment:\n\s+name: preview/);
  assert.match(workflow, /environment:\n\s+name: production/);
});

test('each deploy job performs a live fail-closed Sentry rule audit before AWS authentication', () => {
  for (const environment of ['preview', 'production']) {
    const start = workflow.indexOf(`deploy-${environment}:`);
    assert.notEqual(start, -1);
    const nextJob = workflow.indexOf('\n  deploy-', start + 1);
    const job = workflow.slice(start, nextJob === -1 ? workflow.length : nextJob);

    assert.match(job, /SENTRY_PROJECT_SLUG: \$\{\{ vars\.SENTRY_PROJECT_SLUG \}\}/);
    assert.match(job, /SENTRY_API_TOKEN: \$\{\{ secrets\.SENTRY_API_TOKEN \}\}/);
    assert.match(job, new RegExp(`SENTRY_EXPECTED_ENVIRONMENT: ${environment}`));
    assert.match(job, /node scripts\/audit-sentry-rule\.mjs/);
    assert.doesNotMatch(job, /test "\$RULE_AUDIT_CONFIRMED"/);

    const audit = job.indexOf('node scripts/audit-sentry-rule.mjs');
    const awsAuthentication = job.indexOf('aws-actions/configure-aws-credentials');
    const deploy = job.indexOf('sam deploy');
    assert.ok(audit >= 0 && audit < awsAuthentication && awsAuthentication < deploy);
  }
});

test('push and pull request paths contain only validation job triggers', () => {
  const deployConditions = [...workflow.matchAll(/deploy-(?:preview|production):[\s\S]*?if: >-([\s\S]*?)needs:/g)]
    .map((match) => match[1]);
  assert.equal(deployConditions.length, 2);
  for (const condition of deployConditions) {
    assert.match(condition, /workflow_dispatch/);
    assert.match(condition, /enable_deploy/);
    assert.match(condition, /enable_failover/);
    assert.match(condition, /confirm_sentry_rule_audit/);
  }
});
