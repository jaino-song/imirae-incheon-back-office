-- Host-level lease for background schedulers (see ADR-010). One row per lease
-- name; the acquire/renew statement is a single INSERT ... ON CONFLICT DO
-- UPDATE ... WHERE ... RETURNING, so this table needs no seed to work — the
-- seed row below only makes the lease visible to operators before the first
-- host acquires it.
CREATE TABLE "scheduler_lease" (
    "name" VARCHAR(64) NOT NULL,
    "holder_id" VARCHAR(64) NOT NULL,
    "instance_id" VARCHAR(64) NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL,
    "renewed_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheduler_lease_pkey" PRIMARY KEY ("name")
);

-- Already-expired placeholder: the first acquire wins immediately.
INSERT INTO "scheduler_lease" ("name", "holder_id", "instance_id", "acquired_at", "renewed_at", "expires_at")
VALUES ('background-owner', 'unassigned', 'unassigned', now(), now(), now())
ON CONFLICT ("name") DO NOTHING;
