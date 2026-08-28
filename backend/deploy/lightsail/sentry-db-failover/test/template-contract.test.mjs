import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const template = await readFile(new URL('../template.yaml', import.meta.url), 'utf8');
const oidcTemplate = await readFile(new URL('../../github-oidc-ssm.yaml', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../../../../.github/workflows/db-failover-infra.yml', import.meta.url), 'utf8');
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const {
  CONTROL_PLANE_DEGRADED_METRIC_DIMENSIONS,
  CONTROL_PLANE_DEGRADED_METRIC_NAME,
  CONTROL_PLANE_DEGRADED_METRIC_NAMESPACE,
  TERMINAL_STATE_METRIC_DIMENSIONS,
  TERMINAL_STATE_METRIC_NAME,
  TERMINAL_STATE_METRIC_NAMESPACE,
} = await import('../src/worker.mjs');

function section(name, nextName) {
  const start = template.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing template section: ${name}`);
  const end = nextName ? template.indexOf(`  ${nextName}:`, start + 1) : template.length;
  return template.slice(start, end === -1 ? template.length : end);
}

test('SAM template defines the disabled-by-default control-plane topology', () => {
  assert.match(template, /Transform: AWS::Serverless-2016-10-31/);
  assert.match(template, /EnableFailover:[\s\S]*?Default: 'false'/);
  assert.match(template, /ReceiverFunction:[\s\S]*?ProvisionedConcurrencyConfig:/);
  assert.match(template, /Path: \/sentry\/webhook/);
  assert.match(template, /FailoverQueue:[\s\S]*?FifoQueue: true/);
  assert.match(template, /FailoverDlq:[\s\S]*?FifoQueue: true/);
  assert.match(template, /RedrivePolicy:[\s\S]*?deadLetterTargetArn: !GetAtt FailoverDlq\.Arn/);
  assert.match(template, /FailoverStateTable:[\s\S]*?PointInTimeRecoveryEnabled: true/);
  assert.match(template, /Schedule: rate\(1 minute\)/);
  assert.match(template, /AlarmTopicArn:/);
  assert.match(template, /AlarmTopicRequiredWhenFailoverEnabled:/);
  assert.match(template, /SentryClientSecretName:/);
  assert.doesNotMatch(template, /SentryClientSecretArn/);
  assert.match(template, /SentryAllowedResources:[\s\S]*?Default: metric_alert/);
  assert.match(template, /SentryAllowedActions:[\s\S]*?Default: critical/);
  assert.match(template, /FixedFailoverDocumentArn:/);
  assert.match(template, /ManagedNodeTagValue:/);
  assert.match(template, /preview:[\s\S]*?FailoverDocumentName:[\s\S]*?production:[\s\S]*?FailoverDocumentName:/);
  assert.doesNotMatch(template, /ManagedNodeTagValue: babyjamjam-(?:preview|production)/);
  assert.doesNotMatch(template, /AWS::SSM::Document/);
});

test('SAM API uses the object endpoint schema and the supported Lambda runtime', () => {
  const api = section('FailoverApi', 'ReceiverRole');
  assert.match(api, /EndpointConfiguration:\n\s+Type: REGIONAL/);
  assert.doesNotMatch(api, /EndpointConfiguration:\s+REGIONAL(?:\s|$)/);
  assert.match(template, /Globals:\n\s+Function:\n\s+Runtime: nodejs22\.x/);
  assert.doesNotMatch(template, /Runtime:\s+nodejs20\.x/);
});

test('SAM control-plane package metadata is npm-pack compatible for Node.js 22', () => {
  assert.match(packageMetadata.name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.equal(packageMetadata.version, '0.0.0');
  assert.equal(packageMetadata.private, true);
  assert.equal(packageMetadata.engines?.node, '>=22');
});

test('receiver IAM can enqueue, read the secret, and claim only durable replay fingerprints', () => {
  const receiver = section('ReceiverRole', 'WorkerRole');
  assert.match(receiver, /sqs:SendMessage/);
  assert.match(receiver, /Resource: !GetAtt FailoverQueue\.Arn/);
  assert.match(receiver, /secretsmanager:GetSecretValue/);
  assert.match(receiver, /Resource: !Sub arn:\$\{AWS::Partition\}:secretsmanager:\$\{AWS::Region\}:\$\{AWS::AccountId\}:secret:\$\{SentryClientSecretName\}-\?\?\?\?\?\?/);
  assert.match(receiver, /dynamodb:GetItem/);
  assert.match(receiver, /dynamodb:PutItem/);
  assert.match(receiver, /Resource: !GetAtt FailoverStateTable\.Arn/);
  const replayAccess = receiver
    .split(/\n\s+- Sid: /)
    .find((statement) => statement.includes('ReadWriteOnlyDisabledReplayFingerprints'));
  assert.ok(replayAccess, 'receiver replay access statement is present');
  assert.match(
    replayAccess,
    /Condition:\s*\n\s+ForAllValues:StringLike:\s*\n\s+dynamodb:LeadingKeys:\s*\n\s+- replay\/\*/,
  );
  assert.doesNotMatch(replayAccess, /db-failover\/(?:preview|production)/);
  assert.doesNotMatch(receiver, /dynamodb:UpdateItem/);
  assert.doesNotMatch(receiver, /dynamodb:TransactWriteItems/);
  assert.doesNotMatch(receiver, /ssm:SendCommand/);
});

test('worker IAM is restricted to state, fixed SSM invocation, status read, and logs', () => {
  const worker = section('WorkerRole', 'ReceiverFunction');
  assert.match(worker, /dynamodb:GetItem/);
  assert.match(worker, /dynamodb:PutItem/);
  assert.match(worker, /dynamodb:UpdateItem/);
  assert.match(worker, /dynamodb:TransactWriteItems/);
  assert.match(worker, /sqs:ReceiveMessage/);
  assert.match(worker, /sqs:DeleteMessage/);
  assert.match(worker, /sqs:GetQueueAttributes/);
  assert.match(worker, /Resource: !GetAtt FailoverQueue\.Arn/);
  assert.match(worker, /ssm:SendCommand/);
  assert.match(worker, /ssm:resourceTag\/DeploymentTarget:/);
  assert.doesNotMatch(worker, /ssm:resourceTag\/Environment/);
  assert.match(worker, /ssm:ListCommandInvocations/);
  const sendCommandStatements = worker
    .split(/\n\s+- Sid: /)
    .filter((statement) => statement.includes('Action: ssm:SendCommand'));
  assert.equal(sendCommandStatements.length, 2);
  for (const statement of sendCommandStatements) {
    assert.doesNotMatch(statement, /Resource:\s*'\*'/);
    assert.doesNotMatch(statement, /AWS-Run(?:ShellScript|Document)/);
  }
  assert.match(worker, /NeverMutateDocuments/);
  assert.doesNotMatch(worker, /secretsmanager:/);
  assert.doesNotMatch(worker, /lightsail:/);
  assert.doesNotMatch(worker, /AWS-RunShellScript/);
});

test('worker Lambda has no Sentry secret environment variable', () => {
  const receiver = section('ReceiverFunction', 'WorkerFunction');
  const worker = section('WorkerFunction', 'ReceiverErrorsAlarm');
  assert.match(receiver, /SENTRY_CLIENT_SECRET_NAME: !Ref SentryClientSecretName/);
  assert.match(receiver, /FAILOVER_STATE_TABLE_NAME: !Ref FailoverStateTable/);
  assert.doesNotMatch(receiver, /SENTRY_CLIENT_SECRET_ARN/);
  assert.doesNotMatch(worker, /SENTRY_CLIENT_SECRET_ARN/);
  assert.match(worker, /FAILOVER_DOCUMENT_ARN:/);
});

test('SAM and the shared OIDC stack target only the one managed Lightsail node', () => {
  const sharedTarget = 'babyjamjam-admin-server';
  assert.match(oidcTemplate, new RegExp(`ManagedNodeTagValue:[\\s\\S]*?Default: ${sharedTarget}`));
  assert.match(oidcTemplate, new RegExp(`AllowedValues:[\\s\\S]*?- ${sharedTarget}`));
  assert.match(template, new RegExp(`ManagedNodeTagValue:[\\s\\S]*?Default: ${sharedTarget}`));
  assert.match(template, /FAILOVER_MANAGED_NODE_TAG_VALUE: !Ref ManagedNodeTagValue/);
  assert.match(template, new RegExp(`ssm:resourceTag/DeploymentTarget: !Ref ManagedNodeTagValue`));
  assert.doesNotMatch(template, /ssm:resourceTag\/Environment|tag:Environment/);
  assert.doesNotMatch(oidcTemplate, /ssm:resourceTag\/Environment|tag:Environment/);

  for (const environment of ['preview', 'production']) {
    assert.match(workflow, new RegExp(`EnvironmentType=${environment}`));
    assert.match(workflow, /MANAGED_NODE_TAG_VALUE: babyjamjam-admin-server/);
    assert.match(workflow, /ManagedNodeTagValue="\$MANAGED_NODE_TAG_VALUE"/);
  }
  assert.match(workflow, /github-oidc-ssm\.yaml/);
});

test('receiver, terminal-state, and control-plane degradation alarms use stable, secret-free signals', () => {
  const api = section('FailoverApi', 'ReceiverRole');
  assert.match(api, /Name: !Sub babyjamjam-\$\{EnvironmentType\}-db-failover/);
  assert.match(api, /StageName: !Ref EnvironmentType/);

  const receiverApiAlarm = section('ReceiverApi5xxAlarm', 'ReceiverErrorsAlarm');
  assert.match(receiverApiAlarm, /Namespace: AWS\/ApiGateway/);
  assert.match(receiverApiAlarm, /MetricName: 5XXError/);
  assert.match(receiverApiAlarm, /Name: ApiName/);
  assert.match(receiverApiAlarm, /Name: Stage/);
  assert.match(receiverApiAlarm, /Value: !Sub babyjamjam-\$\{EnvironmentType\}-db-failover/);
  assert.match(receiverApiAlarm, /Value: !Ref EnvironmentType/);

  for (const [resource, stateType] of [
    ['HostTerminalStateAlarm', 'HOST'],
    ['ControlPlaneTerminalStateAlarm', 'CONTROL_PLANE'],
  ]) {
    const nextResource = resource === 'HostTerminalStateAlarm'
      ? 'ControlPlaneTerminalStateAlarm'
      : 'ControlPlaneDegradedAlarm';
    const alarm = section(resource, nextResource);
    assert.match(alarm, /Namespace: BabyJamJam\/DbFailover/);
    assert.match(alarm, /MetricName: TerminalState/);
    assert.match(alarm, /Name: Environment/);
    assert.match(alarm, /Name: StateType/);
    assert.match(alarm, new RegExp(`Value: ${stateType}`));
    assert.match(alarm, /AlarmActions: !If \[HasAlarmTopic/);
  }
  const degradedAlarm = section('ControlPlaneDegradedAlarm', 'WorkerErrorsAlarm');
  assert.match(degradedAlarm, /Namespace: BabyJamJam\/DbFailover/);
  assert.match(degradedAlarm, /MetricName: ControlPlaneDegraded/);
  assert.match(degradedAlarm, /Name: Environment/);
  assert.match(degradedAlarm, /Value: !Ref EnvironmentType/);
  assert.match(degradedAlarm, /Statistic: Sum/);
  assert.match(degradedAlarm, /Period: 60/);
  assert.match(degradedAlarm, /EvaluationPeriods: 1/);
  assert.match(degradedAlarm, /Threshold: 1/);
  assert.match(degradedAlarm, /AlarmActions: !If \[HasAlarmTopic, \[!Ref AlarmTopicArn\], !Ref 'AWS::NoValue'\]/);
  assert.match(template, new RegExp(`Namespace: ${TERMINAL_STATE_METRIC_NAMESPACE.replace('/', '\\/')}`));
  assert.match(template, new RegExp(`MetricName: ${TERMINAL_STATE_METRIC_NAME}`));
  for (const dimension of TERMINAL_STATE_METRIC_DIMENSIONS) {
    assert.match(template, new RegExp(`Name: ${dimension}`));
  }
  assert.match(template, new RegExp(`Namespace: ${CONTROL_PLANE_DEGRADED_METRIC_NAMESPACE.replace('/', '\\/')}`));
  assert.match(template, new RegExp(`MetricName: ${CONTROL_PLANE_DEGRADED_METRIC_NAME}`));
  for (const dimension of CONTROL_PLANE_DEGRADED_METRIC_DIMENSIONS) {
    assert.match(degradedAlarm, new RegExp(`Name: ${dimension}`));
  }
  assert.match(template, /ReceiverErrorsAlarm:/);
  assert.match(template, /WorkerErrorsAlarm:/);
  assert.match(template, /ControlPlaneDegradedAlarm:/);
  assert.match(template, /QueueAgeAlarm:/);
  assert.match(template, /DeadLetterAlarm:/);
});
