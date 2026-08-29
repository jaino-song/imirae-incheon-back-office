BEGIN;

-- Legacy chat sessions were historically keyed only by user_id. Keep the
-- column nullable for rollback/backfill safety, but only expose non-null rows
-- through the owner-scoped application repository.
ALTER TABLE "chat_session"
    ADD COLUMN IF NOT EXISTS "branch_id" UUID;

-- Preserve unambiguous history for users who belong to or own exactly one branch.
-- Sessions for multi-branch users remain NULL and are intentionally rejected
-- until an operator can establish the correct tenant explicitly.
UPDATE "chat_session" AS cs
SET "branch_id" = memberships."branch_id"
FROM (
    SELECT "user_id", (ARRAY_AGG("branch_id" ORDER BY "branch_id"))[1] AS "branch_id"
    FROM (
        SELECT DISTINCT "user_id", "branch_id"
        FROM "user_branch"
        UNION
        SELECT "owner_id" AS "user_id", "id" AS "branch_id"
        FROM "branch"
        WHERE "owner_id" IS NOT NULL
    ) AS candidate_memberships
    GROUP BY "user_id"
    HAVING COUNT(*) = 1
) AS memberships
WHERE cs."user_id" = memberships."user_id"
  AND cs."branch_id" IS NULL;

ALTER TABLE "chat_session"
    DROP CONSTRAINT IF EXISTS "chat_session_branch_id_fkey";
ALTER TABLE "chat_session"
    ADD CONSTRAINT "chat_session_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_chat_session_owner_updated"
    ON "chat_session" ("user_id", "branch_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_chat_session_branch"
    ON "chat_session" ("branch_id");

CREATE TABLE IF NOT EXISTS "legacy_chat_confirmation_intent" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "tool_name" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "nonce_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legacy_chat_confirmation_intent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legacy_chat_confirmation_intent_nonce_hash_key" UNIQUE ("nonce_hash"),
    CONSTRAINT "legacy_chat_confirmation_intent_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "legacy_chat_confirmation_intent_branch_id_fkey"
        FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "legacy_chat_confirmation_intent_session_id_fkey"
        FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_legacy_chat_confirmation_owner_expiry"
    ON "legacy_chat_confirmation_intent" ("user_id", "branch_id", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_legacy_chat_confirmation_session"
    ON "legacy_chat_confirmation_intent" ("session_id");

COMMIT;
