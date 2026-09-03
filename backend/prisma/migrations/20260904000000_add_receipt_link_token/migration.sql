-- CreateTable
CREATE TABLE "receipt_link_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER,
    "eformsign_doc_id" INTEGER NOT NULL,
    "job_id" TEXT,
    "link_token_hash" TEXT NOT NULL,
    "access_token_hash" TEXT,
    "expected_birthday_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(6),
    "storage_path" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_link_token_link_token_hash_key" ON "receipt_link_token"("link_token_hash");
CREATE UNIQUE INDEX "receipt_link_token_access_token_hash_key" ON "receipt_link_token"("access_token_hash");
CREATE INDEX "idx_receipt_link_token_doc_active" ON "receipt_link_token"("eformsign_doc_id", "active");
CREATE INDEX "idx_receipt_link_token_job" ON "receipt_link_token"("job_id");
CREATE INDEX "idx_receipt_link_token_expires" ON "receipt_link_token"("expires_at");
CREATE INDEX "idx_receipt_link_token_branch" ON "receipt_link_token"("branch_id");

-- AddForeignKey
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_eformsign_doc_id_fkey" FOREIGN KEY ("eformsign_doc_id") REFERENCES "eformsign_doc"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
