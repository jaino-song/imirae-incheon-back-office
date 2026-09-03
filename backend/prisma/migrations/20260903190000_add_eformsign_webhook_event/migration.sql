-- Append-only ledger of inbound eformsign webhooks and what became of each one.
-- The service drops events at a dozen points and, before this table, every drop
-- left only a log line nobody read — which is how a status-mapping defect that
-- froze every 제공기관 검토 document at 060 survived for months.
--
-- Idempotent by construction: the database-patches workflow re-executes this
-- whole block on every push, so a bare CREATE would fail every run after the
-- first and block every later migration in the block from ever applying.
CREATE TABLE IF NOT EXISTS "eformsign_webhook_event" (
    "id" SERIAL NOT NULL,
    "webhook_id" VARCHAR(255),
    "event_type" VARCHAR(80),
    "company_id" VARCHAR(255),
    "document_id" VARCHAR(255),
    -- The vendor's own status string, before mapStatus touched it.
    "raw_status" VARCHAR(120),
    -- What mapStatus made of it. A pair that disagrees in kind is a mapping bug.
    "status_type" VARCHAR(8),
    "status_detail" VARCHAR(255),
    "source_updated_date" TIMESTAMPTZ(6),
    "outcome" VARCHAR(40) NOT NULL,
    "outcome_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "eformsign_webhook_event_pkey" PRIMARY KEY ("id")
);

-- No foreign keys on purpose: a document row disappearing must not erase
-- delivery history, and this table must never block its deletion. No branch_id
-- either — the tenant-isolation extension scopes every model that has one, and
-- webhooks arrive with no tenant on the request.

-- "what happened to this document" — the per-document forensic query.
CREATE INDEX IF NOT EXISTS "idx_eformsign_webhook_event_document_created"
    ON "eformsign_webhook_event" ("document_id", "created_at");

-- "what arrived recently and was dropped" — the operator-facing counter.
CREATE INDEX IF NOT EXISTS "idx_eformsign_webhook_event_outcome_created"
    ON "eformsign_webhook_event" ("outcome", "created_at");

-- Retention sweep predicate.
CREATE INDEX IF NOT EXISTS "idx_eformsign_webhook_event_created"
    ON "eformsign_webhook_event" ("created_at");
