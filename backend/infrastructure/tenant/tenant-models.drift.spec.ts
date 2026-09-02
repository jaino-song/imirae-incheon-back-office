import { readFileSync } from "node:fs";

import { SCHEMA_PATH, OUTPUT_PATH, generateTenantModelsFileContent } from "../../scripts/tenant/generate-tenant-models";

describe("tenant-models.generated.ts drift", () => {
    it("matches the derivation from prisma/schema.prisma", () => {
        const schemaSource = readFileSync(SCHEMA_PATH, "utf8");
        const expected = generateTenantModelsFileContent(schemaSource);
        const actual = readFileSync(OUTPUT_PATH, "utf8");

        if (actual !== expected) {
            throw new Error(
                "infrastructure/tenant/tenant-models.generated.ts is out of date with prisma/schema.prisma. " +
                "Run `pnpm run tenant:models:generate` and commit the result.",
            );
        }
    });
});
