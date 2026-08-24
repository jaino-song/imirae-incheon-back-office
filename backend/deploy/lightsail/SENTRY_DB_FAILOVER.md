# Sentry database failover control plane

This control plane is a disabled-by-default AWS SAM stack for the preview and
production Lightsail environments. It receives an authenticated Sentry metric
alert, durably queues only an opaque alert envelope, and lets a single leased
worker reconcile route state once per minute. Sentry is a wake-up signal, never
the source of a route decision.

The stack does not contain a database URL, database host, database credential,
deploy command, or arbitrary shell command. The host-side fixed SSM document
owns the probe and route operation. It hardcodes the environment and invokes a
root-owned command equivalent to:

```text
db-reconcile <environment> {{RequestId}}
```

The worker supplies only `RequestId`, a newly generated UUID. It reads the
document's status record or command output and mirrors safe health/route fields
into DynamoDB.

## Resources and environment configuration

`template.yaml` creates:

- a regional API Gateway `POST /sentry/webhook` endpoint;
- a provisioned-concurrency receiver Lambda;
- an encrypted FIFO SQS queue and encrypted FIFO DLQ;
- a single-concurrency worker Lambda and one-minute EventBridge schedule;
- a retained, point-in-time-recoverable DynamoDB state table; and
- Lambda, SQS, and DLQ CloudWatch alarms with an optional SNS topic ARN.

The `EnvironmentType` parameter is restricted to `preview` and `production`.
The mapping supplies separate state keys, Sentry environments, managed-node
tag values, and fixed document names:

| Environment | Fixed document name | Managed-node tag value | State key |
| --- | --- | --- | --- |
| `preview` | `babyjamjam-preview-db-failover` | `babyjamjam-preview` | `db-failover/preview` |
| `production` | `babyjamjam-production-db-failover` | `babyjamjam-production` | `db-failover/production` |

An exact document ARN and managed-node tag value can be supplied as
parameters. The worker role still receives only the selected document ARN and
the selected environment tag condition.

`EnableFailover` defaults to `false`. Keep it false while validating a stack or
deploying infrastructure. The GitHub workflow requires both a manual dispatch
and explicit `enable_deploy=true` plus `enable_failover=true`; the target GitHub
environment must have protected reviewers configured.

The receiver is the only principal with `secretsmanager:GetSecretValue`, and
only for `SentryClientSecretArn`. The worker has no Secrets Manager, database,
Lightsail, deploy-document, document-mutation, or arbitrary-shell permission.

## Receiver contract

The receiver deliberately keeps its Lambda/API Gateway path small:

1. Require an unparsed string body. Decode API Gateway base64 only when the
   proxy flag says it is encoded, then reject the decoded body above 64 KiB.
2. Require `Sentry-Hook-Timestamp` and reject an absolute age above five
   minutes. The raw body is the exact HMAC input.
3. Compute HMAC-SHA256 with the Secrets Manager client secret and compare the
   32-byte digest with `Sentry-Hook-Signature` using a fixed-size
   `timingSafeEqual` comparison. Missing, malformed, or tampered signatures are
   rejected.
4. Parse JSON only after authentication, then require exact installation,
   organization, project, Sentry environment, and DB rule ID allowlists. The
   `Sentry-Hook-Resource` header must be exactly `metric_alert`; only the
   allowlisted trigger action `critical` and issue codes `P1001`/`P1017` are
   eligible. `warning`, `resolved`, `P2024`, non-DB rule IDs, direct-route
   events, and wrong environments are ignored. An explicit route in the event
   must be `SHARED`; when Sentry omits route metadata, the worker checks the
   DynamoDB active route before waking reconcile.
5. Send a FIFO message before returning `202`. The message contains only event
   identity, allowlisted alert fields, timestamps, and a request ID. It never
   contains the raw body, secret, DB URL, DB host, or shell text. The event ID
   is the FIFO deduplication ID.

The queue send has a 700 ms timeout to preserve the Sentry one-second webhook
contract and the local p99 gate of 800 ms. A successful durable enqueue returns
`202`; invalid input returns `4xx`; a missing secret or queue failure returns a
`5xx`; a queue timeout returns `504`. A valid event while the kill switch is
off is acknowledged with `202` and is not queued, avoiding Sentry retries while
the stack is intentionally disabled.

The receiver logs only a correlation/request ID, event ID, issue code, and a
stable rejection reason. It never logs the body, signature, secret, queue URL,
route command, or status output.

## Worker and state contract

The worker uses a conditional DynamoDB lease. A competing invocation returns an
SQS partial-batch failure so the FIFO message can be retried; an expired lease
can be claimed by the next invocation. State writes are conditional on both
`generation` and lease owner. Sentry request IDs and event timestamps provide
replay and out-of-order suppression, in addition to FIFO deduplication.

The state record includes these operational fields:

```text
generation
phase
activeRoute
leaseExpiresAt
lastSentryRequestId
directActivatedAt
sharedHealthySince
sharedHealthyCount
cooldownUntil
recentRoundTripCount
recentRoundTripHistory
ssmCommandId
errorTerminalPhase
```

The full implementation also records bounded request-id history, probe failure
counters, last observation time, and a safe error code. The only terminal state
is `BLOCKED`; an operator must investigate and explicitly clear the state
before another automatic switch is possible.

## State machine and gates

| Phase | Meaning and gate |
| --- | --- |
| `SHARED_ACTIVE` | Shared route is active and healthy. |
| `DEGRADED` | Current route is preserved while a health or control-plane gate is unhealthy. |
| `SWITCHING_TO_DIRECT` | Shared has three failures and Direct has three consecutive successes; the fixed document is asked to switch and the next status must confirm Direct. |
| `DIRECT_ACTIVE` | Direct is confirmed active. Direct must remain active for at least one hour before normal failback can begin. |
| `RECOVERING_SHARED` | Direct failed while Shared succeeded three consecutive times; emergency failback is allowed without waiting an hour. |
| `SWITCHING_TO_SHARED` | Normal or emergency failback is in progress; the next status must confirm Shared. |
| `BLOCKED` | Both routes failed, or the six-hour normal round-trip budget was exhausted. No automatic route mutation occurs. |

Each one-minute observation must report safe `sharedOk`, `directOk`, and (when
a switch is complete) `activeRoute` fields. Both routes failing immediately
enters `BLOCKED`. AWS/SSM/DynamoDB control-plane errors enter `DEGRADED`, leave
`activeRoute` unchanged, and never restart or redeploy the application itself.

Normal failback requires Direct to have been active for one hour and 30
consecutive one-minute Shared successes. A completed normal Direct→Shared cycle
is recorded in `recentRoundTripHistory`; entries older than six hours are
pruned. The third normal cycle inside six hours enters `BLOCKED`. Emergency
failback does not consume the normal round-trip budget.

## Fixed SSM and output boundary

The worker's `SendCommand` request has exactly these control-plane fields:

```json
{
  "DocumentName": "the fixed preview or production document ARN",
  "Targets": [
    {"Key": "tag:DeploymentTarget", "Values": ["the exact environment value"]},
    {"Key": "tag:Environment", "Values": ["preview or production"]}
  ],
  "Parameters": {"RequestId": ["opaque UUID"]}
}
```

It does not send a route, URL, hostname, shell command, database credential, or
caller-controlled parameter. The worker may list command invocations to read a
status record, but only parses safe booleans, route names, command IDs, and
timestamps. Status output must not include credentials or connection strings.

## Local verification

From this directory:

```bash
node --test test/*.test.mjs
```

The tests cover HMAC and timestamp boundaries, raw-body and size handling,
allowlist rejection, FIFO enqueue failures and time budget, replay and
out-of-order messages, lease expiry/retry, conditional state transitions,
P1001/P1017 eligibility, P2024 rejection, switch/failback budgets, both-down
blocking, control-plane preservation, fixed SSM parameters, and static SAM/IAM
contracts.

The GitHub workflow validates, tests, builds, and packages SAM artifacts on
repository changes. It has no automatic deployment path. Preview and production
deployment jobs run only from manual dispatch, require both explicit enable
inputs, and use the corresponding protected GitHub environment.

The non-deploying package upload gate uses repository variables
`SAM_PACKAGE_BUCKET` and `AWS_FAILOVER_PACKAGE_ROLE_ARN` on trusted branch
runs; pull requests never receive package-upload OIDC credentials. Manual
deployment additionally requires environment-scoped role variables
`AWS_FAILOVER_PREVIEW_ROLE_ARN` or `AWS_FAILOVER_PRODUCTION_ROLE_ARN`, the
environment's `SENTRY_CLIENT_SECRET_ARN` secret, and the allowlist variables
shown in the workflow.
