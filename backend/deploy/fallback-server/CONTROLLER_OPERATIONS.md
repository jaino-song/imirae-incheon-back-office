# Fallback Server controller operations

Status: **implemented locally; not installed or activated on the Covenant host**

Owner: production operator

Traffic direction: AWS → Fallback only (automatic)
Failback: manual only

This runbook is the action-time boundary for the event-driven controller. It
does not authorize DNS, firewall, TLS, Sentry, Aligo, or host changes by
itself. Those actions require the approvals and evidence listed below.

## What runs where

The physical Covenant server has two separate loopback services:

| Component | Fixed listener | Purpose | Ownership |
| --- | --- | --- | --- |
| Fallback API | `127.0.0.1:3101` | Production-compatible API process | Fallback Server operator |
| Failover Controller | `127.0.0.1:3102` | Signed Sentry receiver and one-shot worker | Controller service |

The controller receives `POST /sentry/uptime-alert` and exposes a generic
`GET /health`. It has no cron job, systemd timer, Vercel Cron, polling loop, or
automatic failback. `systemd` may restart the process after a crash, but a
restart only calls the worker's `resumePending()` hook for a persisted incident;
startup never arms state or promotes a route.

The public frontend continues to use `https://api.babyjamjam.com`. The
controller is not the public API and never changes DNS directly from the HTTP
receiver. The worker invokes the restricted Vercel client only after all
verification gates pass.

## Protected installation layout

The following paths are the intended root-owned installation boundary. They
must be regular files/directories, not symlinks, and must not be writable by
the service account or an untrusted group:

```text
/usr/local/sbin/babyjamjam-fallback-server
/usr/local/sbin/babyjamjam-failover-controller
/usr/local/libexec/babyjamjam-fallback-server/
├── compose.yml
├── production-db-identity.sh
└── controller/
    ├── config.mjs
    ├── main.mjs
    ├── receiver.mjs
    ├── security.mjs
    ├── server.mjs
    ├── state-store.mjs
    ├── probes.mjs
    ├── policy.mjs
    ├── worker.mjs
    ├── fallback-status.mjs
    └── vercel-dns-client.mjs
/etc/systemd/system/babyjamjam-failover-controller.service
/opt/babyjamjam-fallback-server/backend.env
/opt/babyjamjam-fallback-server/controller.env
/opt/babyjamjam-fallback-server/state/
└── failover-controller-state.json
/opt/babyjamjam-fallback-server/state/failover-controller-state.json.lock
```

`backend.env` is the Fallback API environment and must remain `root:root`
mode `0600`. `controller.env` contains the controller's provider credentials
and allowlists and must also be `root:root` mode `0600`. The state directory is
root-owned mode `0700`; the state file and lock are mode `0600`. Executables and
source files under `/usr/local` must be root-owned and non-writable by the
service account. Never place either environment file, the state file, a Sentry
signature, or a Vercel token in Git, logs, a ticket, or an incident transcript.

The repository currently contains the controller source and tests but no live
controller installer or systemd unit. Treat the paths above as the required
installation contract, not evidence that the service is installed. The
network preflight observed no controller unit and no listener.

## Controller environment contract

Only the following failover-scoped names may be supplied to the controller.
Bind address, ports, paths, state path, body limits, and timeouts are fixed in
code and must not be added as environment overrides.

| Variable | Required to arm? | Handling |
| --- | ---: | --- |
| `FAILOVER_CONTROLLER_ENABLED` | Yes | `false` by default. `true` only after every gate below passes. |
| `FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED` | Yes | Must be `true` before enabled mode; remains `false` until a sanitized live delivery is captured. |
| `FAILOVER_SENTRY_CLIENT_SECRET` | Yes | Secret; Internal Integration Client Secret, mode-0600 file only. |
| `FAILOVER_SENTRY_INSTALLATION_ID` | Yes | Exact installed Internal Integration UUID. |
| `FAILOVER_SENTRY_ORGANIZATION_ID` | Yes | Exact numeric Sentry organization ID. |
| `FAILOVER_SENTRY_PROJECT_ID` | Yes | Exact numeric project ID. |
| `FAILOVER_SENTRY_ALERT_ID` | Yes until a monitor field is proven | Exact Alert/Workflow ID present in the verified payload. |
| `FAILOVER_SENTRY_MONITOR_ID` | No | Keep unset. The documented `event_alert` payload does not guarantee a monitor ID; setting it is fail-closed. |
| `FAILOVER_PRIMARY_HEALTH_URL` | Yes | Exact `https://api.babyjamjam.com/health/ready`. |
| `FAILOVER_FALLBACK_HEALTH_URL` | Yes | Exact `http://127.0.0.1:3101/health/ready`. |
| `FAILOVER_VERCEL_API_TOKEN` | Yes | Secret; root-only mode-0600 file. |
| `FAILOVER_VERCEL_TEAM_ID` | Yes | Preflight-captured team scope. |
| `FAILOVER_VERCEL_DNS_RECORD_ID` | Yes | Preflight-captured `api`/`A` record ID. |
| `FAILOVER_PRIMARY_IPV4` | Yes | Approved AWS origin IPv4. |
| `FAILOVER_FALLBACK_IPV4` | Yes | Approved Fallback origin IPv4. |

The parser rejects unknown `FAILOVER_*` names, credentials or query strings in
health URLs, non-public/equal IPs, malformed IDs, incomplete enabled
configuration, and an enabled controller without the explicit live-payload
verification flag. Do not introduce generic `SENTRY_*` or `VERCEL_*` runtime
names; the existing application variables are not the controller contract.

## Production DB and passive-runtime gates

The Fallback API must connect to the Production DB and remain API-only. Before
staging or arming:

1. Provision `/opt/babyjamjam-fallback-server/backend.env` directly on the
   host as `root:root` mode `0600`.
2. Run the protected identity helper against that file and require exactly
   `production_db_identity=ok`:

   ```bash
   sudo /usr/local/libexec/babyjamjam-fallback-server/production-db-identity.sh \
     /opt/babyjamjam-fallback-server/backend.env
   ```

3. Run `sudo /usr/local/sbin/babyjamjam-fallback-server status` and require:
   `container_health=healthy`, `restart_count=0`, `db_readiness=ok`,
   `production_db_identity=ok`, `public_routing=not_managed`,
   `schedulers_enabled=false`, `document_jobs_accepting=false`, and
   `document_jobs_worker=false`.
4. Verify the image commit and digest against the approved release. Do not
   use `latest` or a mutable tag.

The Compose file hard-disables schedulers, auto-finalizers, document-job
intake/workers, unlocked eFormsign reconciliation, and Aligo credentials.
Those values override `backend.env`. Aligo and every SMS-producing path stay
disabled until an authoritative fixed outbound IPv4 is observed across a
restart/change boundary, registered with Aligo, and passed through a no-send
authentication check. A configuration value alone is not proof of static
egress.

## Sentry event path

The configured provider path is:

```text
Sentry Uptime Monitor
  -> outage issue after the configured failure tolerance
  -> Monitor-sourced Alert/Workflow
  -> Internal Integration webhook (`event_alert.triggered`)
  -> controller authentication and durable acceptance
  -> one-shot AWS/Fallback verification
  -> restricted AWS -> Fallback DNS update, if eligible
```

The receiver requires the raw body, `Sentry-Hook-Signature`,
`Sentry-Hook-Resource: event_alert`, `Sentry-Hook-Timestamp`, `Request-ID`,
and JSON content type. It verifies HMAC-SHA256 over the unmodified body before
parsing. It returns `202` only after `acceptAuthenticatedEvent(result)` has
durably accepted the event or identified a duplicate. It never performs DNS
work itself. `metric_alert`, legacy `event.alert` project service hooks, stale
or future signed event timestamps, and unresolved source identity are rejected
or blocked without a route change.

Sentry's one-second webhook response expectation is why the verification and
DNS operation are asynchronous. The controller stores a SHA-256 body
fingerprint; a changed `Request-ID` does not create a second incident.

## Lifecycle: disabled, dark, arm, disarm, status

### Disabled (default)

- Keep `FAILOVER_CONTROLLER_ENABLED=false`.
- The service may be installed for process/health checks, but `/health` reports
  only generic status and webhook requests are not accepted for failover.
- A new controller state starts `armed=false`; disabled mode never arms state.
  No listener or DNS mutation is proof of activation.

### Dark verification

- Set all non-secret configuration in the protected file, but keep the
  controller disabled or state disarmed.
- Set `FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED=true` only after the
  sanitized live Sentry delivery fixture, exact Alert/Workflow binding, and
  signature test are captured.
- Exercise signed delivery, malformed/replayed delivery, callback failure,
  state restart, and log-redaction tests against a test adapter. Do not use
  the production DNS record.
- Confirm that `resumePending()` does not promote state on startup.

### Arm (action-time approval)

Automatic AWS → Fallback is allowed only when the operator records all of the
following at action time:

1. Network preflight is cleared: an authoritative public inbound route or
   approved tunnel with TLS exists, and fixed egress is separately verified.
2. Node.js **20 or newer** is installed at the service's absolute path, and
   systemd, Docker, and the Fallback API are healthy.
3. Production DB identity, immutable image digest, passive gates, and public
   readiness are green.
4. A real Sentry `event_alert.triggered` payload and signature have been
   captured and sanitized; `FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED=true`.
5. Vercel read-before-write succeeds for exactly one `api`/`A` record, its
   record ID/name/type/TTL match preflight, and the current value is the
   allowlisted AWS IPv4.
6. The operator approves the one-way transition and records the evidence
   bundle before enabling the service.

The repository includes the dedicated `arm` and `disarm` CLI, but the
root-owned operator interface is not installed on the host yet. Until the
protected bundle and service are installed, do not edit the JSON state file by
hand and do not claim production arming. This is an explicit activation
blocker.

### Disarm

- Stop new failover work through the approved controller operator interface
  (once installed) and record `armed=false` without changing the current DNS
  route.
- If a verification is already in progress, the worker re-reads durable state
  immediately before DNS mutation. A disarm is treated as a terminal
  `AWS_ACTIVE` reset with the pending incident cleared and no DNS mutation.
- Disarm does not restore AWS traffic automatically.

### Status

Use only the root-owned, fixed commands once installed:

```bash
sudo /usr/local/sbin/babyjamjam-fallback-server status
sudo systemctl status babyjamjam-failover-controller.service --no-pager
curl --fail --silent http://127.0.0.1:3102/health
```

Status output must contain only safe state, health, release, and passive-gate
markers. It must not print environment values, webhook bodies/signatures,
Vercel tokens, DB URLs, or provider response bodies.

## Automatic cutover decision

After a valid event is durably accepted, the worker performs this bounded
sequence:

1. Read Fallback status and require Production DB identity, release digest,
   zero restarts, and all passive gates safe.
2. Read Vercel DNS and require the exact preflight record currently points to
   AWS.
3. Verify AWS public `/health/ready` fails three consecutive times and the
   Fallback `/health/ready` succeeds three consecutive times within 180
   seconds. Readiness includes a Production DB `SELECT 1` and returns no
   connection details.
4. Evaluate the one-way policy with state `AWS_ACTIVE` and controller armed.
5. Issue one restricted Vercel PATCH from the approved AWS IPv4 to the
   approved Fallback IPv4, then perform a fresh read-after-write.
6. Persist `FALLBACK_ACTIVE` only after the provider response and read-after-
   write identity are confirmed.

Any both-down result, DB/image/passive-gate mismatch, DNS drift, timeout,
unexpected response, or unknown identity persists `BLOCKED` and performs no
DNS mutation. A Vercel timeout or ambiguous response is a **manual check**;
never retry the PATCH indefinitely.

## Test-hostname rehearsal

Production `api.babyjamjam.com` must never be the rehearsal target. A separate
test zone/record and separately scoped Vercel token are required.

The rehearsal must prove:

- exact record ID/name/type/TTL read-before-write;
- one AWS → Fallback update and read-after-write;
- duplicate and concurrent delivery no-op behavior;
- stale/future/invalid signature refusal;
- both-origin, DB, image, passive-gate, and DNS-drift blockers;
- Vercel 429/5xx/timeout reconciliation without a second PATCH;
- manual restoration of the test record; and
- immutable controller image rollback.

The current configuration parser has no rehearsal-only environment override.
Use injected test adapters in unit/integration tests; an unknown rehearsal
variable must be rejected rather than silently enabling a mode.

## Manual failback and rollback

There is no automatic Fallback → AWS path.

1. Announce the change and disarm the controller before restoring traffic.
2. Verify AWS Production DB readiness, public health, approved release identity,
   and the absence of ambiguous eFormsign/document submissions.
3. Re-read the Vercel record. Confirm it is the allowlisted Fallback value and
   the exact record identity is unchanged.
4. Perform one manually approved PATCH back to the AWS IPv4, then verify the
   same record by a fresh list read and public DNS lookup.
5. Confirm authenticated frontend/API smoke tests, leave the Fallback API
   passive, and record `AWS_ACTIVE` only through the approved operator
   interface.
6. If any response is ambiguous, stop. Reconcile the live record first; do not
   issue a compensating or repeated PATCH based on an assumption.

For controller code rollback, disarm first, stop the service, redeploy the
previous verified immutable image, validate state-schema compatibility, and
rerun `/health`, status, and signed-delivery tests. Code rollback and traffic
failback are separate operations.

## Current activation blockers

The latest network preflight records these unresolved blockers:

- Covenant has no verified public inbound IPv4; a private/CGNAT path was
  observed and no ingress proxy/tunnel or TCP 443 listener exists.
- `failover.babyjamjam.com` has resolver disagreement and does not prove a
  Fallback origin or TLS ownership.
- Fixed outbound IPv4 is not authoritative; Aligo must remain disabled.
- The controller systemd unit and listener are not installed.
- Node.js 20+ at the service path must be verified on the host.
- The live Sentry payload/configuration and Alert/Workflow allowlist remain to
  be captured and verified.
- The Vercel write scope and a non-production test-record PATCH rehearsal are
  not complete.
- The arm/disarm CLI exists in the repository, but it is not installed on the
  host yet; until the protected bundle and service are installed, state must
  not be edited manually.

Until every blocker is cleared, the correct state is **implemented locally,
dark/not activated**. A passing unit test, local health response, or frontend
Vercel deployment is not live failover proof.

## Evidence checklist

Attach a redacted evidence bundle for every rehearsal or activation:

- source commit and immutable controller/API image digest;
- Node.js, systemd, Docker, and Compose versions (no secrets);
- Fallback status markers and Production DB identity success marker;
- Sentry event resource/action, signature verification result, and body
  fingerprint (never the body or signature);
- pre/post Vercel record identity, HTTP status, and target-role fingerprints;
- AWS/Fallback readiness counts and bounded decision reason;
- controller state phase/generation and safe timestamps;
- operator approval, UTC timestamp, and rollback/failback result.

Do not include raw provider payloads, account IDs, IP addresses, URLs with
credentials, tokens, signatures, database URLs, or PII in the bundle.
