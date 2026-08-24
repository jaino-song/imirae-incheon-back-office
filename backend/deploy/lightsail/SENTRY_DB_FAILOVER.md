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
deploying infrastructure. The GitHub workflow requires a manual dispatch,
explicit `enable_deploy=true`, `enable_failover=true`, and a confirmed
read-only live Sentry rule audit; the target GitHub environment must have
protected reviewers configured.

The receiver is the only principal with `secretsmanager:GetSecretValue`, and
only for the same-account, same-region secret named by `SentryClientSecretName`.
The worker has no Secrets Manager, database,
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
4. Parse JSON only after authentication, then require the official metric-alert
   shape: top-level `action`, `installation.uuid`, and
   `data.metric_alert.id`, `organization_id`, and `projects[]`; its nested
   `alert_rule` must provide `id`, `organization_id`, `projects[]`,
   `environment`, `query`, `aggregate`, `time_window`, and `triggers`. The
   configured project must be the only project in both signed project arrays,
   and both signed organization IDs must match the configured organization.
   The exact rule ID and configured environment are mandatory. The signed rule
   scope must use `aggregate: count()`, `time_window: 1`, and exactly one
   `critical` trigger with `alert_threshold: 5`. The `Sentry-Hook-Resource`
   header must be exactly `metric_alert`, and the action must be the allowlisted
   `critical` value.
5. The signed alert-rule query must contain the exact terms
   `db.failover_eligible:true` and `db.route:shared`. A query containing no
   Prisma code, `P2024`, or any non-allowlisted Prisma code term is rejected.
   Mixed eligible/ineligible Prisma code sets are rejected. This is a
   boundary check only; the application remains authoritative for the
   P1001/P1017-only `db.failover_eligible` tag taxonomy. The receiver does not
   require or trust an individual Prisma `issueCode` or a `route` field in the
   webhook body. `Sentry-Hook-Timestamp` freshness is checked independently;
   the timestamp header is not assumed to be covered by the raw-body HMAC.
6. Send a FIFO message before returning `202`. The message contains only the
   body-derived SHA-256 fingerprint, the fixed `db_failover` signal with
   `failoverEligible=true`, allowlisted alert fields, timestamps, and a request
   ID for correlation. It never contains the raw body, secret, DB URL, DB host,
   or shell text. The body fingerprint is the FIFO deduplication ID.

The receiver has one 750 ms end-to-end deadline from handler entry through raw
body decoding, secret retrieval, authentication, allowlists, and durable SQS
enqueue. Remaining budget is passed as an abort signal to Secrets Manager and
SQS; a deadline returns generic `504`, while other secret or queue failures
return generic `503`. A successful durable enqueue returns `202`; invalid input
returns `4xx`. A valid event while the kill switch is off is acknowledged with
`202` and is not queued, avoiding Sentry retries while the stack is
intentionally disabled.

The receiver logs only a correlation/request ID, body fingerprint, and a stable
rejection reason. It never logs the body, signature, secret, queue URL, route
command, or status output.

## Worker and state contract

The worker uses a conditional DynamoDB lease. A competing invocation returns an
SQS partial-batch failure so the FIFO message can be retried; an expired lease
can be claimed by the next invocation. State writes are conditional on both
`generation` and lease owner. Each authenticated body fingerprint is stored as
one separate item in the existing state table with no TTL. The fingerprint item
and the mirrored state update are written together with DynamoDB
`TransactWriteItems`; a failed transaction leaves neither durable claim nor
state update. The body-derived fingerprint is the replay authority. FIFO
deduplication and request IDs are only optimization/correlation metadata.

The state record includes these operational fields:

```text
generation
phase
activeRoute
leaseExpiresAt
lastSentryEventFingerprint
recentSentryEventFingerprints
directActivatedAt
sharedHealthySince
sharedHealthyCount
cooldownUntil
recentRoundTripCount
recentRoundTripHistory
ssmCommandId
errorTerminalPhase
```

The full implementation also records bounded fingerprint history, probe failure
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
official metric-alert parsing, installation/organization/project/environment/rule
allowlists, signed aggregate/window/threshold scope, query-marker rejection,
FIFO enqueue failures and the end-to-end time budget, durable body-fingerprint
replay beyond 32 events, transaction failure/retry, duplicate races, lease expiry/retry,
conditional state transitions, P1001/P1017 query eligibility, P2024 rejection,
switch/failback budgets, both-down blocking, control-plane preservation, fixed
SSM parameters, and static SAM/IAM contracts.

The GitHub workflow validates, tests, builds, and packages SAM artifacts on
repository changes. It has no automatic deployment path. Preview and production
deployment jobs run only from manual dispatch, require both explicit enable
inputs plus `confirm_sentry_rule_audit=true`, and use the corresponding
protected GitHub environment. The confirmation is a deployment-time, read-only
live Sentry rule audit gate; it does not mutate Sentry. Before checking it,
operators must inspect the exact configured installation, organization, single
project, environment, rule ID, `metric_alert` resource, `critical` action,
`count()` aggregate, one-minute window, critical threshold `5`, and the two
signed query markers. If any property differs or cannot be verified, leave the
kill switch disabled and do not deploy with `enable_failover=true`.

The non-deploying package upload gate uses repository variables
`SAM_PACKAGE_BUCKET` and `AWS_FAILOVER_PACKAGE_ROLE_ARN` on trusted branch
runs; pull requests never receive package-upload OIDC credentials. Manual
deployment additionally requires environment-scoped role variables
`AWS_FAILOVER_PREVIEW_ROLE_ARN` or `AWS_FAILOVER_PRODUCTION_ROLE_ARN`, the
environment's `SENTRY_CLIENT_SECRET_NAME` secret name, and the allowlist variables
shown in the workflow.
