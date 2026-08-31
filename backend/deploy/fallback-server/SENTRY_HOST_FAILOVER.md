# Sentry host-failover webhook contract

Status: **contract implemented locally; live Sentry configuration and activation blocked**

Reviewed: 2026-08-31
Scope: read-only Sentry documentation/API research and repository evidence. No
Sentry monitor, alert, integration, service hook, token, or delivery was
created, changed, or deleted.

## Decision

An Uptime outage is not documented as a direct Sentry project service-hook
event. The supported Integration Platform chain is:

```text
Uptime Monitor (source)
  -> Uptime failure creates an issue
  -> organization Alert matches the outage issue (source = Monitor)
  -> Alert action invokes an Internal Integration webhook
  -> Fallback Server receives event_alert.triggered
  -> controller authenticates and independently probes AWS + Fallback
  -> controller may switch DNS only when its local policy allows it
```

Sentry is therefore a signed wake-up signal. It must not be treated as proof
that AWS is down or as a route command. A separate metric-alert webhook is a
different contract and must not be silently substituted for the Uptime path.

## Local implementation status

The dependency-free controller implementation now provides the receiver,
configuration parser, and loopback server at:

- `controller/config.mjs`
- `controller/security.mjs`
- `controller/receiver.mjs`
- `controller/server.mjs`

The listener is fixed to `127.0.0.1:3102` and `POST /sentry/uptime-alert`.
Construction and startup leave state disarmed; the worker callback must
durably accept or recognize a duplicate before the receiver returns `202`.
No controller systemd unit, TLS ingress, Sentry integration, or DNS mutation
has been installed or activated on the Fallback Server.

For installation, arm/disarm, cutover, failback, and evidence gates, see
[CONTROLLER_OPERATIONS.md](./CONTROLLER_OPERATIONS.md).

The controller runtime uses only failover-scoped variables, including
`FAILOVER_CONTROLLER_ENABLED`,
`FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED`,
`FAILOVER_SENTRY_CLIENT_SECRET`, `FAILOVER_SENTRY_INSTALLATION_ID`,
`FAILOVER_SENTRY_ORGANIZATION_ID`, `FAILOVER_SENTRY_PROJECT_ID`,
`FAILOVER_SENTRY_ALERT_ID`, and the fixed Vercel/health allowlists. The live
payload-verification flag must remain false until the sanitized delivery
fixture and Alert/Workflow binding are captured at action time.

## Confirmed provider contract

The following facts are from Sentry's current public documentation and source:

1. Uptime Monitoring continuously checks configured URLs. A downtime issue is
   created after the configured failure tolerance (three consecutive failures
   by default), and the issue resolves after the recovery tolerance (one
   success by default). Sentry says to configure an Alert matching outage /
   downtime issues to receive notifications. [Uptime Monitoring](https://docs.sentry.io/product/monitors-and-alerts/monitors/uptime-monitoring/)
2. An organization Alert can use one or more Projects or Monitors as its
   source. Alert actions include webhooks and integrations, subject to the
   source/issue type support available in the workspace. [Alerts](https://docs.sentry.io/product/monitors-and-alerts/alerts/)
3. Internal Integration issue-alert webhooks use the resource
   `event_alert` and action `triggered`. The documented issue-alert payload
   contains `data.event` (including event/issue URLs and `issue_id`),
   `data.triggered_rule`, and optional `data.issue_alert` UI-component data.
   [Issue alert webhooks](https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/)
4. Internal Integration metric-alert webhooks use the separate resource
   `metric_alert`; actions are `critical`, `warning`, or `resolved`. The
   documented metric payload contains `data.metric_alert`, nested
   `alert_rule`, and incident timestamps/identifiers. [Metric alert webhooks](https://docs.sentry.io/integrations/integration-platform/webhooks/metric-alerts/)
5. Common Integration Platform webhook headers are `Content-Type`,
   `Request-ID`, `Sentry-Hook-Resource`, `Sentry-Hook-Timestamp`, and
   `Sentry-Hook-Signature`. Sentry documents HMAC-SHA256 verification with the
   installation Client Secret and the webhook body, and says the endpoint
   should respond within one second. [Webhook headers and signature](https://docs.sentry.io/integrations/integration-platform/webhooks/)
6. The Sentry serializer currently emits `Sentry-Hook-Timestamp` as Unix epoch
   seconds, generates a fresh `Request-ID`, and computes the signature over
   the serialized body. [Official serializer](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/api/serializers/app_platform_event.py)
   The Client Secret is used as the HMAC-SHA256 key. [Official signature implementation](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/models/sentry_app.py)
7. The project Service Hooks API is a different, legacy surface. Its public
   contract only lists `event.alert` and `event.created` subscriptions and
   requires the `servicehooks` feature plus `project:write`. [Register a Service Hook](https://docs.sentry.io/api/projects/register-a-new-service-hook/)
   Sentry's current service-hook task emits `X-ServiceHook-Timestamp`,
   `X-ServiceHook-GUID`, and `X-ServiceHook-Signature`, not the
   `Sentry-Hook-*` headers above. [Official service-hook task](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/tasks/service_hooks.py)

### Header and signature rules

| Item | Confirmed behavior | Controller consequence |
| --- | --- | --- |
| Raw body | Sentry signs its JSON body; the official example hashes the body serialization. | Preserve the exact inbound bytes and authenticate before parsing or reserializing. |
| Algorithm | HMAC-SHA256, hexadecimal digest, keyed by the Internal Integration Client Secret. | Use fixed-size, constant-time comparison; never log the secret or signature. |
| `Sentry-Hook-Resource` | `event_alert` for an Alert/issue-alert webhook; `metric_alert` for a metric-alert webhook. | Reject every resource except the explicitly configured one. Do not route by a caller-supplied field. |
| `Sentry-Hook-Timestamp` | Present in the common header set; current Sentry source emits Unix seconds. | Treat freshness as a controller policy. Sentry's public page does not promise that this header is covered by the body HMAC. |
| `Request-ID` | A new provider delivery identifier; current source uses `uuid4().hex`. | Keep for correlation only. The body fingerprint is the replay/idempotency key. |
| Response deadline | Sentry says webhooks should respond within one second. | Acknowledge only after authentication and durable enqueue/claim; complete business work asynchronously. |

Sentry's public webhook page does **not** define a replay window, delivery
ordering guarantee, or an idempotency key. Those are receiver responsibilities.

## Retry and replay evidence

Sentry's current task source is the only authoritative retry detail found:

- `send_alert_webhook_v2` (issue-alert / `event_alert`) is configured with
  `Retry(times=3, delay=60 * 5)` for `RequestException` and
  `InnerTimeoutError`; client errors and invalid-event classes are in the
  ignore set. [Task definition](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/tasks/sentry_apps.py)
- `send_metric_alert_webhook` uses the same `Retry(times=3, delay=60 * 5)`
  configuration. The legacy `process_service_hook` task is also configured
  with `Retry(times=3, delay=60 * 5)`. [Task definitions](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/tasks/sentry_apps.py), [legacy service-hook task](https://github.com/getsentry/sentry/blob/master/src/sentry/sentry_apps/tasks/service_hooks.py)
- The source does not promise that a caller will see one delivery only. A
  receiver must be idempotent for duplicate and delayed deliveries and must
  not perform a second DNS mutation for the same body fingerprint.

These retry settings are provider implementation evidence, not a public SLA.
The controller must retain a durable fingerprint and terminal decision before
acknowledging a delivery. It should return a 2xx quickly for an accepted,
already-recorded duplicate and must not retry a valid request's business side
effect merely because the provider redelivered it.

## Fields available for allowlisting

The allowlist must be configured out of band and checked against the signed
payload where the field is guaranteed. The monitor and Alert APIs are the
authoritative source for fields that are not guaranteed in an
`event_alert` payload.

| Boundary | Authoritative source | Required policy |
| --- | --- | --- |
| Internal Integration installation | Top-level `installation.uuid`; organization installation API returns app UUID, installation UUID, and status. [List installations](https://docs.sentry.io/api/integration/list-an-organizations-integration-platform-installations/) | Pin one installed app UUID/installation UUID and require `status=installed`; do not accept another organization's installation. |
| Organization | Alert/monitor API path and configuration | Pin the numeric organization ID. `event_alert` does not guarantee a top-level organization field; do not infer tenancy from a display name or URL. |
| Project | Uptime monitor API `projectId`; serialized event may contain project data | Pin one project ID and verify it from API configuration and event data where present. |
| Uptime monitor | Organization monitor API returns `id`, `projectId`, `type=uptime_domain_failure`, `workflowIds`, URL/method data, and thresholds. [List monitors](https://docs.sentry.io/api/monitors/fetch-an-organizations-monitors/) | Pin the exact monitor ID, URL, method, and environment. The base `event_alert` payload does not guarantee a monitor ID. |
| Alert/workflow | Organization Alert API returns the Alert/workflow ID and connected monitor IDs. [Fetch alerts](https://docs.sentry.io/api/monitors/fetch-alerts/) | Pin the exact Alert/workflow ID and connected monitor set. Do not rely on `triggered_rule` text alone; it is a label. |
| Resource/action | Webhook header + top-level action | For Uptime use exactly `event_alert` + `triggered`; reject `metric_alert`, `warning`, and `resolved` unless a separate contract is explicitly implemented. |

The monitor API example also shows `config.environment`,
`config.downtimeThreshold`, and `config.recoveryThreshold`; these are useful
drift checks, but they are not proof of current health. The controller must
re-probe both origins and the Production DB before changing DNS.

## Repository evidence and reuse boundary

The existing Lightsail control plane establishes the right authority boundary:
Sentry supplies an authenticated signal, while the host owns probes, counters,
route decisions, and state (`backend/deploy/lightsail/SENTRY_DB_FAILOVER.md`,
lines 1-12).

Reusable security primitives already exist:

- Raw-body size and base64 handling, HMAC-SHA256, and fixed-size constant-time
  comparison: [`security.mjs`](../lightsail/sentry-db-failover/src/security.mjs#L50-L104).
- Existing metric-alert normalization and signed timestamp extraction:
  [`security.mjs`](../lightsail/sentry-db-failover/src/security.mjs#L193-L243).
- Installation, organization, project, environment, rule, resource, action,
  aggregate, threshold, and query allowlists:
  [`security.mjs`](../lightsail/sentry-db-failover/src/security.mjs#L275-L351).
- Receiver-side authentication-before-parse, timestamp checks, durable replay
  handling, and asynchronous queue acknowledgment:
  [`receiver.mjs`](../lightsail/sentry-db-failover/src/receiver.mjs#L204-L252),
  [`receiver.mjs`](../lightsail/sentry-db-failover/src/receiver.mjs#L268-L327),
  and [`receiver.mjs`](../lightsail/sentry-db-failover/src/receiver.mjs#L330-L410).

The metric-alert parser and allowlist **cannot** be reused unchanged for an
Uptime outage. They require `data.metric_alert`, `alert_rule`, metric
aggregate/window/trigger fields, and `metric_alert` as the resource. An Uptime
Alert produces an `event_alert` payload whose documented data is an event and
issue-alert envelope. The implementation therefore needs a separate
resource-specific parser/policy (or the Sentry configuration must be changed to
a metric alert, which would no longer be Uptime monitoring).

## Live configuration status (blocked)

No live Sentry project or alert configuration could be read in this worktree:

- There is no local Sentry API token or project-specific identifier set. The
  existing Lightsail read-only audit script fails closed with
  `SENTRY_API_TOKEN is required`; that audit is separate from the Fallback
  controller runtime.
- The committed Lightsail workflow names its protected audit values
  (`SENTRY_API_TOKEN`, `SENTRY_INSTALLATION_ID`,
  `SENTRY_ORGANIZATION_ID`, `SENTRY_PROJECT_ID`, `SENTRY_PROJECT_SLUG`, and
  `SENTRY_RULE_IDS`) but contains no values. See
  [db-failover-infra.yml](../../../.github/workflows/db-failover-infra.yml#L175-L202)
  and [the production job](../../../.github/workflows/db-failover-infra.yml#L256-L283).
- `backend/env.example` contains only placeholders for the application DSN/
  org/project settings ([lines 27-33](../../env.example#L27-L33)); no live
  monitor ID, Alert/Workflow ID, Internal Integration UUID, or webhook delivery
  has been captured. Controller values belong only in the failover-scoped
  `controller.env` described in
  [CONTROLLER_OPERATIONS.md](./CONTROLLER_OPERATIONS.md).

Because an official documentation example is not a delivery from this project,
no `fixtures/sentry-uptime-alert.json` was added. Creating one from guessed
IDs, timestamps, or signatures would turn synthetic data into false authority.

### Unblock criteria

Run the existing read-only Sentry audit in a protected environment with the
real values, then capture a **sanitized** test Alert delivery (body shape and
header names only; remove IDs that identify the account, signatures, URLs with
tenant data, and all secrets). Confirm all of the following before installing
or arming the controller:

1. The Uptime monitor exists, is enabled, and has the intended URL, project,
   environment, failure tolerance, and recovery tolerance.
2. An Alert is connected to exactly that monitor and has an Internal
   Integration action enabled for `event_alert.triggered`.
3. The delivery contains `Sentry-Hook-Resource: event_alert`, a valid
   `Sentry-Hook-Signature`, and the expected installation UUID.
4. The endpoint receives the request over public HTTPS and can acknowledge it
   within one second.
5. A duplicate delivery has the same body fingerprint or is otherwise safely
   treated as a no-op; no DNS change occurs during the capture.

Before setting `FAILOVER_CONTROLLER_ENABLED=true`, also clear the Fallback
host blockers in [NETWORK_PREFLIGHT.md](./NETWORK_PREFLIGHT.md): authoritative
inbound routing/TLS (the observed private/CGNAT path is not sufficient), fixed
outbound egress, Node.js 20+, and an installed controller service. Then prove a
non-production Vercel DNS write/read-back with the exact record allowlist. A
synthetic unit payload, local loopback health response, or passing CI test is
not activation evidence.
