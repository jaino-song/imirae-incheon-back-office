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
  reconciliation, and Aligo are hard-disabled in Compose.
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
Aligo
values are never interpolated by Compose: Docker reads them only from the
root-owned `backend.env` at active container runtime.

For the temporary ingress operation, publish only the loopback API listener
through Tailscale Funnel; do not publish the controller. Coordinate both Vercel
projects' production `NEXT_PUBLIC_API_BASE_URL` change with fresh production
redeploys, because it is build-time client configuration. Roll back both
deployments together, then turn Funnel off and run the Fallback operator `stop`.
Sentry/controller automation, DNS changes, and any cloud-control-plane action
remain outside this runbook and require their own approval.

### Action-time Tailscale Funnel procedure

Do not run these commands until the temporary-active approval, release, DB,
egress, and rollback deadline are recorded. Publish only the API listener, not
the controller:

```bash
tailscale funnel --bg 3101
tailscale funnel status
```

Capture the URL returned by Tailscale in the incident record; never substitute
or invent one. From an external approved observer, verify HTTPS, `/health/ready`,
and an authenticated smoke flow. Update production `NEXT_PUBLIC_API_BASE_URL`
for both linked Vercel projects, redeploy both, and verify both frontends before
the approval expiry. If either fails, restore both prior deployments, verify
both restored origins, then disable Funnel and stop the active runtime:

```bash
tailscale funnel off
sudo /usr/local/sbin/babyjamjam-fallback-server stop
```

The rollback deadline must precede approval expiry. Controller/Sentry automatic
failover is explicitly out of scope for this temporary procedure.

`tailscale funnel --bg` may resume after reboot, while this API is deliberately
configured with `restart: "no"`. After any reboot, immediately run
`tailscale funnel off`, verify Funnel is unavailable, and do not re-point or
redeploy either frontend until a full new temporary-active approval and status
proof have been completed.

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
