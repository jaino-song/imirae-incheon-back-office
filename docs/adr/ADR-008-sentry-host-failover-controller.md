# ADR-008: Sentry host failover controller for the Fallback Server

## Status

Accepted — local implementation merged; not installed or activated

## Date

2026-08-31

## Context

The Vercel frontend can remain healthy while the AWS Lightsail backend is
unavailable. The frontend already uses the stable `api.babyjamjam.com`
hostname, so changing a Vercel environment variable during an incident would
add a deployment delay and configuration drift. The Fallback Server runs on the
physical Covenant server and is prepared to use the Production DB, but remains
API-only while AWS owns production traffic.

This decision extends [ADR-007](ADR-007-fallback-server.md), which
defines the Fallback Server's passive runtime and physical-host boundary.

The dependency-free controller, receiver, worker, state store, probes, policy,
Vercel client, installer, systemd unit source, and CLI are implemented and
unit-tested under `backend/deploy/fallback-server/controller/`. This ADR does
not claim that those artifacts are installed, that the Covenant host is
reachable, or that production Sentry/Vercel mutations have been exercised. The
action-time installation, dark-rehearsal, arm/disarm, and failback gates live in
[CONTROLLER_OPERATIONS.md](../../backend/deploy/fallback-server/CONTROLLER_OPERATIONS.md).

The provider-source and payload boundary in the Sentry contract
[Sentry host-failover webhook contract](../../backend/deploy/fallback-server/SENTRY_HOST_FAILOVER.md)
is authoritative for this ADR.

Sentry Uptime can detect an externally visible readiness failure, create an
issue, and feed a Monitor-sourced Alert/Workflow. That Alert action invokes an
Internal Integration issue-alert webhook. It is a wake-up signal, not an
authority to change DNS: alerts may be delayed, duplicated, replayed, resolved,
or caused by a shared database failure. Vercel Cron, a Vercel Function, and a
hosted Redis lease are intentionally excluded; the controller is event-driven
and runs on the Fallback Server itself.

## Decision

### Control-plane ownership

1. An Uptime failure creates an issue; a Monitor-sourced Alert/Workflow then
   invokes an Internal Integration issue-alert webhook to the dedicated
   Controller endpoint `failover.babyjamjam.com`, separate from
   `api.babyjamjam.com`. The eligible delivery is identified by resource
   `event_alert` and action `triggered` (the combined contract
   `event_alert.triggered`). Sentry also retains its normal human notification
   path.
2. The Controller validates and records a delivery, then performs the bounded
   probes and DNS decision. Sentry never selects, writes, or commands a route.
3. The listener has no cron job, systemd timer, or background health poll. It
   wakes only for a webhook and can resume a persisted in-progress incident
   after a process restart. A restart in `DNS_COMMITTING` reconciles the live
   DNS record before finalizing any route; it never promotes from durable state
   alone.
4. Production arming and disarming are explicit operator actions. Once armed
   with `AWS_ACTIVE`, an eligible incident may automatically move traffic from
   AWS to the Fallback Server. The Controller never performs an automatic
   Fallback-to-AWS failback.

5. The DNS mutation has a durable `DNS_COMMITTING` reservation phase. A
   disarm before that reservation prevents the PATCH; a disarm after the
   reservation is refused until the provider record is reconciled.

The legacy project Service Hook `event.alert` contract is not the source for
this flow and must not be substituted for the Internal Integration delivery.

### Provider source and parser boundary

The source contract is fixed to this chain:

```text
Uptime Monitor
  -> Uptime failure creates an issue
  -> Monitor-sourced Alert/Workflow matches the issue
  -> Internal Integration issue-alert webhook
  -> resource event_alert, action triggered (event_alert.triggered)
```

The Controller therefore requires a separate `event_alert` parser and policy.
The existing metric-alert receiver may share only raw-body handling, HMAC,
constant-time comparison, size limits, and freshness primitives. Its
`metric_alert` payload normalization, `data.metric_alert` parsing, metric
aggregate/threshold policy, and metric resource/action allowlist must not be
reused for this Uptime path. A `metric_alert` delivery or a legacy project
Service Hook delivery is rejected rather than silently reinterpreted.

### Webhook security boundary

The receiver rejects a delivery before it can enqueue work unless all of the
following checks pass:

- HMAC-SHA256 is computed over the unmodified request body and compared in
  constant time with the Sentry signature (`Sentry-Hook-Signature`).
- `Sentry-Hook-Timestamp` and the signed event time are parseable and within a
  five-minute receipt window; future or stale deliveries are rejected.
- The raw body is at most 64 KiB, and the Sentry monitor, project, and
  organization identifiers match fixed allowlists.
- The top-level resource is exactly `event_alert` and the action is exactly
  `triggered` (the combined contract is `event_alert.triggered`) for the
  configured Monitor-sourced Alert/Workflow. Resolved, unknown, `metric_alert`,
  and legacy project Service Hook events are recorded as ignored and cannot
  start a transition.
- A SHA-256 body fingerprint is claimed in durable state before returning
  `202`. A duplicate fingerprint is an idempotent no-op.

Rejected requests return a generic `4xx` response. Secrets, raw webhook bodies,
database URLs, and provider responses are never written to logs or state.

### Durable incident state

The Controller stores a versioned, root-owned local state file with atomic
replace and an exclusive lock. The record contains only safe operational data:

- a schema version and monotonic generation;
- the current route (`AWS_ACTIVE` or `FALLBACK_ACTIVE`) and current/last event
  fingerprints;
- a pending transition fingerprint and start/generation lineage while a
  verification is in progress, plus the durable `DNS_COMMITTING` reservation
  phase at the DNS point-of-no-return;
- a bounded replay-fingerprint history, terminal reason, and safe timestamps.

The state file contains no URL, token, password, raw request, or arbitrary shell
input. A restart may continue one persisted pending transition, but it may not
start a new probe loop. Duplicate or out-of-order deliveries cannot cause a
second DNS mutation.

### Independent verification policy

For each eligible Sentry delivery, the Controller performs a fresh, bounded
verification from the Fallback Server:

1. The AWS public `/health/ready` probe fails three consecutive times.
2. The Fallback Server public `/health/ready` probe succeeds three consecutive
   times. Readiness includes a `SELECT 1` against the Production DB and returns
   no connection details.
3. The Fallback Server release identity matches the expected production tag and
   immutable digest in the root-owned controller environment
   (`FAILOVER_EXPECTED_IMAGE_TAG` and `FAILOVER_EXPECTED_IMAGE_DIGEST`), and
   every passive gate is still disabled:
   schedulers, auto-finalizers, document-job intake/workers,
   eformsign reconciliation, and Aligo.
4. The configured Production DB identity marker/hash matches the approved
   Production DB reference digest in the separate root-owned mode-0400 file
   `/opt/babyjamjam-fallback-server/approved-production-db-ref.sha256`. A URL,
   credential, or expected image value is never logged or written to controller
   state.
5. The current public DNS record still points to the allowlisted AWS origin.

The three-failure/three-success sequence and all identity checks must complete
within 180 seconds of the accepted eligible delivery. If both origins fail,
the Production DB identity does not match, the image or passive gates drift, a
probe times out unexpectedly, or any other prerequisite is unknown, the
Controller persists `BLOCKED` and makes no DNS change.

### Restricted Vercel DNS mutation

The DNS client is constrained to one preconfigured Vercel record:

- domain `babyjamjam.com`;
- name `api` (`api.babyjamjam.com`);
- type `A`;
- the exact record ID captured during preflight;
- the approved AWS IPv4 and the approved Fallback Server IPv4 as the only
  accepted values.

It may issue one update from the approved AWS value to the approved Fallback
value. It cannot create or delete records, change the record type or name,
change unrelated records, change the frontend deployment, or alter TTL. The
client reads the record before and after the update. Immediately before the
PATCH it must atomically reserve durable phase `DNS_COMMITTING` with the same
pending fingerprint/generation lineage and `armed=true`. A disarm before that
reservation prevents the PATCH; a disarm during `DNS_COMMITTING` is refused
until the provider record is reconciled. Any DNS drift, record-ID mismatch,
unexpected response, or ambiguous timeout leaves the incident `BLOCKED` for
operator reconciliation; it does not retry indefinitely. The Vercel token is a
root-owned, mode-0600 secret available only to this client.

### Failback and rollback

Failback is a separate, manual operation. An operator must first verify AWS
readiness, approved release identity, public health, and eformsign/job
reconciliation, then restore the same A record to the allowlisted AWS value.
The Controller remains disarmed until the operator records `AWS_ACTIVE` again.

An interrupted or ambiguous transition is not treated as success. The operator
reconciles the live DNS value and either completes the one allowed update or
restores AWS manually; the Controller does not oscillate between origins. A
Controller deployment can be rolled back to its previous verified immutable
image, provided the state schema remains compatible. Image rollback is
separate from traffic failback. A restart in `DNS_COMMITTING` reconciles the
live record before finalizing state and never promotes from the state file
alone.

### Fallback runtime safety

The Fallback Server connects only to the Production DB and keeps all
singleton/provider-mutating work disabled while it is the standby or serving
API traffic. Aligo remains disabled until a fixed outbound IPv4 is independently
verified and registered; an environment variable alone cannot enable it. The
Controller itself has no permission to run migrations, change database routes,
start workers, or alter AWS infrastructure.

## Activation blockers

Automatic failover must remain disarmed until each blocker is cleared:

- no verified fixed inbound origin (or approved tunnel) and TLS endpoint for
  the Fallback Server;
- no captured and verified Sentry Internal Integration signature/payload
  contract or monitor, project, and organization allowlist;
- no live Uptime -> Monitor-sourced Alert/Workflow -> Internal Integration
  configuration and sanitized real `event_alert.triggered` delivery fixture
  (Phase 5 blocker);
- no preflight-captured Vercel record ID, exact record shape, two-value IP
  allowlist, and root-only token storage;
- no separate approved Production DB reference digest at
  `/opt/babyjamjam-fallback-server/approved-production-db-ref.sha256` with
  `root:root` mode `0400`, or matching readiness proof;
- no immutable Fallback release identity in
  `FAILOVER_EXPECTED_IMAGE_TAG`/`FAILOVER_EXPECTED_IMAGE_DIGEST`, or proof that
  passive gates are enforced at runtime;
- any failed dark-deploy, test-hostname transition, manual failback, or
  rollback rehearsal;
- a missing fixed outbound IPv4 blocks Aligo enablement (the API-only
  failover may remain armed only while Aligo is disabled).

## Acceptance criteria

- [ ] A valid, fresh, allowlisted Internal Integration issue-alert webhook with
      resource `event_alert` and action `triggered` (`event_alert.triggered`) is
      accepted with `202`; an invalid signature, stale timestamp, oversized
      body, disallowed monitor, replay, resolved event, `metric_alert`, or
      legacy project Service Hook event causes no DNS mutation.
- [ ] No cron, systemd timer, Vercel Function, or periodic polling is required;
      a service restart resumes only a persisted `VERIFYING` incident or
      reconciles a persisted `DNS_COMMITTING` reservation against live DNS; it
      never promotes from durable state alone.
- [ ] With `AWS_ACTIVE`, three AWS readiness failures, three Fallback readiness
      successes, matching Production DB identity, approved image digest,
      disabled passive gates, and current AWS DNS, exactly one restricted A
      record update moves `api.babyjamjam.com` to the Fallback IPv4 and a
      read-after-write confirms `FALLBACK_ACTIVE`.
- [ ] The eligible transition reaches a terminal decision within 180 seconds;
      both-origin failure, DB/image/passive-gate mismatch, timeout, or DNS
      drift persists `BLOCKED` and performs no update.
- [ ] Duplicate deliveries, concurrent deliveries, and process restarts do not
      claim the same fingerprint twice or issue a second DNS update.
- [ ] A disarm before `DNS_COMMITTING` prevents the PATCH; a disarm during
      `DNS_COMMITTING` is refused until live DNS reconciliation.
- [ ] Vercel API timeout or ambiguous response requires live record
      reconciliation and bounded operator action; it never starts an
      unbounded retry loop.
- [ ] Fallback-to-AWS traffic restoration is manual and requires AWS readiness,
      release identity, public health, and eformsign/job reconciliation proof.
- [ ] State, logs, responses, and evidence contain no webhook secret, Vercel
      token, database URL/credential, or provider payload.
- [ ] Dark deployment and a non-production DNS rehearsal prove automatic
      AWS-to-Fallback, duplicate no-op, blocker handling, manual failback, and
      Controller/image rollback before production arming.

## Non-goals

- Vercel Cron, Vercel Functions, Upstash/hosted Redis, or any other periodic
  polling service.
- Sentry directly changing DNS or serving as the route decision authority.
- Automatic Fallback-to-AWS failback or automatic DNS oscillation.
- Active-active operation, scheduler/worker ownership transfer, or enabling
  document jobs, eformsign reconciliation, auto-finalization, or Aligo on the
  Fallback Server. (Scheduler ownership is now decided by the database lease in
  ADR-010; letting the controller rely on it instead of the passive gates is a
  separate follow-up.)
- Changing `NEXT_PUBLIC_API_BASE_URL`, the Vercel frontend deployment, the
  database schema, Prisma schema, database route, or tenant/auth boundaries.
- Database migrations, AWS infrastructure changes, Cloudflare load-balancer
  provisioning, DNS record creation/deletion, or unrelated Vercel records.
- Replacing Sentry's human incident notifications or treating a local
  localhost-only backend as production failover.

## Consequences

### Positive

- A healthy Vercel frontend keeps one API hostname while a bounded controller
  can restore API traffic without a frontend deployment.
- Independent probes, Production DB identity, immutable release checks, and
  an exact DNS allowlist reduce false failovers and DNS takeover risk.
- Durable local state makes signed webhook replay, duplicate delivery, and
  process restart deterministic without a paid polling service.

### Negative and risks

- A lost Sentry webhook cannot be recovered by polling; Sentry notification and
  a documented manual failover path remain required.
- DNS propagation and an unhealthy shared Production DB can still prevent
  service recovery; both conditions intentionally stop at `BLOCKED`.
- The Fallback Server must protect a second host's root-only token, webhook
  secret, Production DB credentials, and local state.
- An incorrect allowlist or stale release identity can block a real incident;
  preflight capture and dark rehearsal are mandatory.

## Rollout and rollback

1. Capture and verify the Uptime -> Monitor-sourced Alert/Workflow -> Internal
   Integration issue-alert payload, Fallback network/TLS, Production DB
   identity, release digest, and Vercel record contract.
2. Install the Controller in dark mode with `FAILOVER_CONTROLLER_ENABLED=false`;
   exercise
   signed delivery, replay, blockers, state recovery, and log redaction.
3. Rehearse on a test DNS record, including AWS-to-Fallback, duplicate delivery,
   ambiguous Vercel response, manual failback, and immutable-image rollback.
4. After all acceptance criteria pass, obtain action-time approval to arm the
   production record with `AWS_ACTIVE` and
   `FAILOVER_CONTROLLER_ENABLED=true`.
5. To disable the feature, disarm the Controller without changing the current
   route. To roll back traffic, perform the documented manual AWS restoration;
   to roll back code, redeploy the previous verified Controller image.
