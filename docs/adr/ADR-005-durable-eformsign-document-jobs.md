# ADR-005: Durable eformsign document jobs

## Status

Accepted

## Date

2026-08-13

## Context

Creating and finalizing an eformsign document can outlive the HTTP request that
started it. Browser automation can also return an ambiguous outcome: the vendor
may have accepted a send even when the local click or response was interrupted.
Keeping this state only in process memory makes retries unsafe, loses progress
after a restart, and can duplicate a provider operation.

The existing `eformsign_doc` table is the provider-document mirror. It is not a
job queue: a create operation does not have a provider document identity yet, and
provider identity can arrive before the mirror row is reconciled. A separate
durable table is therefore required.

## Decision

1. Add `eformsign_document_job` as an additive, branch-scoped durable job table.
   `request_key` is the idempotency key for the requested operation. `active_key`
   is nullable so a completed or terminal job can release its active claim while
   retaining its request history. The database enforces request uniqueness and
   active-key uniqueness. PostgreSQL unique indexes permit multiple null values,
   so terminal jobs can release the key without a Prisma/SQL drift mismatch.
2. Store `job_type`, `source`, and `status` as constrained strings. The allowed
   values are intentionally enforced by PostgreSQL CHECK constraints so all
   writers, including repair scripts, share the same state vocabulary.
3. Claiming is atomic in PostgreSQL. A worker selects eligible rows with a
   transaction-safe row lock (`FOR UPDATE SKIP LOCKED`) and changes the status,
   attempt count, and heartbeat in the same transaction. A worker never relies
   on an in-memory lock or an application-side check-then-update sequence.
4. The headless provider dispatcher retains its global maximum of three active
   browser operations. Durable rows provide recovery and reconciliation; they do
   not increase the provider concurrency limit.
5. `payload` contains only the minimum sanitized input needed to resume the
   operation. Credentials, cookies, access tokens, raw provider responses, and
   personal data not required to resume are never persisted. After a job reaches
   a terminal outcome or no longer needs its request body, the worker clears the
   payload while retaining the SHA-256 `payload_fingerprint`, progress marker,
   and sanitized machine `last_error_code` for audit and deduplication.
6. `document_id` is an optional provider identity string, deliberately without a
   foreign key to `eformsign_doc`: create jobs begin before a provider identity
   exists, and reconciliation may observe the provider before the local mirror
   row is written. `client_id` remains an optional foreign key with `SET NULL`.
7. The schema and SQL patch add no dependencies, queues, extensions, or live
   database changes. The database-patches workflow applies and verifies the
   patch independently in dev, preview, and production.
8. Unresolved `requires_attention` rows are retained and keep their active key
   so a staff or scheduler retry cannot duplicate an ambiguous provider send.
   The branch list is bounded to the newest 50 rows. A future authorized
   reconciliation operation may resolve them; they are not auto-deleted.

## Consequences

### Positive

- Restarts, deploys, and worker crashes preserve enough state to resume or
  reconcile without blindly retrying an ambiguous provider send.
- PostgreSQL provides the idempotency and claim boundaries shared by all worker
  replicas.
- The existing three-browser global cap remains explicit and unchanged.
- Payload minimization and clearing reduce the retention of provider credentials
  and unnecessary personal data.

### Negative

- Workers must implement heartbeat/stale-claim recovery and explicit terminal
  transitions.
- Operational queries and retention jobs must account for an additional table.
- Prisma cannot model CHECK constraints; the SQL migration and verification
  script are authoritative for those value invariants.

## Risks and rollback

- Apply the additive migration before deploying code that creates or claims jobs.
- Verification fails closed when any required column, foreign key, CHECK
  constraint, or index is absent.
- No destructive down migration is provided. Rolling back application code leaves
  the additive table in place and is safe; removing it would require an explicit,
  separately approved retention and data-disposition decision.

## Production activation

The queue is intentionally fail-closed and must be enabled in dependency order:

1. Confirm the additive migration and production's single scheduler ownership.
2. Enable `EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED=true` and verify worker health.
3. Enable `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED=true` so new jobs can be
   accepted only after a worker is ready to drain them.
4. For contract auto-finalization, enable `CONTRACT_AUTO_FINALIZE_ENABLED=true`
   with a valid `CONTRACT_AUTO_FINALIZE_SINCE=YYYY-MM-DD` backlog fence.
5. Set `NEXT_PUBLIC_FEATURE_EFORMSIGN_DOCUMENT_JOBS=true` for the Production
   frontend and rebuild it. This public flag is inlined at build time; changing
   it without a new deployment does not expose the StatMini or asynchronous path.

Rollback reverses the intake first: disable the frontend flag and rebuild, then
set `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED=false`. Keep the worker enabled
until already accepted jobs reach a terminal state, then disable it. Preview's
global scheduler remains disabled, so it is not a valid worker-drain environment.
