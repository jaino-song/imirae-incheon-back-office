# Sentry database failover control plane

This control plane is a disabled-by-default AWS SAM stack for the preview and
production Lightsail environments. It receives an authenticated Sentry metric
alert, durably queues only an opaque alert envelope, and lets a single leased
worker wake the host reconciler once per minute. The Lightsail host owns every
probe, route, phase, counter, and threshold decision. Sentry is a wake-up
signal, never the source of a route decision.

The stack does not contain a database URL, database host, database credential,
deploy command, or arbitrary shell command. The host-side fixed SSM document
owns the probe and route operation. It hardcodes the environment and invokes a
root-owned command equivalent to:

```text
db-reconcile <environment> {{RequestId}}
```

The worker supplies only `RequestId`, an opaque UUID derived deterministically
from the authenticated body fingerprint or the EventBridge event identity. It
persists both that request ID and the returned SSM command ID, validates the
host's complete single-line result envelope, and mirrors it losslessly into
DynamoDB. Lambda never recomputes host counters, thresholds, phases, or routes.

## Resources and environment configuration

`template.yaml` creates:

- a regional API Gateway `POST /sentry/webhook` endpoint;
- a provisioned-concurrency receiver Lambda;
- an encrypted FIFO SQS queue and encrypted FIFO DLQ;
- a single-concurrency worker Lambda and one-minute EventBridge schedule;
- a retained, point-in-time-recoverable DynamoDB state table; and
- API Gateway 5XX, Lambda, SQS, DLQ, and persisted terminal-state CloudWatch
  alarms with an optional SNS topic ARN for dark deploys.

The `EnvironmentType` parameter is restricted to `preview` and `production`.
The mapping supplies separate state keys, Sentry environments, and fixed
document names. Both environments use the one existing managed Lightsail
node, whose shared `DeploymentTarget` tag is fixed to
`babyjamjam-admin-server`:

| Environment | Fixed document name | Shared DeploymentTarget | State key |
| --- | --- | --- | --- |
| `preview` | `babyjamjam-preview-db-failover` | `babyjamjam-admin-server` | `db-failover/preview` |
| `production` | `babyjamjam-production-db-failover` | `babyjamjam-admin-server` | `db-failover/production` |

An exact fixed document ARN can be supplied as a parameter. The worker role
still receives only the selected environment document ARN and the shared
`DeploymentTarget` condition; it does not require an `Environment` tag.

`EnableFailover` defaults to `false`. Keep it false while validating a stack or
performing the Preview/Production dark deploy. The GitHub workflow requires a
manual dispatch and explicit `enable_deploy=true`; it passes the selected
`enable_failover` value to CloudFormation rather than silently forcing it on.
Turning failover on additionally requires `confirm_sentry_rule_audit=true`,
`confirm_alarm_topic=true`, and a non-empty
`DB_FAILOVER_ALARM_TOPIC_ARN` repository variable. The CloudFormation
parameter rule independently rejects `EnableFailover=true` without an
`AlarmTopicArn`. The target GitHub environment must have protected reviewers
configured. The confirmations are only additional human approvals. For both
dark deploy and enablement, before AWS credentials are issued the workflow performs an
authenticated read-only fetch of every configured rule and fails closed on any
unavailable or mismatched response.

The receiver is the only principal with `secretsmanager:GetSecretValue`, and
only for the same-account, same-region secret named by `SentryClientSecretName`.
The receiver has only `dynamodb:GetItem` and `dynamodb:PutItem` on the retained
state table, with `dynamodb:LeadingKeys` restricted to `replay/*`, so it can
read and conditionally claim disabled-mode replay fingerprints but cannot touch
the `db-failover/<environment>` state item. The worker has no Secrets Manager, database,
Lightsail, deploy-document, document-mutation, or arbitrary-shell permission.

## Receiver contract

The receiver deliberately keeps its Lambda/API Gateway path small:

1. Require an unparsed string body. Decode API Gateway base64 only when the
   proxy flag says it is encoded, then reject the decoded body above 64 KiB.
2. Require and parse `Sentry-Hook-Timestamp`, but treat it only as unsigned
   transport sanity. The signed body must provide exactly one current-event
   time from `data.metric_alert.date_detected`, falling back only to
   `date_started` and then `date_created` when an earlier field is absent. Both
   the signed provider time and the header must be within five minutes of
   receipt, and they must agree within that tolerance. A fresh replacement
   header cannot make a stale signed body fresh. The raw body is the exact HMAC
   input; the header is never added to the HMAC input.
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
5. The signed alert-rule query must match one closed canonical form (runs of
   whitespace are normalized):
   `prisma.code:P1001 db.failover_eligible:true db.route:shared`,
   `prisma.code:P1017 db.failover_eligible:true db.route:shared`, or
   `(prisma.code:P1001 OR prisma.code:P1017) db.failover_eligible:true db.route:shared`.
   The grouped form is mandatory when both codes are used because Sentry gives
   `AND` higher precedence than `OR`. Extra clauses, ungrouped or nested `OR`,
   bracketed, wildcard, negated, malformed, aliased, ineligible, or mixed
   expressions are rejected. This is a boundary check only; the
   application remains authoritative for the P1001/P1017-only
   `db.failover_eligible` tag taxonomy. The receiver does not require or trust
   an individual Prisma `issueCode` or a `route` field in the webhook body.
   The signed provider time and durable replay record are the freshness and
   replay authorities; `Sentry-Hook-Timestamp` is not assumed to be covered by
   the raw-body HMAC.
6. When the kill switch is disabled, conditionally persist the authenticated
   body fingerprint in the retained table before returning `202`; duplicate
   conditional claims are idempotent. When enabled, read that same replay
   namespace before queueing and ignore a fingerprint already recorded while
   disabled. Otherwise send a FIFO message before returning `202`. The message contains only the
   body-derived SHA-256 fingerprint, the fixed `db_failover` signal with
   `failoverEligible=true`, allowlisted alert fields, timestamps, and a request
   ID for correlation. It never contains the raw body, secret, DB URL, DB host,
   or shell text. The body fingerprint is the FIFO deduplication ID.

The receiver has one 750 ms end-to-end deadline from handler entry through raw
body decoding, secret retrieval, authentication, allowlists, durable replay
read/claim, and durable SQS enqueue. Remaining budget is passed as an abort
signal to Secrets Manager, DynamoDB, and SQS; a deadline returns generic `504`,
while other secret, replay-store, or queue failures return generic `503`. A
successful durable enqueue or duplicate disabled replay claim returns `202`;
invalid input returns `4xx`. A valid event while the kill switch is off is
durably recorded and acknowledged with `202` without being queued, avoiding
Sentry retries while the stack is intentionally disabled.

Unexpected receiver failures are converted to a generic `503` response with no
internal detail. The API Gateway `5XXError` alarm uses the stable API name
`babyjamjam-<environment>-db-failover` and the fixed environment stage, so
handled 5XX responses remain observable without depending only on Lambda
invocation errors.

The receiver logs only a correlation/request ID, body fingerprint, and a stable
rejection reason. It never logs the body, signature, secret, queue URL, route
command, or status output.

## Worker and state contract

The worker uses a conditional DynamoDB lease. A competing invocation returns an
SQS partial-batch failure so the FIFO message can be retried; an expired lease
can be claimed by the next invocation. State writes are conditional on both
`generation` and lease owner. Each authenticated body fingerprint is stored as
one separate item in the existing state table with no TTL. A disabled receiver
claim is a standalone conditional `PutItem`; an enabled receiver performs only
a consistent `GetItem` before queueing and never pre-claims a legitimate
enabled message. The worker's fingerprint item and mirrored state update are
written together with DynamoDB `TransactWriteItems`; a failed transaction leaves
neither durable claim nor state update. The body-derived fingerprint is the
replay authority. FIFO deduplication and request IDs are only
optimization/correlation metadata.

The state record includes these operational fields:

```text
generation                 # DynamoDB lease/concurrency generation only
hostGeneration             # host-owned monotonic result generation
hostResultSchemaVersion
hostResultSource
phase                      # exact host phase mirror
activeRoute                # exact host route mirror
result                     # exact host result token
sharedOk
directOk
sharedFailureCount
directSuccessCount
directFailureCount
emergencySharedSuccessCount
sharedHealthyCount
directActivatedAt
sharedHealthyStartedAt
sharedHealthyLastAt
cooldownUntil
recentNormalRoundTrips
transition
terminalPhase
terminalReason
lastHostResult
lastHostObservedAt
controlPlaneStatus
controlPlaneError
leaseExpiresAt
lastSentryEventFingerprint
recentSentryEventFingerprints
ssmCommandId
ssmRequestId
ssmRequestIdentity
```

The host result schema is strict and closed: schema version `1`, source
`babyjamjam-db-failover-host`, the configured environment, the persisted
request UUID, uppercase route/phase values, all counters/timestamps, bounded
normal-round-trip history, the complete transition object, and a terminal
reason for `BLOCKED`/`DEGRADED`. Missing, extra, malformed, wrong-request,
wrong-environment, stale, or out-of-order results are rejected without
changing mirrored host evidence. Host terminal phases stop further SSM calls.
AWS/SSM/Dynamo failures use `controlPlaneStatus`/`controlPlaneError` only and
preserve the last host phase, route, counters, and terminal fields.

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

Each one-minute host observation reports safe `sharedOk`, `directOk`, and
`activeRoute` fields. Both routes failing immediately enters host `BLOCKED`.
AWS/SSM/DynamoDB control-plane errors are separate Lambda control-plane status,
leave the last host `activeRoute` and `phase` unchanged, and never restart or
redeploy the application itself.

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
    {"Key": "tag:DeploymentTarget", "Values": ["babyjamjam-admin-server"]}
  ],
  "Parameters": {"RequestId": ["opaque UUID"]}
}
```

It does not send a route, URL, hostname, shell command, database credential, or
caller-controlled parameter. The worker may list command invocations to read a
status record, but only accepts the exact host result envelope above. A terminal
failed SSM command with a valid host `BLOCKED`/`DEGRADED` envelope is mirrored;
a terminal command without a valid envelope enters a separate control-plane
blocked state and cannot automatically re-command the host.

After the terminal state is persisted, the worker emits one secret-free
CloudWatch Embedded Metric Format record in namespace
`BabyJamJam/DbFailover`, metric `TerminalState`, with dimensions
`Environment` and `StateType` (`HOST` or `CONTROL_PLANE`). The corresponding
CloudWatch alarms monitor those exact dimensions. A valid terminal host result
and a terminal control-plane result are handled successes; they do not rely on
Lambda `Errors` to become visible.

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
conditional state transitions, exact P1001/P1017 query eligibility and bypass
rejection, P2024 rejection,
switch/failback budgets, both-down blocking, control-plane preservation, fixed
SSM parameters, terminal-state metric emission, shared-node cross-stack drift,
and static SAM/IAM contracts.

The GitHub workflow validates, tests, builds, and packages SAM artifacts on
repository changes. It has no automatic deployment path. Preview and production
deployment jobs run only from manual dispatch, require both explicit enable
deploy input and use the corresponding protected GitHub environment. A dark
deploy uses `enable_failover=false`; changing it to true additionally requires
`confirm_sentry_rule_audit=true`, `confirm_alarm_topic=true`, and
`DB_FAILOVER_ALARM_TOPIC_ARN`. The workflow then calls Sentry's read-only
organization alert-rule detail endpoint with an environment-scoped
`SENTRY_API_TOKEN` that has only `alerts:read` and `project:read` (or equivalent
read-only) access. It first proves that `SENTRY_PROJECT_SLUG` maps to the exact
active `SENTRY_PROJECT_ID` in the configured numeric organization. It then
validates every `SENTRY_RULE_IDS` entry against that single project,
environment, unsnoozed state, `count()` aggregate, one-minute window, one
critical trigger at threshold `5`, the exact `SENTRY_INSTALLATION_ID` Sentry
App action, and the failover query grammar before AWS authentication or
deployment. A timeout, non-2xx response, malformed/oversized JSON, missing
field, or mismatch blocks deployment. The human confirmation cannot replace
this fetch and the workflow never mutates Sentry.

Sentry currently marks this legacy alert-rule detail API as private and
deprecated while it migrates metric alerts to its workflow engine. That makes
the audit deliberately fail closed if Sentry changes the endpoint or response
shape; update and re-review the validator before deploying rather than
bypassing it. Operators must still inspect the `metric_alert` resource,
`critical` webhook action, and client-secret association because those
webhook-only fields are not returned by the read-only rule endpoint. If any
property cannot be verified, keep the kill switch disabled.

The non-deploying package upload gate uses repository variables
`SAM_PACKAGE_BUCKET` and `AWS_FAILOVER_PACKAGE_ROLE_ARN` on trusted branch
runs; pull requests never receive package-upload OIDC credentials. Manual
deployment additionally requires environment-scoped role variables
`AWS_FAILOVER_PREVIEW_ROLE_ARN` or `AWS_FAILOVER_PRODUCTION_ROLE_ARN`, the
environment's `SENTRY_CLIENT_SECRET_NAME` secret name, and the allowlist variables
shown in the workflow. Each protected environment also needs the read-only
`SENTRY_API_TOKEN` secret and exact `SENTRY_PROJECT_SLUG` variable for the live
rule audit. The API token is scoped only to its audit step and is never passed
to SAM, AWS, Lambda, or shell arguments.
