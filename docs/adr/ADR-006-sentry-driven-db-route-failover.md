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
reconciler, while the reconciler owns durable state, probes both routes, and
serializes the host-level environment change.

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

The reconciler persists one state record per environment and allows only the
following active phases:

```text
SHARED_ACTIVE
  -> SWITCHING_TO_DIRECT
  -> DIRECT_ACTIVE
  -> RECOVERING_SHARED
  -> SWITCHING_TO_SHARED
  -> SHARED_ACTIVE
```

`BLOCKED` and `DEGRADED` are terminal failure states until an operator performs
an explicitly authorized recovery. `BLOCKED` means that neither route has
passed the required probe or the transition budget is exhausted. `DEGRADED`
means that a route change was attempted but its compensating restoration also
failed. Neither state starts an unbounded restart loop.

The state record contains:

- `generation` for stale-event and stale-command rejection;
- `phase` and the active route;
- transition lease expiry;
- the most recent Sentry request ID;
- Direct activation time;
- the beginning of the current continuous Shared-health interval;
- cooldown expiry;
- the count of normal route transitions in the preceding six hours; and
- the SSM command ID.

Conditional state updates and the existing environment `operator.lock` make a
transition single-owner and idempotent. Sentry wakes reconciliation; it never
selects, writes, or commands a route. The host operator reads only the
root-owned route state and existing environment secrets.

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
- Shared failback requires thirty consecutive successful probes at one-minute
  intervals (thirty minutes of continuous evidence). A timeout, failure, or
  excessive probe gap resets the continuous interval.
- Within any six-hour window, at most two normal failover/failback round trips
  are allowed. A third normal transition enters `BLOCKED`.

Sentry `resolved` status is only a reconciliation hint. It is never proof that
Shared is healthy. Shared recovery is proved by the independent probes issued
from the Lightsail network. If Direct fails while Shared passes three probes,
the reconciler may perform an emergency return to Shared without waiting for
the one-hour Direct hold. If both routes fail, it enters `BLOCKED` without
restarting the application.

### Transition procedure

Each route change is a compensating operation:

1. Acquire the per-environment lease and existing operator lock; reject stale
   generations or an active competing transition.
2. Update the phase to the corresponding `SWITCHING_*` phase and record the
   request/command identity without recording a URL.
3. Change only the API container's route mode, then recreate it with the same
   image and digest using `--no-deps --force-recreate`. A process restart is
   insufficient because Prisma resolves its URL when the process is created.
4. Verify exactly one API container, the expected scheduler ownership, the
   selected route's readiness, and the public readiness endpoint before
   committing the new active phase.
5. On failure, restore the previous mode, recreate the API container, and probe
   the previous route. If compensation fails, persist `DEGRADED`; do not keep
   retrying restarts.

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
