# ADR 004: eformsign local source of truth

- Status: Accepted
- Date: 2026-07-29

## Context

Contract list rows were partly mirrored in `eformsign_doc`, while detail and PDF reads still called eformsign synchronously. This made customer-to-contract matching depend on when an external read happened and made the contract screen unavailable during vendor throttling or outages.

The contract detail screens read more than the existing indexed columns. They use the document title/number/template, creator and editor, current status, fields, histories, recipients, previous and next statuses, and detail-template metadata. Field aliases inside `fields` supply customer identity/contact/address, provider identity/contact, contract dates, service dates, and price values.

## Decision

`eformsign_doc` is the application read source for electronic documents.

- Every vendor detail response is normalized and persisted as one JSONB snapshot after removing credential-bearing keys.
- Existing relational columns remain the indexed projection used for list, customer matching, status filters, and branch ownership. The normalized customer phone is stored in `eformsign_doc.customer_phone`.
- The document PDF and audit-trail PDF bytes are stored directly in PostgreSQL `bytea` rows.
- PostgreSQL also stores MIME type, disposition, size, SHA-256, vendor source timestamp, and sync timestamp.
- Webhook processing first completes the detail/PDF mirror and customer reconciliation, then applies webhook status side effects, cache invalidation, and SSE publication. Readers therefore never observe an event for a version whose full local snapshot has not committed.
- A six-hour reconciliation sweep repairs missed webhooks and refreshes older documents. It
  uses the distributed Valkey lease; without Valkey it stays fail-closed unless the deployment
  explicitly sets `EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=true` after guaranteeing one scheduler
  replica.
- Phone linking is bidirectional: client creation or a no-op client edit claims an already-mirrored contract, and a later mirror claims a single unambiguous existing client. A branchless document is not claimed when the same normalized phone belongs to clients in multiple branches.
- After a completed contract is fully mirrored, the backend checks client-auto-registration policy. A branch-owned document uses its owner. For a branchless document, the eformsign creator email first narrows the candidates to that user's active branch memberships; if the creator is unknown, the active branches are considered. Creation proceeds only when exactly one candidate branch has automatic registration enabled, while zero or multiple eligible branches fail closed. Existing exact normalized-phone matches still take precedence. Ambiguous, incomplete, invalid-period, and service-record documents never create clients.
- List, detail, and PDF HTTP reads never call eformsign and never require an eformsign access-token cookie.
- Mutating operations such as create, delete, and re-request remain vendor operations.
- Delete does not delete at eformsign. It cancels the document there and purges the local copy. Cancelling expires the recipient's signing link — deletions are usually mis-sends, and a local-only delete would leave that link live — while eformsign keeps the document and its audit trail. A non-permanent vendor delete would not do: it only parks the document in the vendor's trash for 14 days before erasing it.
- Because the vendor copy survives, the reconcile sweep and webhooks keep rediscovering a deleted document. Its `049` status and its retained `permanent_purge_requested_at` fence are what stop the conditional upsert from rebuilding it, so the purge deliberately leaves that fence in place.
- eformsign only cancels in-progress documents. A refusal for a document that is already terminal locally still purges, since there is no live signing link to revoke; anything else is left intact and reported to the caller rather than purged.

## Detail coverage invariant

The stored JSON snapshot must preserve every non-secret property returned by the detail endpoint. This includes all current UI inputs:

| UI area | Persisted source |
| --- | --- |
| Header and electronic-document card | `document_name`, `document_number`, `template`, `creator`, `last_editor`, `created_date`, `updated_date` |
| Status and signing timeline | `current_status`, `histories`, `previous_status`, `next_status`, `recipients` |
| Customer, provider, address and contact | complete `fields` array plus `detail_template_info` |
| Contract/service dates and prices | complete `fields` array; aliases are interpreted by the backend client mapper and UI clients |
| Preview/download | `eformsign_doc_file.content` plus integrity metadata |

The sync contract test must pass a representative detail payload through the persistence boundary and compare it deeply after applying the documented secret-key redaction.

## Security

OAuth access tokens, refresh tokens, API keys, client secrets, passwords, and eformsign `external_token` / `outside_token` values are never persisted. PDF bytes are returned only after the existing JWT, tenant, and branch-ownership checks. Every database file read is verified against its recorded byte count and SHA-256 before being returned.

Downloads are streamed with a 25 MiB per-file upper bound before entering PostgreSQL. A normal vendor deletion keeps a recoverable local tombstone and its last known files. A vendor request marked permanent removes both PDF rows and the mirrored detail/PII projection, while retaining only a non-PII ownership/status tombstone for audit and authorization.

## Initial cutover gate

The six-hour scheduler is repair, not the initial migration mechanism. Each environment must use this order:

1. Apply and verify `20260729120000_add_eformsign_local_source_of_truth`.
2. From that environment's backend runtime, run `pnpm backfill:eformsign-docs` with the command's exact target confirmation and distributed-lock acknowledgement.
   The historical import may link or policy-create clients and initialize their service-record lifecycle, but it forcibly suppresses greeting and catch-up message automation. Webhooks and later six-hour repair sweeps retain normal new-document automation.
3. Treat a zero exit as the cutover gate. The command now performs a final database readiness check: every active row has detail, every completed row has both document and audit-trail PDFs, and no active row remains pending, syncing, or failed.
4. Only after the gate succeeds, deploy the application version whose electronic-document reads are local-only.

The target confirmation contains only environment plus a sanitized database fingerprint; credentials are never printed. A failed or interrupted run is safe to repeat because detail and file writes are source-timestamp guarded.

## Consequences

Document reads remain available during eformsign outages, but they are eventually consistent. Webhooks normally make them current within one event; the maximum repair window for a dropped webhook is six hours. A detail or PDF that has not completed its first sync returns an explicit local-sync-pending response instead of falling back to the vendor. Partial mirrors are retried on every reconciliation until both PDFs are present.

Client reconciliation never blocks a successful document mirror. Unexpected client-creation failures are logged and retried by the next webhook or six-hour sweep. Detail and sync-status writes are source-timestamp guarded, so an older concurrent webhook cannot overwrite or finish a newer mirror. A branchless document remains unassigned when more than one active branch is eligible; an existing unambiguous client or a later client edit can still supply its tenant boundary.

Keeping PDF bytes in PostgreSQL increases table size, WAL volume, backup size, and restore time. Operations must monitor `eformsign_doc_file` growth and include it in capacity and retention planning.
