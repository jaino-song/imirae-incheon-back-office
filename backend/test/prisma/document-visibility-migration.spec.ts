import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("document visibility migration", () => {
    const migration = readFileSync(
        join(
            process.cwd(),
            "prisma/migrations/20260820050000_add_document_visibility_scope/migration.sql",
        ),
        "utf8",
    );

    it("runs the legacy-data preflight before any schema change in one transaction", () => {
        const begin = migration.indexOf("BEGIN;");
        const nullBranchPreflight = migration.indexOf('WHERE "branch_id" IS NULL');
        const duplicatePathPreflight = migration.indexOf('GROUP BY "storage_path"');
        const firstSchemaChange = migration.indexOf('ALTER TABLE "document"');
        const commit = migration.lastIndexOf("COMMIT;");

        expect(begin).toBeGreaterThanOrEqual(0);
        expect(nullBranchPreflight).toBeGreaterThan(begin);
        expect(duplicatePathPreflight).toBeGreaterThan(nullBranchPreflight);
        expect(firstSchemaChange).toBeGreaterThan(duplicatePathPreflight);
        expect(commit).toBeGreaterThan(firstSchemaChange);
    });

    it("enforces one storage object owner and a closed visibility vocabulary", () => {
        const normalizedMigration = migration.replace(/\s+/g, " ").trim();

        expect(normalizedMigration).toContain(
            'CREATE UNIQUE INDEX IF NOT EXISTS "document_storage_path_key" ON "document"("storage_path");',
        );
        expect(migration).toContain(
            "document_storage_path_key definition drifted",
        );
        expect(migration).toContain(
            'CHECK ("visibility_scope" IN (\'branch\', \'all_branches\'))',
        );
        expect(migration).toContain(
            "document_visibility_scope_check definition drifted",
        );
    });
});
