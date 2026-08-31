# Fallback Server network preflight

This preflight covers the existing physical Covenant host that is intended to
run the **Fallback Server**. It is an observation record for the
event-driven failover-controller plan; it does not authorize installation,
routing, firewall, DNS, or provider changes.

## Observation boundary

- **Observed at:** `2026-08-31T10:10:17Z` (UTC)
- **Access path:** existing SSH alias `covenant` (the alias resolves to the
  configured Covenant host; its target is intentionally not reproduced here)
- **Mode:** read-only remote inspection; no files, services, containers,
  firewall rules, DNS records, or external provider settings were changed
- **Redaction:** no IP address, hostname target, credential, token, or raw
  network response is stored in this document. Address observations below are
  represented only by counts or short SHA-256 prefixes.

The checks used the host's existing `uname`, `/etc/os-release`, `nproc`,
`/proc/meminfo`, `df`, Docker/Compose and systemd status commands, socket
listener queries, `ip` route/address metadata, two public IPv4 echo providers,
`dig`, and HTTPS status probes. A single observation is never treated as proof
that an address is statically allocated.

## Host capability results

| Check | Evidence | Result |
| --- | --- | --- |
| OS and architecture | Ubuntu 26.04 LTS; Linux x86_64 | **PASS** |
| CPU | 12 logical CPUs | **PASS** |
| Memory | 31,664,484 KiB total; 25,333,920 KiB available at observation time | **PASS** |
| Root disk | 489,997,189,120 bytes total; 35,105,488,896 used; 429,925,998,592 available | **PASS** |
| Docker | Docker 29.7.2; daemon accessible to the SSH user | **PASS** |
| Compose | Docker Compose 5.5.0 | **PASS** |
| systemd | systemd 259; system state `running`; Docker unit `active` | **PASS** |
| Existing runtime | Zero running containers | **PASS (clean host)** |

The capacity checks show that the host can run the bounded API-only fallback
profile. They do not prove production DB connectivity, image parity, or
application readiness; those are separate runtime gates.

## Inbound listener and routing results

Listener checks used `ss -H -ltn` and reported only the requested port state:

| Port or service | Observation | Result |
| --- | --- | --- |
| TCP 80 | Not listening | **FAIL for direct HTTP ingress** |
| TCP 443 | Not listening | **FAIL for direct HTTPS ingress** |
| TCP 3001 | Not listening | **PASS for no public backend bind** |
| TCP 3101 | Not listening | **PASS for no staged API bind** |
| `babyjamjam-failover-controller.service` | Unit file absent; service inactive | **FAIL for live controller activation** |
| Caddy, Nginx, HAProxy, Cloudflare Tunnel | Binaries, unit files, and active services absent | **FAIL for a prepared ingress path** |

The host has an IPv4 default route, but the interface inventory contained **0
public candidates**, **3 private addresses**, and **1 carrier-grade NAT (CGNAT)
address**. This is consistent with a private LAN/CGNAT path and does not expose
an origin that Vercel DNS can reach directly. UFW was inactive or unavailable;
firewalld was inactive. No firewall change was attempted.

### DNS observations (not a change authorization)

The public authoritative nameserver names are `ns1.vercel-dns.com` and
`ns2.vercel-dns.com`. Read-only DNS queries returned:

- `api.babyjamjam.com`: one A answer, TTL 60; answer-set fingerprint
  `bb7724d62b9e`.
- `failover.babyjamjam.com`: two A answers, TTL 1791; answer-set fingerprint
  `1285e5e7aefd` from the host resolver. Public resolver answer-set
  fingerprints differed (`12e9f4e75989` vs `00cbfb38531f`) while each returned
  two answers.

These records are not evidence that either address belongs to the Covenant
host. Resolver disagreement and the absence of a public local address mean an
inbound fixed origin is **not authoritative or verified**. The existing
`failover` hostname returned HTTPS 404, which proves only that some TLS edge
currently answers there; it does not prove a Fallback Server listener.

## Outbound address and NAT results

Three IPv4 observations one second apart from `api.ipify.org` produced the
same redacted fingerprint (`29f1b926cb59`), and a second provider (`ifconfig.me`)
agreed with that fingerprint. This is a short-lived stability observation,
not proof of a reserved/static address, ISP contract, or Aligo registration.

Because no local public address was present and a CGNAT address was observed,
the likely path is NAT/CGNAT (or an unobserved tunnel/proxy). No tunnel client
was installed or detected. Therefore:

- **Fixed outbound IPv4:** **NO-GO / unverified**. Keep Aligo credentials and
  SMS-producing paths disabled until an authoritative fixed egress is
  provisioned, observed over a change/restart boundary, and registered with a
  no-send authentication check.
- **NAT/CGNAT certainty:** **NO-GO / unresolved**. The observations support
  likely NAT/CGNAT but cannot identify the owning router, lease policy, or
  whether the observed egress is reserved.

## TLS and certificate pre-staging

`openssl` is present, but Caddy, Nginx, HAProxy, Cloudflare Tunnel, and Certbot
are absent. `/etc/letsencrypt`, `/etc/caddy`, and `/etc/nginx` are absent, and
TCP 443 is not listening. The current `api.babyjamjam.com` readiness probe
returned no HTTP status (`000`) from the host; the existing `failover` hostname
returned `404`. No ACME request or certificate issuance was attempted.

TLS pre-staging is therefore **NO-GO** on this host until an approved ingress
design exists (for example, a fixed public address with port 443 forwarding or
a Cloudflare Tunnel), a dedicated hostname is assigned, and certificate
ownership/renewal is proven. The controller webhook must not share the API
origin without that boundary.

## Activation blockers

The following blockers must be resolved before any dark deploy or production
activation:

1. Provision an authoritative inbound path to the host: an ISP/static public
   IPv4 with 443 forwarding, or an approved tunnel/reverse-proxy origin. A
   private/CGNAT observation alone is insufficient.
2. Define and reserve the controller listener port and install its systemd
   unit. The current host has no controller service or listener.
3. Pre-stage TLS for both the API cutover origin and the separate Sentry
   webhook hostname; prove renewal and routing without changing production DNS.
4. Obtain authoritative fixed-egress evidence (ISP reservation or fixed NAT
   gateway), then register and no-send-check that egress with Aligo. Until
   then, Aligo and SMS remain disabled by the passive Compose contract.
5. Reconcile ownership of the existing `failover.babyjamjam.com` records and
   resolver disagreement before using that name for a webhook or origin.
6. Separately prove Production DB identity, immutable image identity, and
   `/health/ready` from the staged runtime. This network preflight did not
   access DB credentials or start the backend.
7. Obtain explicit firewall/DNS/Vercel approvals for the narrowly scoped
   changes; none were exercised here.

## Decision

| Decision | Status | Boundary |
| --- | --- | --- |
| Continue local implementation and contract tests | **GO** | Host capacity and read-only evidence are sufficient to implement against abstract probes; no live network mutation is implied. |
| Install a dark controller on this host now | **NO-GO** | No inbound listener, controller unit, TLS termination, or fixed-origin proof. |
| Activate AWS → Fallback DNS failover now | **NO-GO** | Inbound public origin and fixed egress are unverified; DNS/TLS and controller blockers remain. |
| Enable Aligo or SMS on Fallback | **NO-GO** | Outbound address is only a short observation and has no authoritative registration. |

The next safe step is to resolve the blockers through separately approved
network/edge work, then rerun this preflight from the same SSH alias and record
new evidence. No claim of static IP, public reachability, or production
readiness should be made from this snapshot.
