# ADR-011: A contract template names the branch an eformsign-authored document belongs to

Auto-registration turns a completed 산모 계약서 into a `client`. It never fired for any document authored inside eformsign, because it could not decide which branch to create the client in. A per-template branch mapping, carrying its own activation date, answers that question without handing the archive to the next reconcile sweep.

## Context

`resolveAutoRegistrationBranch` had two inputs. `eformsign_doc.branch_id` is authoritative when present — but it is written only *after* a document is linked, so it is null for every document the sweep mirrors in. The fallback resolves the eformsign creator's email to a user and takes that user's branches, and it deliberately treats a known creator with no memberships as an empty candidate set rather than falling through to a global branch, so one tenant's document can never land in another's.

In production the creator of every 산모 계약서 is `forchildrenbysongs@gmail.com`, a user that belongs to no branch. The empty set is correct behaviour and a dead end: measured on 2026-09-03, all 253 mirrored documents had `auto_registered_client = false`, and 217 sat with `client_id`, `branch_id` and `document_kind` all null. Every other gate passed — status codes `060`/`070` are eligible, `branch:33dbe950…:client_auto_registration` is `true`, and name and phone extract cleanly (the phone from `current_status.step_recipients[].sms`, since the `이용자 연락처` field is left blank on these forms). The single blocker was `no_branch`.

Two shapes were rejected:

- **Granting the creator account a branch membership.** One row fixes the lookup, and the 6-hourly sweep reprocesses every active document, so the next pass would auto-register 205 backlog documents reaching back to 2025-08-08 — each with employee and schedule creation and a "제공인력 지정 필요" notification behind it.
- **Writing `branch_id` at mirror time.** `upsertUnassignedByDocumentId` guards its update with `allowedWhere: { documentId, branchId: null }`, and `conditionalUpsertByDocumentId` raises `EformsignDocOwnershipConflictError` when nothing matches. A document given a branch at insert would stop being "unassigned" and its next mirror update would throw — breaking the mirror for exactly the documents the change was meant to fix.

## Decision

- **The mapping is template-scoped, not branch-scoped.** `system_setting` key `eformsign:template_branch:<templateId>`, value `{"branchId": "<uuid>", "effectiveFrom": "<ISO 8601>"}`. The lookup runs from a document with no branch, so the template id is the only key it can ask with; a branch-scoped key would force a scan of every branch per document. Non-branch keys are already established here (`alimtalk_provider`, `pwa:daily_digest:…`).
- **A template belongs to exactly one branch.** That is what makes it a sound answer where the creator is not: the contract form itself is the tenant evidence.
- **`effectiveFrom` is required and the mapping fails closed without it.** A malformed or missing date drops the whole mapping rather than defaulting to "always". The sweep re-reads every active document, so a mapping without a usable bound would auto-register the entire backlog on its first pass — that must be one deliberate edit, not one typo.
- **Resolution order.** `document.branch_id` → template mapping (only when `created_date >= effectiveFrom`) → creator membership. A document older than the window falls through to the creator path unchanged, so existing behaviour for the backlog is untouched. A mapped branch that has turned `client_auto_registration` off still resolves to null, matching the `document.branch_id` path.
- **Nothing is written at mirror time.** Once auto-registration succeeds, the existing usecase writes `branch_id` on the assigned path, which is compatible with the unassigned-upsert guard.

## Deployment

The code is inert until the mapping rows exist. Seeding is a deliberate operator step rather than a migration, so that arming the feature is decoupled from deploying it.

The two live contract templates as of 2026-09-03 (`d1591da2…` 남동구 산모계약서 and `e63c528b…` 서구 계약서 are retired — last used 2026-07-31 and 2026-07-15 — and are intentionally left unmapped):

```sql
INSERT INTO system_setting (key, value, updated_at)
VALUES
  ('eformsign:template_branch:7a632a0c98a04bf38e678affcb73f815',
   '{"branchId":"33dbe950-1574-4951-b7b4-92d97ab29512","effectiveFrom":"2026-09-03T00:00:00+09:00"}',
   now()),
  ('eformsign:template_branch:1159de2d31fa444d92db3bd25afadd92',
   '{"branchId":"33dbe950-1574-4951-b7b4-92d97ab29512","effectiveFrom":"2026-09-03T00:00:00+09:00"}',
   now())
ON CONFLICT (key) DO NOTHING;
```

Before running it, count what the next sweep will register, and confirm the number is the one expected:

```sql
SELECT count(*) FROM eformsign_doc
WHERE branch_id IS NULL AND client_id IS NULL
  AND template_id IN ('7a632a0c98a04bf38e678affcb73f815','1159de2d31fa444d92db3bd25afadd92')
  AND status_type IN ('002','003','010','012','020','022','030','032','043','050',
                      '060','062','063','064','070','072','092')
  AND customer_phone IS NOT NULL
  AND created_date >= '2026-09-03 00:00+09';
```

That count was 4 at the time of writing and grows with each new contract, so re-run it immediately before seeding. The sweep fires at 00, 06, 12 and 18 KST.

To add a branch or a new contract template later, insert another row with an `effectiveFrom` of the moment it is added. To adopt backlog documents on purpose, move an existing row's `effectiveFrom` earlier — after checking the count above with the new date.

## Consequences

- Documents authored in eformsign auto-register from the sweep that follows seeding, and the usecase writes their `branch_id` as part of linking.
- The 38 unassigned documents that use the two live templates but predate `effectiveFrom` stay unassigned, along with the 167 on retired templates. They keep the pre-existing problem that a null `branch_id` excludes them from the review-completion paths (403 on "검토 필요"); that is untouched by this decision.
- The creator-membership fallback keeps its meaning for tenants whose documents do carry a resolvable creator, and remains the path for any template with no mapping.
- Arming the feature requires database access, not a deploy. That is the point: the blast radius is set by the seeded date, and it is checked with a query before the row exists.
