import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const template = await readFile(new URL('../template.yaml', import.meta.url), 'utf8');
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

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
  assert.match(template, /SentryClientSecretName:/);
  assert.doesNotMatch(template, /SentryClientSecretArn/);
  assert.match(template, /SentryAllowedResources:[\s\S]*?Default: metric_alert/);
  assert.match(template, /SentryAllowedActions:[\s\S]*?Default: critical/);
  assert.match(template, /FixedFailoverDocumentArn:/);
  assert.match(template, /ManagedNodeTagValue:/);
  assert.match(template, /preview:[\s\S]*?FailoverDocumentName:[\s\S]*?production:[\s\S]*?FailoverDocumentName:/);
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

test('receiver IAM can enqueue and read only the configured Sentry secret', () => {
  const receiver = section('ReceiverRole', 'WorkerRole');
  assert.match(receiver, /sqs:SendMessage/);
  assert.match(receiver, /Resource: !GetAtt FailoverQueue\.Arn/);
  assert.match(receiver, /secretsmanager:GetSecretValue/);
  assert.match(receiver, /Resource: !Sub arn:\$\{AWS::Partition\}:secretsmanager:\$\{AWS::Region\}:\$\{AWS::AccountId\}:secret:\$\{SentryClientSecretName\}-\?\?\?\?\?\?/);
  assert.doesNotMatch(receiver, /ssm:SendCommand/);
  assert.doesNotMatch(receiver, /dynamodb:/);
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
  assert.match(worker, /ssm:resourceTag\/Environment: !Ref EnvironmentType/);
  assert.match(worker, /ssm:resourceTag\/DeploymentTarget:/);
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
  assert.doesNotMatch(receiver, /SENTRY_CLIENT_SECRET_ARN/);
  assert.doesNotMatch(worker, /SENTRY_CLIENT_SECRET_ARN/);
  assert.match(worker, /FAILOVER_DOCUMENT_ARN:/);
});
