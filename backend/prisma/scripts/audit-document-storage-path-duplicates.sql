-- Read-only preflight for the document visibility migration.
-- Run this against the target database before `prisma migrate deploy`.
-- An empty result is the only safe result.
--
-- If rows are returned, run the executable operator tool in a maintenance window:
--
--   pnpm --filter ./backend exec ts-node \
--     scripts/remediate-document-storage-path-duplicates.ts \
--     --apply=copy-and-verify-document-objects
--
-- The tool uses authenticated storage, stable earliest-row ownership, deterministic
-- server paths, source/destination length + SHA-256 verification, a row lock and
-- conditional update, compensation, resume-safe copy reuse, and a final zero-
-- duplicate audit. It never deletes the shared source object.
SELECT
    "storage_path",
    COUNT(*) AS "owner_count",
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'id', "id",
            'branch_id', "branch_id",
            'created_at', "created_at"
        )
        ORDER BY "created_at", "id"
    ) AS "owners_in_remediation_order"
FROM "document"
GROUP BY "storage_path"
HAVING COUNT(*) > 1
ORDER BY "storage_path";
