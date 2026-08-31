# ADR-007: Fallback Server API-only production standby

## Status

Proposed

## Context

BabyJamJam's Vercel frontend can remain healthy while the AWS Lightsail backend
is unavailable. Changing `NEXT_PUBLIC_API_BASE_URL` during an incident would
require a new Vercel deployment, and running a second fully active backend risks
duplicate schedulers, message sends, eformsign retries, and reconciliation.

The existing Lightsail deployment already separates immutable application
images, private API ports, Valkey, public edge routing, database readiness, and
singleton scheduler ownership. The physical Covenant server has sufficient
container capacity but is a separate non-AWS host and must not inherit AWS
Systems Manager or Lightsail operator assumptions. In this ADR, `Covenant
server` names that physical host; `Fallback Server` is the logical production
role assigned to it.

## Decision

Maintain the Fallback Server on the physical Covenant server as a warm,
API-only standby behind the stable `api.babyjamjam.com` hostname.

The Fallback Server:

1. runs the exact production backend image selected by commit SHA and digest;
2. binds the API only to host loopback for a separately managed tunnel or proxy;
3. uses the Production DB with production-compatible auth, storage, eformsign,
   and webhook configuration;
4. hard-disables schedulers, auto-finalizers, eformsign reconciliation without
   a distributed lock, document-job intake, and document-job workers;
5. blanks Aligo credentials until Covenant fixed egress is registered and
   independently verified;
6. never applies database migrations;
7. reports local container health, restart count, database readiness, release
   identity, and passive-gate state without claiming public routing;
8. leaves DNS/load-balancer cutover and Aligo outbound-IP authorization as
   separately approved external operations.

This role rename is documentation-only. Deployment paths and service names
under `backend/deploy/covenant/` remain unchanged until the Phase 2 rename.

## Alternatives considered

1. **Change Vercel's backend URL during each incident.** Rejected because the
   public environment variable applies only to a new deployment and increases
   recovery time and configuration drift.
2. **Run Covenant active-active with AWS.** Rejected because current singleton
   schedulers and document workers do not have a cross-host ownership lease.
3. **Copy the Lightsail Systems Manager operator.** Rejected because its IAM,
   managed-node, protected-host, and production/preview assumptions are AWS and
   host specific.
4. **Use localhost only during outages.** Retained as a manual last resort, but
   it does not restore the working Vercel frontend for other operators.

## Consequences

### Positive

- Vercel keeps one stable API hostname.
- The Fallback Server is prebuilt and can be health-checked before an outage.
- Autonomous duplicate side effects remain fenced off.
- The same immutable production image and DB-backed readiness contract are
  retained across hosts.

### Negative

- The Fallback Server initially restores synchronous API behavior only.
- DNS or load-balancer cutover remains a separate operational action.
- Aligo requires a fixed Covenant outbound IPv4 before SMS can be considered
  safe.
- Production-compatible secrets must be provisioned and rotated on a second
  host.

## Risks

- **Split-brain provider mutations:** mitigated by fixed passive overrides in
  Compose and runtime inspection in the operator.
- **Ambiguous eformsign completion:** mitigated by reconciliation before retry.
- **Mutable or incorrect image:** mitigated by digest pull plus embedded revision
  verification.
- **Public exposure of the Nest port:** mitigated by loopback-only publishing.
- **Secret leakage:** mitigated by root-owned mode-0600 environment files and
  secret-free operator output.
- **False failover success:** mitigated by separating local readiness from public
  routing and requiring post-cutover authenticated smoke checks.
