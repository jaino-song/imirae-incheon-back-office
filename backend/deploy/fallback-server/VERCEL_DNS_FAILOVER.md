# Vercel DNS failover contract

Status: **client implemented locally; production mutation remains action-time gated**
Captured: 2026-08-31 (Asia/Seoul)
Scope: the team-owned `babyjamjam.com` Vercel DNS zone and the single
`api.babyjamjam.com` record used by the Fallback Server controller.

This document records the read-only provider checks and the narrow API contract
implemented by `backend/deploy/fallback-server/controller/vercel-dns-client.mjs`.
It does not create, update,
delete, or rehearse a DNS record, and it does not retain a Vercel token, team
ID, record ID, or origin IP address.

The end-to-end install, arm/disarm, cutover, and manual failback procedure is
in [CONTROLLER_OPERATIONS.md](./CONTROLLER_OPERATIONS.md).

The repository ships the controller installer, bundle sources, systemd unit
source, and CLI, but none is installed or activated on the Covenant host. A
passing local client test does not authorize a production DNS mutation.

## Live provider state (read-only)

The following facts were captured without mutating Vercel or DNS:

- `dig NS babyjamjam.com` returned two Vercel-associated authoritative
  nameservers. This establishes Vercel as the current DNS authority, rather
  than merely the frontend deployment host.
- `dig A api.babyjamjam.com` returned one IPv4 answer with a 60-second TTL.
  The value matched the value of the Vercel `api`/`A` record in the read-only
  API response.
- A team-scoped request to
  `GET /v5/domains/babyjamjam.com/records?teamId=<team-id>&limit=100` returned
  HTTP 200. The response contained exactly one record with `name=api`,
  `type=A`, and `ttl=60`.
- The same request shape on `/v4/.../records` also returned HTTP 200. The
  current endpoint page and the current official SDK generate `/v5`; the
  controller therefore pins `/v5` and treats an endpoint-version change as a
  preflight failure. The Vercel knowledge-base export example still shows
  `/v4`, so it must not be copied without rechecking the current contract.
- `GET /v6/domains/babyjamjam.com/config?teamId=<team-id>` returned HTTP 200.
  The domain is verified, its DNS zone is enabled, and the provider metadata
  is Vercel-hosted with two nameservers.
- The API request without a bearer token, and the request with a bearer token
  but no valid team scope, returned HTTP 403. Team scoping is therefore
  required for this team-owned domain.

The read-only probe used an existing local CLI authentication context only for
the duration of the requests. No credential or provider response was written
to the repository or to the fixture below.

## API contract

### Authentication and team scope

All calls use `https://api.vercel.com` and a bearer access token:

```http
Authorization: Bearer <token>
Accept: application/json
```

For this team-owned domain, pass exactly one of the provider's supported scope
selectors (`teamId` is preferred; `slug` is an alternative). The controller's
root-only environment must hold the approved team scope and must never accept a
scope selector from a webhook body or an operator command.

The read preflight proves that the current operator context can read the team
domain. It does **not** prove that a future token has DNS-write permission.
Write authorization must be verified during the separately approved
non-production rehearsal; no production `PATCH` was attempted here.

### List/read records

Use the list endpoint for both the before-write and after-write read. It is the
only read contract required by the controller:

```http
GET /v5/domains/{domain}/records?teamId={teamId}&limit=100
```

The current response is an object with these keys:

```json
{
  "records": [
    {
      "id": "rec_<record-id>",
      "slug": "<team-slug>",
      "name": "api",
      "type": "A",
      "value": "<ipv4>",
      "creator": "<creator>",
      "created": 1700000000000,
      "updated": 1700000000000,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000,
      "ttl": 60,
      "comment": "<optional-comment>"
    }
  ],
  "pagination": {
    "count": 1,
    "next": null,
    "prev": null
  }
}
```

The `records` fields observed in the live response are `id`, `slug`, `name`,
`type`, `value`, `creator`, `created`, `updated`, `createdAt`, `updatedAt`,
`ttl`, and `comment`. `pagination` contains `count` and nullable `next` and
`prev` timestamps. The sanitized fixture at
[`fixtures/vercel-dns-record.json`](./fixtures/vercel-dns-record.json) mirrors
this shape with documentation-only values.

The record `name` is the subdomain prefix (`api`), not the fully qualified
hostname. The controller must require exactly one matching record and must
reject missing, duplicate, or unexpected records before any write.

The SDK repository also exposes an unversioned `GET /domains/records/{recordId}`
operation. A live read of that path returned 404 for the current record, so it
is not a controller dependency. The list endpoint above is the authoritative
read-before/read-after contract.

### Update an existing record

The update endpoint is a record-ID operation. It is not a domain-name update:

```http
PATCH /v1/domains/records/{recordId}?teamId={teamId}
Content-Type: application/json
Authorization: Bearer <token>
```

The current official SDK request body permits `name`, `value`, `type`, `ttl`,
`mxPriority`, `srv`, `https`, and `comment`. For this failover record the
controller sends only the immutable identity and the new target value:

```json
{
  "name": "api",
  "type": "A",
  "value": "<approved-fallback-ipv4>",
  "ttl": 60
}
```

The current successful response (HTTP 200) has the following fields:

```json
{
  "id": "rec_<record-id>",
  "name": "api",
  "type": "record",
  "value": "<approved-fallback-ipv4>",
  "creator": "<creator>",
  "domain": "babyjamjam.com",
  "ttl": 60,
  "comment": "<optional-comment>",
  "recordType": "A",
  "createdAt": 1700000000000
}
```

`type` in the update response is the Vercel record kind (`record` or
`record-sys`); `recordType` is the DNS type (`A`). The controller must verify
both the response identity and a fresh list read after the update.

The API request schema has no `expectedValue`, ETag, version, or other
server-side compare-and-swap field. This is why the controller must implement
the following client-side precondition under its exclusive incident lock:

1. Read the list and find exactly one record whose ID, name, type, and TTL
   equal the preflight contract.
2. Require the current value to equal the allowlisted AWS origin value.
3. Atomically reserve durable controller phase `DNS_COMMITTING` only after the
   current state still has the same pending fingerprint/generation lineage and
   `armed=true`. A disarm before this reservation prevents the PATCH; a disarm
   during `DNS_COMMITTING` is refused until the provider record is reconciled.
4. Send the one `PATCH` above, preserving the record ID, name, type, and TTL.
5. Read the list again and require the same record ID/name/type with the
   allowlisted Fallback value and unchanged TTL.

Any mismatch, record drift, or ambiguous timeout is `BLOCKED`; it is not a
permission to retry indefinitely.

### Domain configuration read

The preflight/provider check uses:

```http
GET /v6/domains/{domain}/config?teamId={teamId}
```

The response includes provider configuration such as `serviceType`,
`nameservers`, `aValues`, `cnames`, `misconfigured`, and `dnssecEnabled`. The
controller may use this endpoint only as a read-only provider/zone sanity
check; it must not change nameservers or domain configuration.

## Rate limits and error behavior

Vercel documents rate-limit response headers
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. A 429
response is a provider-rate-limit condition, not evidence that the DNS write
succeeded. The controller records a safe terminal reason and requires live
reconciliation.

The current official SDK marks these transport statuses as retry-capable by
default: `429`, `500`, `502`, `503`, and `504`. The failover policy is stricter:
there is no unbounded retry loop, and an update timeout or ambiguous response
must be reconciled with a fresh list read before any further operator action.

The generated update operation recognizes `400`, `401`, `402`, `403`, `404`,
`409`, `410`, and `5xx` responses. List reads recognize `400`, `401`, `403`,
`404`, `410`, and `5xx`. In all cases the controller stores only the HTTP
status and a safe reason; it never stores provider bodies, tokens, record IDs,
team IDs, or IP addresses.

## Controller allowlist and mutation boundary

The production controller may be configured with only the following fixed
values, supplied through the root-owned mode-0600 `controller.env` file:

- domain: `babyjamjam.com`;
- record name: `api`;
- record type: `A`;
- preflight-captured record ID;
- team ID (or, only if explicitly approved, the equivalent team slug);
- the approved AWS origin IPv4;
- the approved Fallback Server IPv4;
- the expected TTL: `60` seconds.

The corresponding failover-scoped variables are
`FAILOVER_VERCEL_API_TOKEN`, `FAILOVER_VERCEL_TEAM_ID`,
`FAILOVER_VERCEL_DNS_RECORD_ID`, `FAILOVER_PRIMARY_IPV4`, and
`FAILOVER_FALLBACK_IPV4`. The token and record scope are never accepted from
Sentry payloads or operator arguments. The controller configuration parser
rejects generic `VERCEL_*` names and rejects a missing or malformed value even
when enabled mode is requested.

The client is not allowed to create or delete records, alter nameservers,
change TTL, mutate unrelated records, update a frontend deployment, or accept
arbitrary domain/IP values from Sentry. The only production mutation is one
bounded `PATCH` from the approved AWS value to the approved Fallback value,
followed by a read-after-write check.

Vercel documents a default 60-second DNS TTL, but also warns that normal DNS
records can take minutes (and in some cases up to 24 hours) to propagate. The
180-second incident objective therefore applies to the controller's bounded
provider decision and verification, not to a guarantee that every recursive
resolver has refreshed.

## Cutover, manual check, and failback

The controller may issue exactly one restricted update from the allowlisted AWS
IPv4 to the allowlisted Fallback IPv4 after the Sentry event, health, DB,
release, passive-gate, and current-DNS checks pass. It first reserves durable
phase `DNS_COMMITTING`, then performs the PATCH and a fresh list read, and
persists `FALLBACK_ACTIVE` only after read-after-write confirms the same record
identity and TTL. On restart, `DNS_COMMITTING` is reconciled against the live
record; the controller never promotes from state alone.

There is no automatic Fallback → AWS update. An operator must disarm the
controller, verify AWS readiness and eFormsign/document reconciliation, read
the current record, manually approve the reverse PATCH, and verify public DNS
and authenticated smoke tests. A Vercel timeout, 429/5xx, record drift, or
ambiguous response is a `MANUAL_CHECK`/`BLOCKED` condition; do not issue a
second PATCH until the live record is reconciled.

## Safe non-production rehearsal design

Mutation rehearsal is **action-time gated** and was not run during this
preflight. Before production arming, create or nominate a separate test zone
or a dedicated test record such as `failover-rehearsal.babyjamjam.com`; never
use `api.babyjamjam.com` for a rehearsal.

The rehearsal must satisfy all of the following:

1. Capture the test record's exact ID, team scope, name, type, and TTL from a
   fresh list response at action time. Do not copy the production record ID.
2. Use documentation-only TEST-NET values (for example, `192.0.2.10` and
   `198.51.100.20`) or another isolated pair that cannot route production
   traffic. Do not point a test hostname at the Production API.
3. Use a separately scoped token/team when Vercel access controls permit. If
   the provider cannot express record-level scope, isolate the rehearsal in a
   dedicated team/domain and obtain explicit approval for that token's scope.
4. Run the controller with injected test adapters and an isolated test record.
   The production configuration has no rehearsal-only override; unknown
   failover environment names are rejected. Prove read-before-write, one
   update, read-after-write, state persistence, and restoration of the original
   test value.
5. Exercise duplicate delivery, concurrent delivery, record drift, 429/5xx,
   an ambiguous timeout, and manual restoration. Each case must prove that no
   second update is issued and that the terminal state is safe.
6. Reconcile the test record through the live list endpoint after every
   scenario. Delete the test record only through a separately approved
   cleanup operation; this contract authorizes no such mutation.

## Evidence classification

| Classification | Evidence | Consequence |
|---|---|---|
| Confirmed | Vercel nameservers are authoritative for `babyjamjam.com`; the team-scoped domain is verified and its zone is enabled. | Vercel DNS is the provider to which the controller contract applies. |
| Confirmed | One live `api`/`A` record exists with TTL 60, and its value matched the public A answer. | The production precondition can be checked by list read plus public DNS reconciliation. |
| Confirmed | Team-scoped list reads succeed on `/v5`; no-token/no-team reads return 403. | Store a fixed team scope and bearer token in protected runtime configuration. |
| Confirmed | Current SDK/docs contract `GET /v5/.../records` and `PATCH /v1/domains/records/{recordId}`; PATCH accepts `teamId`/`slug` query scope. | Implement the client against these exact paths and pin the record ID. |
| Inferred | The PATCH schema has no expected-current-value or ETag field. | Client-side read-before-write and read-after-write checks are mandatory. |
| Inferred | A 60-second TTL improves normal cache turnover but does not guarantee global propagation within 180 seconds. | Treat the 180-second target as a controller decision bound, not universal DNS convergence. |
| Blocked | Production DNS-write permission and least-privilege token scope were not exercised because PATCH mutation is action-time gated. | Verify only in the approved isolated test-record rehearsal. |
| Blocked | The production record ID, team ID/slug, AWS IPv4, and Fallback IPv4 are intentionally absent from Git. | Inject them through root-only runtime configuration after live preflight. |
| Blocked | No test record was created or changed, and no production record was mutated. | Do not arm automatic failover until the rehearsal evidence is attached. |

## Edge activation blockers

The Vercel record contract does not establish that the Fallback origin is
reachable. The [Fallback network preflight](./NETWORK_PREFLIGHT.md) observed no
public Covenant IPv4, no TCP 443 listener, no TLS terminator, and a likely
private/CGNAT path. Before using this client, clear those blockers with an
authoritative static origin or an approved tunnel/reverse proxy and pre-stage
TLS for `api.babyjamjam.com` and the separate Sentry endpoint. Fixed outbound
egress is a separate gate for Aligo and remains disabled until independently
verified.

The client and controller are implemented in the repository, but no Vercel
write permission, production PATCH, or test-record rehearsal has been
exercised. A passing unit test or a successful read does not authorize a
production update.

## Repository evidence

The repository already fixes the surrounding ownership boundaries:

- The Covenant/Fallback API binds to loopback and requires a separately
  approved tunnel or proxy for inbound traffic; the operator explicitly does
  not change DNS, Vercel, or Cloudflare
  ([`backend/deploy/fallback-server/README.md#safety-boundary`](./README.md#safety-boundary),
  [`backend/deploy/fallback-server/operator.sh:60-62`](./operator.sh)).
- The controller's Vercel path is implemented but not installed or activated;
  until its action-time rehearsal is approved, incident cutover remains an
  external DNS/load-balancer operation and
  must follow readiness, eFormsign reconciliation, and public smoke checks
  ([`backend/deploy/fallback-server/README.md#runtime-status-and-incident-flow`](./README.md#runtime-status-and-incident-flow)).
- The accepted failover ADR narrows this client to one `api`/`A` record, two
  allowlisted origin values, pre/post reads, and no indefinite retry
  ([`docs/adr/ADR-008-sentry-host-failover-controller.md#restricted-vercel-dns-mutation`](../../../docs/adr/ADR-008-sentry-host-failover-controller.md#restricted-vercel-dns-mutation)).
- The Fallback Server remains API-only with schedulers, document jobs,
  reconciliation, and Aligo disabled while traffic ownership is unchanged
  ([`docs/adr/ADR-008-sentry-host-failover-controller.md#independent-verification-policy`](../../../docs/adr/ADR-008-sentry-host-failover-controller.md#independent-verification-policy)).
- Lightsail maps the existing production hostname to its production edge and
  keeps port 3001 private; this controller changes neither the edge Compose
  contract nor the frontend deployment
  ([`backend/deploy/lightsail/README.md:12-20`](../lightsail/README.md),
  [`backend/deploy/lightsail/README.md:64-65`](../lightsail/README.md)).

## Official Vercel sources

All links below are official Vercel documentation or the official Vercel SDK
repository, consulted on 2026-08-31:

- [REST API overview](https://vercel.com/docs/rest-api) — bearer
  authentication, team query scoping, API base URL, and rate-limit headers.
- [List existing DNS records](https://vercel.com/docs/rest-api/dns/list-existing-dns-records)
  — current list endpoint and response contract.
- [Update an existing DNS record](https://vercel.com/docs/rest-api/dns/update-an-existing-dns-record)
  — record-ID PATCH endpoint, body fields, and response contract.
- [Get a domain's configuration](https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration)
  — provider and nameserver configuration read.
- [Vercel API errors](https://vercel.com/docs/rest-api/errors) — generic,
  domain, and rate-limit error behavior.
- [Vercel API limits](https://vercel.com/docs/limits) — rate-limit model and
  reset behavior.
- [Managing DNS records](https://vercel.com/docs/domains/managing-dns-records)
  — Vercel nameserver requirement, TTL defaults, and propagation caveat.
- [Official SDK list implementation](https://github.com/vercel/sdk/blob/main/src/funcs/dnsGetRecords.ts)
  — generated `/v5` list path and status handling.
- [Official SDK update implementation](https://github.com/vercel/sdk/blob/main/src/funcs/dnsUpdateRecord.ts)
  — generated `/v1` PATCH path, scope query parameters, and retry/status
  handling.
