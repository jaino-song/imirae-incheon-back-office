# Fallback Server backend

The BabyJamJam **Fallback Server** role is portable. Covenant host observations
are historical; the manual temporary LightNode path is separately documented.
It is an API-only warm standby for the production backend and is not the
frontend deployment. The frontend keeps the stable
`https://api.babyjamjam.com` hostname while traffic ownership is changed by
the separately controlled Vercel DNS client.

Current status: **controller runtime, installer, systemd unit source, and CLI
are implemented locally; the controller is not installed or armed, and the host
is not serving production traffic**.

## Safety boundary

- The Fallback API binds to `127.0.0.1:3101`.
- The controller binds to `127.0.0.1:3102`, receives only
  `POST /sentry/uptime-alert`, and exposes a generic `GET /health`.
- Sentry Uptime creates an outage issue; a Monitor-sourced Alert/Workflow then
  invokes an Internal Integration webhook with `event_alert.triggered`.
- There is no cron, timer, Vercel Function, hosted Redis lease, or automatic
  Fallback → AWS failback. A service restart resumes only a persisted
  `VERIFYING` incident or reconciles `DNS_COMMITTING` against live DNS; it never
  promotes a route from state alone.
- Scheduler, auto-finalizer, eFormsign document-job intake/workers, unlocked
  reconciliation, and Aligo are hard-disabled in Compose. On top of those gates,
  background work runs only on the host holding the `scheduler_lease` row
  (ADR-010); `status` prints `lease_mode=` / `lease_held=` from
  `/health/lease`.
- The Fallback runtime connects to the Production DB only and must pass the
  Production DB identity hash gate before status or release activation. The
  approved project-reference digest is kept separately from `backend.env` in
  `/opt/babyjamjam-fallback-server/approved-production-db-ref.sha256`.
- Vercel DNS changes are limited to one preflight-captured `api`/`A` record and
  one-way AWS → Fallback mutation. Ambiguous responses require manual
  reconciliation.
- The durable `DNS_COMMITTING` phase reserves the one-way DNS mutation. A
  disarm before reservation prevents the PATCH; a disarm during committing is
  refused until the live record is reconciled. Startup never promotes from
  state alone.

See the complete operator procedure in
[CONTROLLER_OPERATIONS.md](./CONTROLLER_OPERATIONS.md).

For manual temporary hosting, see [LightNode lifecycle](./LIGHTNODE_TEMPORARY_FALLBACK.md).

## Host layout

```text
/usr/local/sbin/babyjamjam-fallback-server
/usr/local/sbin/babyjamjam-failover-controller
/usr/local/libexec/babyjamjam-fallback-server/
├── bundle.manifest
├── compose.yml
└── production-db-identity.sh
/usr/local/libexec/babyjamjam-failover-controller/
├── bundle.manifest
├── config.mjs
├── fallback-status.mjs
├── main.mjs
├── operator.mjs
├── operator.sh
├── policy.mjs
├── probes.mjs
├── receiver.mjs
├── security.mjs
├── server.mjs
├── state-store.mjs
├── vercel-dns-client.mjs
├── worker.mjs
├── controller.env.tpl
└── systemd/babyjamjam-failover-controller.service
/etc/systemd/system/babyjamjam-failover-controller.service
/opt/babyjamjam-fallback-server/
├── approved-production-db-ref.sha256
├── backend.env
├── controller.env
└── state/
    ├── failover-controller-state.json
    ├── failover-controller-state.json.lock
    └── operator.lock
```

Directories are root-owned mode `0700`; executable artifacts are root-owned
mode `0750`; read-only source and manifest artifacts are root-owned mode `0640`.
`backend.env` and `controller.env` are root-owned mode `0600`, while
`approved-production-db-ref.sha256` is root-owned mode `0400`. The repository
ships the installer, controller bundle sources, systemd unit source, and CLI,
but does not install or activate them automatically. The installer generates
the protected bundle manifest on the host. Installation remains a separately
approved host operation. The Fallback Server operator's kernel-flock target is
`/opt/babyjamjam-fallback-server/state/operator.lock`; it is released when the
operator process closes its descriptor and must not be deleted manually. The
controller state store uses the lock derived from its state file,
`/opt/babyjamjam-fallback-server/state/failover-controller-state.json.lock`.
Stale controller lock recovery is automatic and quarantines only an
identity-checked stale lock; do not remove controller lock files by hand or
create an alternate lock location.

## Production DB identity gate

Provision the real Production DB values directly in
`/opt/babyjamjam-fallback-server/backend.env`; never commit or print them.
Provision the separately approved project-reference SHA-256 digest in
`/opt/babyjamjam-fallback-server/approved-production-db-ref.sha256` as
`root:root` mode `0400`. The identity helper reads that fixed file and does not
trust a hash copied from `backend.env`. Run the helper and require the generic
success marker:

```bash
sudo /usr/local/libexec/babyjamjam-fallback-server/production-db-identity.sh \
  /opt/babyjamjam-fallback-server/backend.env \
  /opt/babyjamjam-fallback-server/approved-production-db-ref.sha256
```

Expected output is exactly `production_db_identity=ok`. Any other result blocks
deployment, status approval, and automatic failover.

The controller also requires the expected production image identity in its
root-owned `controller.env`: `FAILOVER_EXPECTED_IMAGE_TAG` (the approved
40-character commit tag) and `FAILOVER_EXPECTED_IMAGE_DIGEST` (the approved
`sha256:<64-hex>` digest). These expected values are configuration, not
incident state or log fields.

## Network prerequisites

The [network preflight](./NETWORK_PREFLIGHT.md) is a read-only observation,
not activation proof. Before installation, clear all of these blockers:

- an authoritative public inbound route or approved tunnel/reverse proxy with
  TLS for both the API origin and the dedicated Sentry endpoint;
- an authoritative fixed outbound IPv4 (the host currently shows a likely
  private/CGNAT path); and
- verified Node.js 20+, systemd, Docker, and Compose at the service paths.

Do not infer static IP ownership from a short-lived `ipify` observation. Keep
Aligo credentials and SMS-producing paths disabled until fixed egress is
registered and no-send authentication is proven.

`lightnode-preflight.sh` is an admission check, not a provisioning script. Run
`sudo ./lightnode-preflight.sh fresh` before approved root-only provisioning;
run `sudo ./lightnode-preflight.sh installed` after it. The former rejects all
Fallback/guard/controller files, state, Compose labels, containers, networks,
and volumes; the latter verifies exact protected ownership, modes, manifest
hashes, units, and state without printing secret material. Both report only an
egress SHA-256, never an address. `installed` is only for the staged bundle:
before `backend.env`, approvals, evidence, passive deployment, or activation.
After deployment or activation, use the Fallback operator `status` instead of
preflight.

## Runtime status and incident flow

The safe operator flow is:

1. Install/stage the immutable API and controller artifacts; keep
   `FAILOVER_CONTROLLER_ENABLED=false` and state disarmed.
2. Pass the Production DB hash, image digest, passive-gate, public TLS, and
   Sentry live-payload gates.
3. Run the [test-hostname rehearsal](./CONTROLLER_OPERATIONS.md#test-hostname-rehearsal)
   with a separately scoped Vercel record and token.
4. Obtain action-time approval and arm the controller. Automatic failover may
   only move AWS → Fallback after three AWS readiness failures, three Fallback
   successes, matching Production DB/image/passive gates, and current AWS DNS.
5. For recovery, disarm first and restore AWS manually using the
   [manual failback procedure](./CONTROLLER_OPERATIONS.md#manual-failback-and-rollback).

The current source includes a dedicated arm/disarm CLI, but that protected
interface is not installed on the host yet. Do not edit the state JSON by hand;
production arming remains blocked until the bundle and service are installed.

The protected Fallback bundle includes passive and temporary-active Compose
artifacts, the expiry guard service/timer, approval/evidence files, and active
mode/expiry/linkage state under the root-only state directory. The controller's
no-timer statement applies only to its automatic polling behavior; the separate
temporary-active expiry guard is deliberately periodic and fail-closed.

Active artifacts are `/usr/local/libexec/babyjamjam-fallback-server/compose.temporary-active.yml`,
`/etc/systemd/system/babyjamjam-fallback-temporary-active-guard.service`, and
`/etc/systemd/system/babyjamjam-fallback-temporary-active-guard.timer`. Protected
state records mode, expiry, nonce/incident/evidence linkage, and the separate
scheduler-evidence artifact; container discovery uses fixed Compose labels when
tag state is unavailable.

## Temporary Funnel active mode (manual, expiry-bound)

`deploy` remains the ordinary passive deployment path: it fixes every scheduler,
document-job, reconciliation, and message-trigger worker gate to `false` and
blanks Aligo credentials. It never activates public routing.

The separate `temporary-active` command is an exceptional, manually approved
mode for a bounded incident. It never pulls or builds an image and only starts
the already-recorded immutable passive release. Before startup it requires a
separate root-owned mode-`0400` approval artifact at
`/opt/babyjamjam-fallback-server/temporary-active-approval` with exactly:

```text
schema_version=1
incident_id=<operator supplied>
primary_scheduler_condition_ref_sha256=<operator supplied evidence hash>
image_tag=<approved immutable tag>
image_digest=<approved immutable digest>
production_db_ref_sha256=<approved production DB reference hash>
aligo_egress_ipv4_sha256=<approved egress hash>
issued_at_unix=<operator supplied issue time>
approval_nonce=<operator supplied lowercase nonce>
expires_at_unix=<operator supplied expiry>
```

Provision `/opt/babyjamjam-fallback-server/temporary-active-scheduler-evidence`
separately as a regular, non-symlink `root:root` mode-`0400` file of at most
4096 operator-supplied bytes. Its exact SHA-256 must equal the approval's
`primary_scheduler_condition_ref_sha256`; only incident ID, evidence hash, and
nonce are retained in protected active state, never evidence contents.

Root possession of the protected approval file is the authority boundary; the
file is not evidence of a separate identity. The operator validates ownership, exact release and DB-reference
identity, future expiry, and two independent current egress observations without
printing an address. It schedules a persistent root systemd expiry stop before
starting. If scheduling or any runtime check fails, it does not remain active.
It requires a minimum five-minute lead time, a maximum 48-hour approval window,
bounded clock skew, and a nonce that remains claimed after stop/restart.
Only the five explicitly named scheduler/document-job gates become `true`; the
reconciliation-unlocked and unused message-trigger-worker gates remain `false`.
`SCHEDULERS_ENABLED=true` still enables the message-trigger scheduler: duplicate
delivery is bounded by the existing DB lease/claim/provider-acceptance paths,
and the approval artifact must record the primary-scheduler incident condition.

While an approved temporary-active runtime is healthy, renew its bounded window
with `babyjamjam-fallback-server extend-temporary-active <tag> <digest>`. The
command requires a fresh approval, nonce, DB reference, release, scheduler
evidence, and egress verification. It moves the expiry forward by at most the
same 48-hour approval bound without invoking Compose or changing the running
container ID. If timer, state, guard, runtime, or image verification fails, it
restores the previous expiry timer and protected state; it never uses a
stop/restart cycle as renewal.

Replace an active release with
`babyjamjam-fallback-server replace-temporary-active <tag> <digest>`. This is
the LightNode equivalent of the Lightsail ordering: while the current API stays
healthy, the operator validates the new bounded approval, pulls the immutable
digest, verifies its revision and approved egress, and reserves the new expiry.
Only then does it force-recreate the API service and wait for DB-backed
readiness. Scheduler and document-worker gates remain active in exactly one
Compose service throughout the replacement. A failed new runtime is replaced
immediately with the recorded previous active image and its original
expiry/linkage. This minimizes interruption to the final container recreate and
health wait; it is not a two-container blue-green deployment and must not be
reported as mathematically zero downtime.

## Conditional `main` CI replacement on LightNode

`main` CI publishes one immutable backend image, then resolves exactly one
production target from the current `api.babyjamjam.com` A-record set. The
canonical A-record hash must match either the protected Lightsail identity or
the protected LightNode identity. Unknown, mixed, missing, or changed routing
fails closed before either deployment job starts. Preview remains on Lightsail.

When LightNode owns the public route, the workflow joins the tailnet as an
ephemeral `tag:ci` node and connects only as `babyjamjam-ci-deployer`. That user
must not belong to the Docker group. Its single authorized key must use
`restrict,command="/usr/local/sbin/babyjamjam-fallback-ci-ssh-dispatch"` so it
cannot open a shell, allocate a TTY, forward connections, or choose another
sudo command. The dispatcher permits only:

```text
status
replace <tag> <digest>
```

The wrapper rechecks public routing, active runtime health, Production DB
identity, singleton scheduler/document-worker ownership, the immutable release,
and a root-owned opt-in authority artifact before delegating to
`replace-temporary-active`. Image preload, final API recreate, readiness, and
automatic rollback remain owned by the existing operator.

Automatic replacement is disabled until a separately approved root operation:

1. provisions the dedicated SSH user and key outside this repository;
2. writes `/opt/babyjamjam-fallback-server/automatic-deploy-authority` as
   `root:root` mode `0400` with the exact value
   `github-main-lightnode-auto-deploy-v1`;
3. writes the canonical active LightNode A-record SHA-256 to
   `/opt/babyjamjam-fallback-server/approved-public-routing.sha256` as
   `root:root` mode `0400` without printing the address;
4. runs `ci/install-ci-deployer.sh` as root;
5. configures the GitHub secrets `FALLBACK_DNS_SHA256`,
   `LIGHTSAIL_DNS_SHA256`, `LIGHTNODE_CI_HOST`,
   `LIGHTNODE_CI_SSH_PRIVATE_KEY`, `LIGHTNODE_CI_KNOWN_HOSTS`,
   `TS_OAUTH_CLIENT_ID`, and `TS_OAUTH_SECRET` plus a least-privilege Tailscale
   ACL for `tag:ci` to reach only the deployer's SSH endpoint.

Removing the opt-in authority file disables replacement at the host even if CI
credentials still exist. Do not fall back to root SSH or widen port 22 when the
ephemeral tailnet connection is unavailable.

Aligo
values are never interpolated by Compose: Docker reads them only from the
root-owned `backend.env` at active container runtime.

The runbook consumer only validates and consumes the approval; it must never
create it, provision secrets, or invent evidence. A separately approved,
root-only provisioning step creates the bundle, protected files, and approval
inputs. The approved raw IPv4 is disclosed only through the confidential Aligo
registration channel and is not placed in tickets, shell output, source, or
preflight records. First perform the exact synthetic no-send authentication
smoke. A real provider-acceptance SMS is a separate action that needs its own
explicit approval and recipient.

For stable ingress, preserve the existing public contract
`https://api.babyjamjam.com`. Caddy terminates TLS on the VPS public interface
and reverse-proxies only to loopback `127.0.0.1:3101`; the controller remains
unpublished. Both Vercel Production projects keep
`NEXT_PUBLIC_API_BASE_URL=https://api.babyjamjam.com`, so AWS failback does not
require a frontend rebuild. Tailscale Funnel is optional only for pre-cutover
validation and must be disabled after the stable hostname is healthy.

### Action-time stable API procedure

Do not change DNS until passive release, Production DB identity, Caddy config,
external egress, Aligo no-send authentication, and a protected rollback record
are all verified. Capture exactly one `api` A record with its provider ID,
current AWS value, and TTL. Require TTL 60 and current value equal the captured
AWS origin, then PATCH only that record to the approved VPS IPv4. A successful
response is insufficient: perform a fresh record list and require the current
record identity, value, type, and TTL. Vercel may replace the record ID during
the PATCH, so capture the read-after-write ID for failback while retaining the
original AWS value.

Start Caddy with a validated configuration bound only to the VPS public
interface, wait for automatic certificate issuance, and require external HTTPS,
`/health/ready`, both Production CORS origins, and a no-data service-record
route smoke before temporary-active. If any cutover check fails, reconcile live
DNS once and use the protected rollback artifact; do not issue a blind second
PATCH.

For AWS failback, verify AWS readiness and document reconciliation first, then
PATCH the current captured `api` record back to the protected original AWS
value and perform a fresh read-after-write. Only after public DNS and HTTPS are
confirmed on AWS may the operator stop Fallback, Caddy be disabled, the Aligo
VPS allow-list entry be removed, and the LightNode instance be released.
Controller/Sentry automatic failback remains out of scope.

The backend environment is root-owned, but Docker daemon/root users can inspect
container environment metadata. This mode does not claim Docker `env_file` is a
secret-store boundary: it never logs or prints values, and a file-based
application secret mechanism requires separate application/env-contract approval.

## Related contracts

- [Controller operations](./CONTROLLER_OPERATIONS.md)
- [Sentry webhook contract](./SENTRY_HOST_FAILOVER.md)
- [Vercel DNS failover](./VERCEL_DNS_FAILOVER.md)
- [Network preflight](./NETWORK_PREFLIGHT.md)
- [Production DB helper](./production-db-identity.sh)
- [Fallback operator](./operator.sh)
