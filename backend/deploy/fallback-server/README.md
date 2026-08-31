# Fallback Server backend

The physical Covenant server hosts the BabyJamJam **Fallback Server** role.
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
    └── failover-controller-state.json
```

Directories are root-owned mode `0700`; executable artifacts are root-owned
mode `0750`; read-only source and manifest artifacts are root-owned mode `0640`.
`backend.env` and `controller.env` are root-owned mode `0600`, while
`approved-production-db-ref.sha256` is root-owned mode `0400`. The repository
ships the installer, controller bundle sources, systemd unit source, and CLI,
but does not install or activate them automatically. The installer generates
the protected bundle manifest on the host. Installation remains a separately
approved host operation.

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
  /opt/babyjamjam-fallback-server/backend.env
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

## Related contracts

- [Controller operations](./CONTROLLER_OPERATIONS.md)
- [Sentry webhook contract](./SENTRY_HOST_FAILOVER.md)
- [Vercel DNS failover](./VERCEL_DNS_FAILOVER.md)
- [Network preflight](./NETWORK_PREFLIGHT.md)
- [Production DB helper](./production-db-identity.sh)
- [Fallback operator](./operator.sh)
