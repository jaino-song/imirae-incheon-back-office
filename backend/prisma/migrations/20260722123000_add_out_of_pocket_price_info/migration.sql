BEGIN;

CREATE TABLE IF NOT EXISTS "out_of_pocket_price_info" (
    "id" SMALLSERIAL NOT NULL,
    "duration" SMALLINT NOT NULL,
    "full_price" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "out_of_pocket_price_info_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "out_of_pocket_price_info_duration_check"
        CHECK ("duration" IN (5, 10, 15, 20)),
    CONSTRAINT "out_of_pocket_price_info_full_price_check"
        CHECK ("full_price" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "out_of_pocket_price_info_duration_key"
    ON "out_of_pocket_price_info"("duration");

INSERT INTO "out_of_pocket_price_info" (
    "duration",
    "full_price",
    "created_at",
    "updated_at"
)
VALUES
    (5, 815000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (10, 1620000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (15, 2425000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (20, 3240000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("duration") DO NOTHING;

COMMIT;
