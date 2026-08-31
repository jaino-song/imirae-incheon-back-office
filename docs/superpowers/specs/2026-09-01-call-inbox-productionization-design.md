# Call Inbox Productionization — Design Spec

**Date:** 2026-09-01
**Status:** Approved design (this document); implementation plan to follow
**Predecessor:** `docs/superpowers/specs/2026-06-10-call-inbox-design.md` (Phase 1 design — still authoritative for anything not changed here)
**Linear:** project 통화 인박스 (Call Inbox) `a73054159ef8`, launch issue BJJ-231

## 1. Context

Phase 1 of the call inbox shipped in PR #272 (2026-06-10) and has since been hardened on `dev`
(processing leases, abandoned-claim reclaim, mobile UI polish), but it was **never launched**:
the BJJ-231 checklist (n8n import, 인천점 token wiring, smoke test) is untouched and no call
traffic has ever flowed. Meanwhile the app around it moved substantially:

- A tenant-isolation backstop (Prisma extension + ALS middleware, `TENANT_ISOLATION_MODE`)
  landed and runs in `observe` mode. Call tables are covered.
- A full message-trigger automation system exists (Aligo SMS/LMS, `message_trigger_rule`/`job`,
  event types `CLIENT_CREATED`/`SERVICE_START`/`SERVICE_END`, per-branch templates, chip editor).
- Contract issuance (eformsign 산모계약서) has its own complete flow: server-side usecase,
  durable job queue, headless fallback, completion webhooks, 종료일 finalize.
- Google released **Gemini 3.5 Transcribe** (2026-08-26, public preview): dedicated STT with
  speaker diarization, word timestamps, and custom vocabulary (≤1,000 phrases).

This round makes the pipeline production-ready on the current stack. Owner decisions captured
in this spec (2026-09-01): transcription architecture **B with an up-front correction pass**;
tenancy scope **enforce + owner token UI now, self-serve later**; **no call→contract trigger**
(contracts have their own flow); SMS scope **verify the existing CLIENT_CREATED path only**;
launch **once, on the new stack** (migrate first, then activate).

## 2. Goals

1. Move transcription to `gemini-3.5-transcribe` with a thin per-branch n8n workflow and a
   backend-owned refine → extract pipeline (architecture B + up-front correction pass).
2. Flip tenant isolation `observe` → `enforce` behind the documented burn-in runbook, close
   the transitively-scoped-model audit gaps, and give owners a token-management UI.
3. Prove (with e2e tests) that call-created clients feed the existing contract flow and the
   existing SMS automation correctly; fix what the tests surface.
4. Launch: one operational rollout on the new stack, 인천점 smoke test, BJJ-231 closed.

## 3. Non-Goals

- Self-serve branch onboarding (per-branch Drive OAuth / upload app) — a later project; this
  design must not block it, and the thin-n8n shape is chosen partly for its sake.
- The Android auto-upload app (backlog).
- Call-triggered contract issuance (산모계약서 issuance is governed by its existing flow).
- New SMS trigger event types (e.g. CALL_CONFIRMED) or lead-follow-up sequences.
- AlimTalk UI distinction work (Message Send Automation project owns it).
- Removing the n8n layer (architecture C) — revisit with self-serve.

## 4. Track 1 — Transcription pipeline (Gemini 3.5 Transcribe)

### 4.1 New n8n branch template (pure plumbing)

Replaces `docs/n8n/call-transcription-branch-template.json` (the two-pass 2.5-flash version).
Per-branch clones differ only in Drive folder ID and ingest token, as today.

Nodes:
1. **Google Drive trigger** on the branch folder (unchanged).
2. **Download file** (unchanged).
3. **Fetch vocabulary**: `GET /webhooks/call-transcripts/vocabulary` with the branch ingest
   token (`Authorization: Bearer cit_…`). Response: `{ version, phrases: string[] }`.
4. **Gemini Files API upload** (unchanged mechanism, existing Gemini credential).
5. **Transcribe**: `POST /v1beta/interactions` with `model: gemini-3.5-transcribe`, the file
   URI, `language_codes: ["ko-KR"]`, `mode.diarization_mode: "speaker"`,
   `custom_vocabulary: phrases`. Smart-transcription stays **off** (incompatible with
   diarization; verbatim is required for evidence citations).
6. **Diarization fallback**: if step 5 fails on the >30-minute diarization limit, retry once
   without diarization and set `diarized: false` in the webhook payload.
7. **POST webhook v2** (below). Unchanged retry/idempotency semantics.

### 4.2 Webhook contract v2 (breaking; nothing is live, so no compatibility shim)

`POST /webhooks/call-transcripts` — guard (`CallIngestGuard`), 1MB limit, `driveFileId`
idempotency, 202/200 semantics all unchanged. Body becomes:

```jsonc
{
  "driveFileId": "…",          // unchanged, idempotency key
  "fileName": "…",             // unchanged
  "recordedAt": "…",           // unchanged, strict ISO
  "sttModel": "gemini-3.5-transcribe",
  "diarized": true,             // false when the >30min fallback fired
  "vocabularyVersion": "…",    // echoed from the vocabulary endpoint
  "transcriptRaw": [            // replaces the v1 role-named transcript + summary
    { "speaker": "1", "text": "…" }
  ]
}
```

`summary` disappears from the webhook (moves to extraction). The v1 DTO is deleted, docs
(`docs/api/call-inbox-api.md`) updated in the same change.

### 4.3 Backend processing: refine → extract

Same status machine (`RECEIVED → PROCESSING → EXTRACTED / FAILED`), same lease/claim
concurrency, same retry cron (≤3 attempts + stuck-state recovery). Processing now has two
model stages, both behind the existing port-pattern with e2e stubs:

1. **Refine (new — the up-front correction pass).** Repo-versioned prompt carrying the
   교정 사전: corrects residual STT errors and maps diarized speakers (`1`/`2`) to roles
   (아이미래로/고객/산모/남편). Output shape equals today's stored transcript
   (`[{ speaker: <role>, text }]`), so the mobile review sheet and its 근거 인용
   scroll-to-utterance behavior are untouched. Stored as `call_record.transcript`.
   The raw payload persists in `call_record.transcript_raw` (audit; never shown by default).
   When `diarized: false`, refine still corrects terminology; speaker attribution is omitted
   rather than guessed. Role-less utterances carry the neutral speaker label `화자` — a shared
   contract: the constant is exported from `mobile/src/lib/call-inbox/types.ts` and the backend
   refine stage emits the same literal. The mobile review sheet must NOT branch on that literal:
   it treats ANY speaker outside the known role set (아이미래로, 상담원, 고객, 산모, 남편) —
   including a missing or empty speaker — as unattributed (small UI allowance, part of this
   track).
2. **Extract (existing, extended).** Absorbs the summary n8n used to produce: classification
   (신규상담/고객변경/기타) + field proposals with evidence/confidence (unchanged) **+ the
   structured summary** (`inquiry_type`, `customer_info`, `key_content`, `result_action`)
   written to `call_record.summary` exactly where the UI already reads it.

A refine failure is a processing failure: raw payload is already stored, status → FAILED,
retry cron re-runs from refine. No partial states are introduced.

Model for refine/extract stays the configured Gemini adapter family (currently
`gemini-2.5-flash`), made env-configurable (`GEMINI_EXTRACTION_MODEL`) rather than hardcoded.

### 4.4 Schema (additive only)

- `call_record.transcript_raw` JSONB NULL — raw diarized webhook payload.
- `call_record.stt_meta` JSONB NULL — `{ sttModel, diarized, vocabularyVersion }`.
- Existing columns unchanged; no backfill (no production rows exist).

### 4.5 Vocabulary endpoint

`GET /webhooks/call-transcripts/vocabulary`, `CallIngestGuard`-authenticated. Serves the
repo-versioned vocabulary file (single source shared with the refine prompt's 교정 사전),
`{ version, phrases }`, branch-agnostic in v1. Updating terminology = one deploy; clones
never change. (Per-branch vocabularies become possible later without contract change.)

## 5. Track 2 — Multi-tenancy: enforce + owner token UI

### 5.1 Observe → enforce rollout (runbook already documented in `backend/README.md`)

1. Add a CI job (or matrix leg) running the auth-e2e suite with
   `TENANT_ISOLATION_MODE=enforce` so regressions surface before any flip.
2. Burn-in: watch `tenant_isolation_violation` events (Sentry + structured logs) on
   preview with observe mode; triage every event to zero.
3. Flip preview/staging to `enforce`; run auth-e2e + Backend Full Flow CI.
4. After 7 violation-free days: flip production via env var (no deploy). Rollback is the
   same env var back to `observe`.

### 5.2 Transitively-scoped model audit

The six models without `branch_id` (`eformsign_doc_file`, `chat_message`, `chat_feedback`,
`agent_message`, `doc_template`, `bank_account_info`) rely on parent-path scoping. For each:
verify a guard-path test exists proving cross-branch access is impossible through its parent;
add the missing tests. No schema changes this round.

### 5.3 Owner token management UI

Admin frontend (settings area): per-branch list of call-ingest tokens (label, createdAt,
active), **issue** (plaintext `cit_…` shown exactly once) and **revoke**. Owner-only, reusing the existing endpoints
(`POST /branches/:id/call-ingest-tokens`, revoke) and adding a `GET` list endpoint if one
does not exist (hash-safe: never returns plaintext). IDOR posture unchanged (no cross-branch
issue/revoke).

## 6. Track 3 — Client & document readiness (verification)

No new wiring. An e2e proves a call-created client is a first-class citizen of the existing
contract flow: confirm a NEW_CLIENT draft with typical call-provided fields (name, phone,
address, start date; no caretaker, no end date) and assert the contract creation path
(`CreateAndSendContractUsecase` input assembly) accepts the client without special-casing —
absent fields absent, not corrupt. Fix whatever the test surfaces (expected: nothing or
small field-shape fixes).

## 7. Track 4 — SMS automation readiness (verification)

No new event types. An e2e proves the confirm path drives existing automation:
- greeting ON → `CLIENT_CREATED` intents persist and jobs materialize with variables
  resolved from the draft-created client (name/phone at minimum);
- greeting OFF (`suppressGreetingSms`) → greeting suppressed, other CLIENT_CREATED rules
  unaffected;
- branch scoping of the created jobs is correct.
Fix whatever the test surfaces.

## 8. Track 5 — Launch (single rollout, new stack)

Sequenced after Tracks 1–4 land on `dev` and promote through `preview` → `main`
(the standing release-train process; release PR #591 merges or is superseded by a newer
train — no special handling here).

Operator checklist (operator = repo owner, with the agent assisting):
1. n8n: import the **new** template; fill the four placeholders (branch folder ID, existing
   Drive credential, existing Gemini credential, 인천점 token `053bf54c…` plaintext).
2. Rename to 「Call Transcription — 인천점」, activate; old workflow stays disabled.
3. Smoke: drop one test recording → visible in m.staff 통화요약 within ~2 minutes with
   corrected terminology and role-labeled transcript.
4. Push one real 신규상담 through [고객 등록]; confirm greeting SMS delivery in 발송 내역.
5. Close BJJ-231; update the Linear project description (V1 architecture note superseded by
   this spec; launch recorded).

Troubleshooting table in `docs/n8n/README.md` is updated for the new flow (401=token,
400=payload shape, 200 duplicate=normal retry, new: 30-min diarization fallback marker).

Cost note: Gemini 3.5 Transcribe is $2.00/M input + $12.00/M output tokens (preview
pricing) — negligible at consult-call volume; the third LLM pass this design removes was
the larger spend.

## 9. Risks & mitigations

- **Gemini 3.5 Transcribe is public preview.** API surface may shift. Mitigation: the
  Interactions call lives in exactly one n8n node; the webhook v2 contract is
  model-agnostic (`sttModel` field), so a model swap touches only the template.
- **Diarization quality on 2-speaker Korean phone audio is unproven for our domain.**
  Mitigation: smoke test gate (step 3 above) before real traffic; role mapping happens in
  refine where the prompt can use content cues, not just diarization labels.
- **Extraction prompt absorbs more work** (summary + roles). Mitigation: refine and extract
  stay separate stages with separate prompts; each is independently testable and
  independently retried.
- **Enforce flip regressions.** Mitigation: enforce-mode CI leg + staged flip + env-var
  rollback (documented runbook).
- **Preview-lag risk:** `dev` is far ahead of `main`; the launch depends on the release
  train landing. Mitigation: Track 5 explicitly gates on promotion, and the smoke test runs
  against production after promotion.

## 10. Open items intentionally deferred

- Self-serve branch onboarding (Drive OAuth per branch or direct upload) — next project;
  the thin template + vocabulary endpoint were shaped for it.
- Per-branch vocabulary entries (contract already carries `version`; add when a second
  branch's terminology diverges).
- Backend transcript re-correction UI (manual re-run of refine with an updated dictionary)
  — only if operational experience demands it.
