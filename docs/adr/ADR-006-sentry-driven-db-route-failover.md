# ADR-006: Sentry-driven database route failover

## Status

Accepted

## Date

2026-08-24

## Context

The backend normally reaches PostgreSQL through the existing Supabase shared
pooler. A shared-pooler incident can make database-backed API requests fail
while the process itself remains alive, so the existing database-independent
`GET /health` endpoint cannot be used as readiness evidence. The existing
`DIRECT_URL` is an independently reachable emergency route, but it consumes
PostgreSQL connections directly and must be bounded before it is activated.

An automatic route change is a production control-plane operation. An
individual Sentry event must not mutate a database route: events can be
duplicated, delayed, or resolved without proving that the failed route has
recovered. Sentry therefore supplies an authenticated signal to an external
reconciler, while the Lightsail host operator owns the authoritative runtime,
phase, counter, and transition policy. The fixed SSM document accepts only the
environment selected by its document identity and an opaque request UUID. The
external reconciler/DynamoDB record validates and mirrors the host's complete
safe result; it never independently chooses or commands a route.

## Decision

### Route selection

1. `DATABASE_CONNECTION_MODE` is the runtime route selector. The only accepted
   values are `shared` and `direct`; an unset or empty value defaults to
   `shared`. `shared` selects the existing `DATABASE_URL`, and `direct`
   selects the existing `DIRECT_URL`.
2. Direct startup parses the selected URL and fails closed unless the parsed
   query contains the literal `connection_limit=5` parameter. The URL,
   hostname, username, password, and query values are never logged, returned
   in an HTTP response, or sent to the Sentry/AWS control plane.
3. Existing shared pooler behavior remains intact: when `pgbouncer=true`, a
   missing `connection_limit` receives the existing default and an optional
   `PRISMA_POOL_TIMEOUT` is applied only when `pool_timeout` is absent.
4. No PostgreSQL schema, Prisma schema, business API, or tenant boundary is
   changed by this decision.

### State machine and ownership

The host operator persists one authoritative root-owned state record per
environment, and the external reconciler keeps a validated DynamoDB mirror.
The host allows only the following active phases:

```text
SHARED_ACTIVE
  -> SWITCHING_TO_DIRECT
  -> DIRECT_ACTIVE
  -> RECOVERING_SHARED
  -> SWITCHING_TO_SHARED
  -> SHARED_ACTIVE
```

Host phases `BLOCKED` and `DEGRADED` are terminal failure states until an
operator performs an explicitly authorized recovery. `BLOCKED` means that
neither route has passed the required probe or the transition budget is
exhausted. Host phase `DEGRADED` means that a route change was attempted but
its compensating restoration also failed. Neither host phase starts an
unbounded restart loop. This is distinct from the external reconciler's
`controlPlaneStatus=DEGRADED`, which records a handled AWS/SSM observation
failure while preserving the last host phase and route; it is nonterminal and
can be retried by a later eligible reconciliation.

The root-owned host state record is format version 2 and contains:

- `generation` for stale-event and stale-command rejection. The host advances
  it exactly once for every new reconcile request UUID, including healthy,
  no-switch, and terminal outcomes. A duplicate UUID returns the persisted
  generation and result without reapplying counters or route operations;
- `phase` and the active route;
- persisted previous/target route, transition start, and transition generation;
- the most recent reconcile request ID and the last safe probe booleans;
- Direct activation time;
- the beginning and last accepted sample of the current continuous Shared
  health interval;
- cooldown expiry;
- a rolling timestamp history of normal Shared-to-Direct starts; and
- bounded probe counters and the terminal reason.

Conditional state updates and the existing environment `operator.lock` make a
transition single-owner and idempotent. A v1 or malformed state file is
rejected; no implicit migration can reinterpret the old fixed-bucket fields.
Every reconcile outcome is one single-line versioned JSON envelope containing
only safe route, phase, counter, timestamp, transition, and request fields.
Sentry wakes reconciliation; it never selects, writes, or commands a route.
The minute EventBridge schedule is a reconciliation poll, not a failover
trigger: when the mirrored host is quiescent in `SHARED_ACTIVE` with no
persisted SSM command already started by Sentry, the worker returns an
explicit ignored result and leaves the host mirror unchanged. Only an
eligible Sentry signal may start the Shared-to-Direct command. The schedule
still polls a Sentry-started command and drives Direct health/failback,
recovery and switching phases, stale-transition compensation, and emergency
Direct-to-Shared recovery. The host operator reads only the root-owned route
state and existing environment secrets.

### Sentry freshness and disabled-mode replay

The receiver preserves Sentry compatibility by calculating HMAC-SHA256 over
the raw request body only. `Sentry-Hook-Timestamp` is an unsigned transport
sanity signal, not a cryptographic freshness authority. The receiver requires
the signed metric-alert body to contain a current-event time at
`data.metric_alert.date_detected`, with the exact fallbacks
`date_started` and `date_created` only when an earlier field is absent. The
selected signed provider time and the header must each be parseable and within
the existing five-minute receipt tolerance, and must agree within that same
tolerance. A changed or future header therefore cannot make a stale signed
body eligible.

Before acknowledging an eligible delivery while `FAILOVER_ENABLED=false`, the
receiver conditionally records the body SHA-256 fingerprint as
`replay/<fingerprint>` in the retained per-environment DynamoDB table. Its role
allows only `GetItem` and `PutItem` with `dynamodb:LeadingKeys` restricted to
`replay/*`, excluding the `db-failover/<environment>` state item. A duplicate
conditional claim is an idempotent `202`; a replay-store failure is a sanitized
`5xx`. When enabled, the receiver performs a consistent read of that namespace
before queueing and ignores a body already recorded while disabled. It does not
claim enabled messages, so SQS durable-before-`202`, FIFO deduplication, and the
worker's lease-bound transactional replay claim remain unchanged. The
fingerprint is the replay authority; request IDs and the unsigned header are
not.

### Detection and probe policy

The normal route is Shared and the emergency route is Direct. The approved
thresholds are fixed:

- Sentry target threshold: five eligible errors in one minute.
- Eligible Prisma codes: `P1001` and `P1017` only.
- Ineligible codes: `P2024` and every other Prisma or non-Prisma error. Pool
  exhaustion and load signals are capacity alerts, not failover triggers.
- Before Shared-to-Direct activation: three consecutive Shared probe failures
  and three consecutive Direct probe successes.
- Each probe is read-only, uses `SELECT 1`, sets `connection_limit=1`, and has
  a five-second timeout.
- Direct must remain active for at least one hour before ordinary failback.
- Shared recovery evidence accepts only 45-90 second gaps. A faster call is a
  duplicate and does not increment the count; a gap above 90 seconds resets the
  interval to one. Ordinary failback requires thirty accepted successful
  probes and at least 1740 seconds between the first and last accepted sample,
  in addition to the one-hour Direct hold.
- A host route cooldown of 300 seconds is persisted after a successful route
  switch. A normal new Shared-to-Direct failover cannot start during cooldown;
  emergency Direct-to-Shared recovery bypasses both cooldown and the Direct
  minimum hold.
- The host prunes normal failover start timestamps against the inclusive
  `now-21600` cutoff. Before a normal Shared-to-Direct failover, two remaining
  timestamps block the attempt; otherwise the current timestamp is appended.
  A third normal failover in the preceding six-hour history enters `BLOCKED`.

Sentry `resolved` status is only a reconciliation hint. It is never proof that
Shared is healthy. Shared recovery is proved by the independent probes issued
from the Lightsail network. If Direct fails while Shared passes three probes,
the reconciler may perform an emergency return to Shared without waiting for
the one-hour Direct hold. If both routes fail, it enters `BLOCKED` without
restarting the application.

### Transition procedure

Each route change is a compensating operation:

1. Acquire the existing per-environment operator lock; the external
   reconciler's lease and the host generation reject stale or competing
   requests.
2. Persist the phase to the corresponding `SWITCHING_*` phase, previous and
   target route, transition start, and transition generation before any
   recreation. No URL, host, image reference, or shell output is part of the
   state or response envelope.
3. Change only the API container's route mode, then recreate it with the same
   image and digest using `--no-deps --force-recreate`. A process restart is
   insufficient because Prisma resolves its URL when the process is created.
4. Verify exactly one API container, the expected scheduler ownership, the
   selected route's readiness, and the public readiness endpoint before
   committing the new active phase.
5. On failure, restore the previous mode, recreate the API container, and probe
   the previous route. If compensation fails, persist `DEGRADED`; do not keep
   retrying restarts.

If the process is interrupted while a `SWITCHING_*` record is persisted, the
next request performs one bounded compensation under the shared deploy lock.
It validates the transition metadata, restores/recreates the persisted
previous route, and reruns the full runtime, readiness, scheduler, and digest
invariants. Successful restoration clears the transition and emits
`stale_transition_compensated`; a failed restoration clears the transition and
persists terminal `DEGRADED` with
`stale_transition_compensation_failed`. The target route is never promoted
from state alone, and a terminal result does not start a restart loop.

Preview keeps scheduler ownership disabled; Production keeps its existing
single scheduler owner enabled. The route state is not considered active until
the runtime facts and persisted state agree.

### Application observability and health

The application centrally captures Prisma exceptions on every API path. Each
captured event has bounded tags `environment`, `db.route`,
`db.failover_eligible`, and `prisma.code`. Captured Sentry errors use a generic
message and contain no database URL, host, raw database message, or secret in
tags, extras, request data, or contexts. Existing service-record filtering and
redaction remain in force.

`GET /health` remains DB-independent process liveness. Public
`GET /health/ready` executes `SELECT 1`, returns 200 only when it succeeds,
returns a generic detail-free 503 otherwise, and sends `Cache-Control:
no-store`.

After a host terminal state or control-plane `BLOCKED` state is persisted, the
worker emits a secret-free CloudWatch Embedded Metric Format record in
namespace `BabyJamJam/DbFailover`, metric `TerminalState`, with dimensions
`Environment` and `StateType` (`HOST` or `CONTROL_PLANE`). A handled AWS/SSM
failure that persists nonterminal `controlPlaneStatus=DEGRADED` emits a
separate top-level EMF metric named `ControlPlaneDegraded`, dimensioned by
`Environment`; its CloudWatch alarm has the same SNS action. The separate
metric and alarm avoid treating a retryable control-plane condition as a
terminal state. Valid terminal results and handled nonterminal failures are
successful Lambda invocations and do not rely on Lambda `Errors` to become
visible.

## Consequences

### Positive

- Shared pooler remains the verified normal route, while a bounded Direct route
  can recover from a pooler-only outage without an application code-side route
  mutation.
- Three probes in both directions and a one-hour hold reduce false positives
  and route oscillation.
- Durable leases, generation checks, and the six-hour budget make duplicate or
  delayed Sentry events harmless.
- Liveness and readiness answer different operational questions, and readiness
  failures do not disclose connection details.

### Negative

- Direct activation spends PostgreSQL connections directly and requires a
  measured production connection budget before enablement.
- The reconciler, host operator, and AWS control plane add operational
  components and require monitoring for leases, SQS/DLQ, SSM failures,
  transition duration, readiness, and `BLOCKED`/`DEGRADED` states.
- A terminal state requires an operator-directed recovery; automatic retries
  intentionally stop at the safety boundary.

## Rollout and rollback

The feature is first dark-deployed and exercised in Preview. Direct reachability
and the production connection budget must pass before activation. Preview must
prove Shared failure → Direct success, one-hour Direct operation, thirty
continuous Shared probes, compensation rollback, and the kill switch. Production
then runs monitor-only for 24 hours before automatic reconciliation is enabled.

Emergency disablement stops new reconciliation while leaving the current route
unchanged. Route rollback is separate from image rollback. There is no database
schema rollback because this ADR adds no schema change.
