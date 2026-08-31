# 통화요약 (Call Inbox) — API Sheet

**Status:** Phase 1 + 변경 적용 (BJJ-232) 구현 완료. This file is the **source of truth** for the UI-facing API; implementation must conform or update this sheet in the same PR.
**Spec:** `docs/superpowers/specs/2026-09-01-call-inbox-productionization-design.md` (supersedes `2026-06-10-call-inbox-design.md`) · **Wireframe:** `docs/mockups/call-inbox-wireframe.html`

## Conventions

- UI calls the **mobile BFF** routes (`m.staff` → `mobile/src/app/api/...`), which proxy to the backend with the session token — same pattern as `/api/clients`.
- Auth: session cookie (BFF) → Bearer JWT (backend). All list/detail data is branch-scoped server-side; the UI never sends a branch id.
- Dates/timestamps: ISO 8601 strings (`"2026-07-15"` for dates, `"2026-06-10T14:02:11+09:00"` for timestamps).
- Pagination: page/limit — `?page=1&limit=20` → `{ data, total, page, limit, totalPages }`. Default `page=1`, default `limit=20`, max `limit=100`.
- Error envelope mirrors the existing `/api/clients` convention; status codes below are contractual.

## Shared types

```ts
type CallCategory     = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";
type ProcessingStatus = "RECEIVED" | "EXTRACTED" | "FAILED";
type DraftType        = "NEW_CLIENT" | "CLIENT_UPDATE";
type DraftStatus      = "PENDING" | "CONFIRMED" | "DISCARDED";
type Confidence       = "high" | "low";

interface TranscriptTurn {
  speaker: "아이미래로" | "상담원" | "고객" | "산모" | "남편" | "화자";
  text: string;                     // "화자" = neutral label when diarization was unavailable
}

interface CallSummary {            // produced server-side by the extract stage (nullable as a whole)
  inquiry_type: string;
  customer_info: string;
  key_content: string;
  result_action: string;
}

type ProposalField =
  | "name" | "phone" | "address" | "dueDate" | "birthDate" | "birthday"
  | "startDate" | "endDate" | "duration" | "type"
  | "careCenter" | "voucherClient" | "breastPump"
  | "serviceStatus" | "fullPrice" | "grant" | "actualPrice";

interface Proposal {
  field: ProposalField;
  value: string | number | boolean | null;  // dates as ISO strings, duration in days
  currentValue?: string | number | boolean | null; // extraction-time snapshot (optional; used for CLIENT_UPDATE diffs)
  evidence: string;                          // transcript quote backing the value
  confidence: Confidence;                    // "low" → amber highlight in UI
}

interface ClientRef { id: number; name: string; phone: string | null; }
```

## 1. Call log

### `GET /api/call-records?category&search&page&limit`

| Param | Type | Notes |
|---|---|---|
| `category` | `CallCategory` (optional) | omit = 전체 |
| `search` | string (optional) | matches caller name/phone, summary, transcript text |
| `page`, `limit` | pagination | defaults 1/20, max limit 100 |

```ts
interface CallRecordListItem {
  id: string;                       // uuid
  category: CallCategory | null;    // null until extraction completes
  processingStatus: ProcessingStatus;
  callerName: string | null;
  callerPhone: string | null;       // normalized digits, UI formats XXX-XXXX-XXXX
  fileName: string;
  recordedAt: string | null;
  createdAt: string;
  matchedClient: ClientRef | null;
  draft: {                          // null for OTHER / not-yet-extracted
    id: string;
    type: DraftType;
    status: DraftStatus;
    requestSummary: string;
  } | null;
  summaryLine: string | null;       // requestSummary ?? summary.key_content (list display)
}
// → 200 { data: CallRecordListItem[], total: number, page: number, limit: number, totalPages: number }
```

### `GET /api/call-records/:id`

```ts
interface CallRecordDetail extends CallRecordListItem {
  transcript: TranscriptTurn[];
  summary: CallSummary | null;
  driveFileId: string;
  driveUrl: string;                 // link out to original audio in Google Drive
  failureReason: string | null;     // when processingStatus === "FAILED"
}
// → 200 CallRecordDetail · 404 unknown/foreign-branch id
```

## 2. Review queue (drafts)

### `GET /api/client-drafts?status&page&limit`

`status` default `PENDING`.

**Note on flags:** `possibleDuplicate` is computed within the returned page (another item on the same page shares this phone). `phoneMatchesExistingClient` is only populated for `NEW_CLIENT` type drafts.

```ts
interface ClientDraftListItem {
  id: string;
  type: DraftType;
  status: DraftStatus;
  requestSummary: string;
  callerName: string | null;
  callerPhone: string | null;
  recordedAt: string | null;
  createdAt: string;
  callRecordId: string;
  client: ClientRef | null;         // CLIENT_UPDATE: matched client (null = 고객 연결 필요)
  hasLowConfidence: boolean;        // any proposal.confidence === "low"
  possibleDuplicate: boolean;       // another draft on this page shares this phone
  phoneMatchesExistingClient: boolean; // NEW_CLIENT only: phone already on a live client → warn
}
// → 200 { data: ClientDraftListItem[], total: number, page: number, limit: number, totalPages: number }
```

### `GET /api/client-drafts/count?status=PENDING`

→ `200 { count: number }` — nav badge / NotificationBell.

**Route ordering note:** this endpoint must be declared before `/:id` routes in the router to avoid the path being treated as an id lookup (no client-side impact).

### `GET /api/client-drafts/:id`

The nested `callRecord` is a `DraftCallRecord` — the raw `call_record` row plus `matchedClient`. It does **not** carry `draft`, `summaryLine`, or `driveUrl` fields (those are list/detail projections). Build the Drive link as `https://drive.google.com/file/d/{driveFileId}/view`.

`clientCurrent` is not available in Phase 1 — live client values come in Phase 2. Do not render a diff panel against clientCurrent in Phase 1.

`reviewedBy.id` is a UUID string.

`extractionMeta` is `{ model: string; promptVersion: string } | null`.

```ts
interface DraftCallRecord {
  id: string;
  driveFileId: string;
  fileName: string;
  recordedAt: string | null;
  transcript: TranscriptTurn[];
  summary: Record<string, string> | null;
  category: CallCategory | null;
  callerName: string | null;
  callerPhone: string | null;
  matchedClient: ClientRef | null;
  createdAt: string;
}

interface ClientDraftDetail {
  id: string;
  type: DraftType;
  status: DraftStatus;
  clientId: number | null;
  callRecordId: string;
  proposals: Proposal[];
  requestSummary: string;
  extractionMeta: { model: string; promptVersion: string } | null;
  callRecord: DraftCallRecord;
  client: (ClientRef & Record<string, unknown>) | null;
  reviewedBy: { id: string; name: string } | null;  // id is UUID string
  reviewedAt: string | null;
  discardReason: string | null;
  createdAt: string;
}
// → 200 ClientDraftDetail · 404
```

### `PATCH /api/client-drafts/:id` — staff edits before confirm

```ts
interface PatchDraftBody {
  proposals?: Proposal[];           // full replacement of the array
  clientId?: number | null;         // CLIENT_UPDATE: manual link/unlink (ClientAutocomplete)
}
// → 200 ClientDraftDetail · 409 not PENDING · 422 invalid field/value
```

### `POST /api/client-drafts/:id/confirm`

NEW_CLIENT — body carries **staff-final** values (same shape as the existing create-client form/DTO):

```ts
interface ConfirmNewClientBody {
  fields: {
    name: string;                              // required
    careCenter: boolean;                       // required
    voucherClient: boolean;                    // required
    breastPump: boolean;                       // required
    phone?: string | null;
    address?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;                 // ISO date
    endDate?: string | null;
    birthday?: string | null;                  // YYMMDD
    dueDate?: string | null;
    serviceStatus?: string | null;
    areaId?: string | null;
    primaryEmployeeId?: number | null;
    secondaryEmployeeId?: number | null;
  };
  suppressGreetingSms?: boolean;               // default false (= SMS goes out, same as manual create)
}
// → 201 { clientId: number }
```

CLIENT_UPDATE — body carries **only the changed fields** (included proposals after staff review):

```ts
interface ConfirmClientUpdateBody {
  changes: Record<ProposalField, string | number | boolean | null>;  // included changes only; non-allowlist keys dropped server-side; non-empty required
}
// → 200 { clientId: number }
```

Errors: `409` draft not PENDING (already confirmed/discarded) · `409` "Draft already reviewed" when a concurrent confirm wins the CONFIRMING lock · `409` "고객 연결이 필요합니다" (unlinked client — `clientId` not set on draft) · `400` empty or invalid changes · 4xx from client-update validation (same rules as existing client update path).

### `POST /api/client-drafts/:id/discard`

Body `{ reason?: string }` → `200 { id, status: "DISCARDED" }` · `409` not PENDING · `409` "Draft already reviewed" (concurrent discard).

## 3. Phase 2 endpoints (contract reserved)

- `POST /api/call-records/:id/re-extract` → `202` — re-runs extraction; replaces proposals only while the draft is still PENDING.

## 4. Operator-side (not called by the mobile UI)

### `POST /webhooks/call-transcripts` — webhook body v2 (Gemini 3.5 Transcribe)

**Breaking change from Phase 1.** Nothing has ever gone live, so this is a clean contract
break — the v1 shape (role-named `transcript` + n8n-produced `summary`) is deleted outright,
no compatibility shim. n8n now sends a **raw diarized transcript**; role-mapping and the
structured summary are produced server-side by the refine → extract pipeline instead.

```jsonc
{
  "driveFileId": "1a2b3c...",             // unchanged — idempotency key
  "fileName": "통화 녹음 ....m4a",         // unchanged
  "recordedAt": "2026-09-01T05:02:11Z",   // optional, strict ISO 8601
  "sttModel": "gemini-3.5-transcribe",
  "diarized": true,                        // false when n8n's non-diarized fallback fired —
                                            // transcriptRaw speakers are then "" (unattributed)
  "vocabularyVersion": "2026-09-01",       // echoed from GET /webhooks/call-transcripts/vocabulary
  "transcriptRaw": [                       // raw diarized turns; speaker is a free string ("1"/"2"),
    { "speaker": "1", "text": "..." }      // never enumerated — the fallback sends it as "" (the key
  ]                                        // itself is required; a turn without `speaker` is a 400)
}
```

`summary` no longer appears on the webhook body at all. `driveFileId`, `fileName` and the 1 mb
body limit are unchanged from v1. `transcriptRaw` caps: ≤ 500 turns, each turn text ≤ 2000
chars.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /webhooks/call-transcripts` | `Authorization: Bearer <cit_… ingest token>` | n8n only. Body: see v2 shape above. `recordedAt` must be a strict ISO 8601 calendar-validated date-time string when present. **202** `{ accepted: true, duplicate: false, callRecordId }` fresh accepted · **200** `{ accepted: true, duplicate: true, callRecordId }` duplicate (idempotent re-delivery) · **401** bad token · **400** invalid payload (including validation cap violations or malformed `recordedAt`) |
| `GET /webhooks/call-transcripts/vocabulary` | `Authorization: Bearer <cit_… ingest token>` | n8n only. **200** `{ version, phrases }` — the repo-versioned vocabulary the workflow passes to Gemini 3.5 Transcribe as `custom_vocabulary`, echoing `version` back as the webhook's `vocabularyVersion`. Branch-agnostic (one global list) · **401** bad token |
| `POST /branches/:branchId/call-ingest-tokens` | admin JWT | `{ label }` → `{ token }` — plaintext shown once |
| `POST /call-ingest-tokens/:id/revoke` | admin JWT | kills exactly one ingest source |

## 5. Draft status reference

| Status | Description |
|---|---|
| `PENDING` | Awaiting staff review. Shown in the review queue. |
| `CONFIRMING` | Transient — set atomically when staff submits confirm, to prevent double-confirm. If the process crashes mid-confirm, a 10-minute retry cron sweeps `CONFIRMING` drafts back to `PENDING`. Not returned by list endpoints in practice, but can appear in a detail fetch mid-confirm. |
| `CONFIRMED` | Staff confirmed; client created (NEW_CLIENT) or changes applied (CLIENT_UPDATE). |
| `DISCARDED` | Staff discarded with optional reason. |

## 6. Errors

| Scenario | Status |
|---|---|
| Unknown / foreign-branch resource | 404 |
| Draft already reviewed (not PENDING) | 409 |
| Draft already reviewed — concurrent confirm/discard wins CONFIRMING lock | 409 |
| CLIENT_UPDATE confirm — `clientId` not set on draft (고객 연결이 필요합니다) | 409 |
| CLIENT_UPDATE confirm — `changes` empty or contains only non-allowlist keys | 400 |
| Validation failure (body caps, unknown fields) | 400 / 422 |
| Webhook body exceeds 1 mb | 400 (express) |
| Webhook payload fails DTO validation (cap violations, malformed `recordedAt`) | 400 |
