# Railway to AWS Lightsail Seoul Backend Migration

## Summary

Migrate the BabyJamJam production NestJS backend from Railway Singapore to AWS Lightsail Seoul to reduce latency between Korean users, the backend, and Supabase Seoul.

The migration is intentionally incremental and reversible. Supabase PostgreSQL, Supabase Storage, Vercel frontends, and the Railway Preview backend remain unchanged initially.

## Goals

- Move `api.babyjamjam.com` to AWS Lightsail Seoul.
- Maintain the current API hostname and frontend configuration.
- Reduce backend-to-database and Korean user latency.
- Preserve Supabase PostgreSQL and Storage.
- Preserve Aligo, Eformsign, email, push, and Kakao integrations.
- Keep Railway available as an immediate rollback target.
- Maintain a steady-state infrastructure cost near $20/month.

## Non-goals

- Migrating PostgreSQL away from Supabase.
- Migrating Supabase Storage.
- Migrating the Preview backend during the initial rollout.
- Introducing active-active backend replicas.
- Changing API contracts or authentication behavior.
- Changing Vercel frontend hosting.

## Target Architecture

```text
Users in Korea
      |
      v
Vercel Frontend
      |
      v
api.babyjamjam.com
      |
      v
AWS Lightsail Seoul
NestJS Backend
      |
      +-- Supabase PostgreSQL Seoul
      +-- Supabase Storage
      +-- Aligo
      +-- Eformsign
      +-- Resend
      +-- Web Push
```

## Target Infrastructure

- AWS Lightsail Linux instance
- Region: Seoul (`ap-northeast-2`)
- Plan: 2 vCPU, 2 GB RAM, 60 GB SSD
- Expected base cost: $12/month
- Attached static IPv4
- Docker Compose
- Caddy or Nginx for HTTPS
- Daily automatic snapshots
- Lightsail metrics and alarms
- GitHub Actions deployment workflow

## Phase 1: Make the Backend Deployable

- [x] Add a multi-stage backend `Dockerfile`.
- [x] Add `.dockerignore`.
- [x] Add a production Docker Compose configuration.
- [x] Add Caddy or Nginx configuration.
- [x] Add a lightweight `/health` endpoint.
- [x] Add graceful `SIGTERM` shutdown handling.
- [x] Tag container images using the Git commit SHA.
- [x] Add deployment and rollback scripts.
- [x] Ensure runtime secrets are injected from a host-only environment file.

### Scheduler Safety

Railway and Lightsail will run simultaneously during validation. Scheduled jobs must not execute from both environments.

- [x] Add a global `SCHEDULERS_ENABLED` environment variable.
- [x] Apply the switch at Nest scheduler registration so every cron, interval, and timeout is covered.
- [x] Preserve current behavior by default and disable explicitly for the shadow deployment.
- [x] Add tests confirming disabled scheduler registration.
- [x] Document Railway as the scheduler owner during the shadow deployment.

## Phase 2: Create the Deployment Pipeline

- [ ] Add a manually triggered GitHub Actions workflow.
- [ ] Run lint.
- [ ] Run typecheck.
- [ ] Run unit and integration tests.
- [ ] Build the backend.
- [ ] Build the Docker image.
- [ ] Scan the image for critical vulnerabilities.
- [ ] Push the image to GHCR using the commit SHA.
- [ ] Require approval through the GitHub production environment.
- [ ] Deploy to Lightsail over SSH.
- [ ] Verify `/health` after deployment.
- [ ] Automatically restore the previous image when verification fails.

Automatic production deployment should remain disabled until the migration is stable.

## Phase 3: Provision Lightsail

- [x] Create the Lightsail instance in Seoul.
- [x] Attach a static IPv4.
- [x] Restrict SSH access to the Lightsail browser client.
- [x] Open public ports `80` and `443`.
- [x] Keep backend port `3001` private in Docker Compose.
- [x] Install Docker and Docker Compose.
- [x] Add the Caddy configuration; activate it with the shadow deployment.
- [x] Replace Railway-private Valkey with a private persistent Compose service.
- [ ] Enable automatic daily snapshots.
- [ ] Configure CPU and instance-status alarms.
- [ ] Configure an external uptime monitor.
- [ ] Create a non-root deployment user.
- [ ] Store the deployment SSH key securely.

## Phase 4: Deploy a Shadow Environment

Use a temporary hostname:

```text
seoul-api.babyjamjam.com
```

Deploy the production image with scheduled work disabled:

```env
SCHEDULERS_ENABLED=false
SERVICE_RECORD_AUTO_FINALIZE_ENABLED=false
```

- [ ] Configure production-equivalent environment variables.
- [ ] Keep secrets outside the repository and container image.
- [ ] Issue and verify HTTPS for the temporary hostname.
- [ ] Confirm the application starts after instance reboot.
- [ ] Confirm Docker automatically restarts unhealthy processes.

## Phase 5: Integration Validation

### Authentication

- [ ] Password login.
- [ ] Access-token validation.
- [ ] Refresh-token rotation.
- [ ] Logout.
- [ ] Kakao login and callback.
- [ ] Authorization and branch isolation.

### Core API

- [ ] Load the client list.
- [ ] Create and update a designated test client.
- [ ] Verify contracts and schedules.
- [ ] Verify message history.
- [ ] Verify service-record operations.
- [ ] Confirm Prisma connection stability.

### Supabase Storage

- [ ] Upload a test document.
- [ ] Generate a signed URL.
- [ ] Download the document.
- [ ] Delete the test document.
- [ ] Confirm private bucket behavior remains unchanged.

### External Integrations

- [ ] Register the Lightsail static IP with Aligo.
- [ ] Send one approved test SMS.
- [ ] Verify Eformsign authentication.
- [ ] Verify webhook processing.
- [ ] Verify Resend email delivery.
- [ ] Verify web-push delivery.

### Performance

- [ ] Measure Railway API latency from Korea.
- [ ] Measure Lightsail API latency from Korea.
- [ ] Compare p50 and p95 latency.
- [ ] Compare representative `/clients` response time.
- [ ] Monitor memory under realistic traffic.
- [ ] Confirm the process remains comfortably below the 2 GB limit.

## Phase 6: Prepare Production Cutover

- [ ] Record the existing Railway CNAME target.
- [ ] Record current Railway environment variables.
- [ ] Verify Railway and Lightsail run the same commit.
- [ ] Lower the DNS TTL for `api.babyjamjam.com`.
- [ ] Confirm the Lightsail rollback script works.
- [ ] Confirm Railway remains healthy.
- [ ] Confirm the Aligo Lightsail IP is active.
- [ ] Select a low-traffic cutover window.
- [ ] Prepare the rollback checklist.

## Phase 7: Production Cutover

Execute in this order:

1. Disable scheduled jobs on Railway.
2. Confirm the final Railway scheduler executions completed.
3. Enable scheduled jobs on Lightsail.
4. Replace the Railway CNAME with an `A` record pointing to the Lightsail static IPv4.
5. Wait for DNS propagation.
6. Verify HTTPS and `/health`.
7. Verify login and token refresh.
8. Verify the primary API flows.
9. Verify Aligo connectivity.
10. Monitor errors, latency, CPU, memory, and scheduler activity.

The Vercel API environment variables should not require changes because `api.babyjamjam.com` remains the public API hostname.

## Phase 8: Observation Period

Keep Railway production running with schedulers disabled as the rollback target.

Monitor:

- [ ] HTTP 4xx and 5xx rates.
- [ ] Login failures.
- [ ] API p50 and p95 latency.
- [ ] CPU and memory utilization.
- [ ] Container restarts.
- [ ] Prisma connection errors.
- [ ] Supabase Storage failures.
- [ ] Aligo failures.
- [ ] Eformsign failures.
- [ ] Missing scheduled jobs.
- [ ] Duplicate scheduled jobs.
- [ ] Unexpected outbound network failures.

## Phase 9: Railway Cleanup

After Lightsail has remained stable:

- [ ] Remove `api.babyjamjam.com` from Railway production.
- [ ] Stop the Railway production deployment.
- [ ] Preserve deployment and environment documentation.
- [ ] Keep Railway Preview unchanged.
- [ ] Remove obsolete Aligo Railway IPs.
- [ ] Confirm steady-state monthly cost.
- [ ] Update the infrastructure runbook.

## Rollback Plan

If the Lightsail deployment becomes unhealthy:

1. Disable scheduled jobs on Lightsail.
2. Restore the previous Railway DNS record.
3. Re-enable scheduled jobs on Railway.
4. Restore the Railway Aligo IP allowlist if necessary.
5. Verify login and core API traffic.
6. Verify scheduler execution.
7. Leave Lightsail running for diagnosis.

No database rollback is required because the migration does not move or modify the Supabase database.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Duplicate scheduled jobs | High during overlap | High | Global scheduler switch and explicit scheduler ownership |
| Missing scheduled jobs during cutover | Medium | High | Confirm the last and first execution on each platform |
| Lightsail memory exhaustion | Medium | High | Benchmark memory before cutover and configure a restart policy |
| DNS propagation delay | Medium | Medium | Lower TTL in advance and retain Railway |
| Aligo rejects the new IP | Low | High | Register and test the Lightsail IP before cutover |
| TLS issuance delay | Low | Medium | Validate using a temporary hostname first |
| Deployment cannot roll back | Low | High | Use immutable commit-tagged images and rehearse rollback |
| Secrets exposed during migration | Low | High | Use GitHub secrets and root-readable runtime files |
| Multi-instance cron duplication later | High | High | Introduce advisory locking or a dedicated worker before scaling |

## Acceptance Criteria

- [ ] `api.babyjamjam.com` resolves to Lightsail Seoul.
- [ ] HTTPS is valid.
- [ ] Password and Kakao login succeed.
- [ ] Core API flows pass.
- [ ] Supabase Storage remains operational.
- [ ] Aligo accepts the Lightsail static IP.
- [ ] Eformsign integration remains operational.
- [ ] Only one scheduler owner is active.
- [ ] No unexpected increase in 5xx errors.
- [ ] Korean latency is measurably better than Railway Singapore.
- [ ] Rollback to Railway has been rehearsed.
- [ ] Production hosting remains near the target monthly budget.

## Optional Follow-up

After production stabilizes:

- Evaluate moving Railway Preview to a separate $7 Lightsail instance.
- Ensure Preview and Production use separate databases before migration.
- Evaluate PostgreSQL advisory locks for all scheduled jobs.
- Evaluate a second production instance only after scheduler safety and memory usage are proven.
