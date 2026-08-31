// Generates infrastructure/tenant/tenant-models.generated.ts — a drift-checked list of every
// Prisma model that carries a branch_id column (branch-scoped, i.e. a tenant model).
//
// Parser route: this project has no resolvable `@prisma/internals` dependency (verified via
// `require.resolve('@prisma/internals')`, which throws MODULE_NOT_FOUND; it is not listed in
// package.json or present anywhere under node_modules — only bundled internally inside the
// `prisma` CLI package, not exposed for import). getDMMF is therefore unavailable, so this
// derives the model list with a line-parser over prisma/schema.prisma instead: it walks each
// `model X { ... }` block (matching braces to find the block's extent — schema.prisma's only
// brace usage inside a value is the balanced `"{}"` Json default, which nets to zero and does
// not disturb the count) and flags the block as tenant-scoped if its body contains a field
// mapped to the `branch_id` column via `@map("branch_id")`.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const SCHEMA_PATH = resolve(__dirname, "../../prisma/schema.prisma");
export const OUTPUT_PATH = resolve(__dirname, "../../infrastructure/tenant/tenant-models.generated.ts");

const BRANCH_COLUMN_MAP = '@map("branch_id")';
const BRANCH_FIELD_JS_NAME = "branchId";

/**
 * Finds every `model X { ... }` block in the schema source and returns, for each, the model
 * name and its body (the text between the outer braces).
 */
function extractModelBlocks(schemaSource: string): Array<{ name: string; body: string }> {
    const modelHeaderRe = /^model\s+(\w+)\s*\{/gm;
    const blocks: Array<{ name: string; body: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = modelHeaderRe.exec(schemaSource)) !== null) {
        const name = match[1];
        if (!name) throw new Error(`Unreachable: model header regex matched without capturing a name near index ${match.index}.`);
        const bodyStart = modelHeaderRe.lastIndex;
        let depth = 1;
        let i = bodyStart;
        while (depth > 0 && i < schemaSource.length) {
            if (schemaSource[i] === "{") depth++;
            else if (schemaSource[i] === "}") depth--;
            i++;
        }
        blocks.push({ name, body: schemaSource.slice(bodyStart, i - 1) });
    }

    return blocks;
}

/**
 * Returns the sorted (stable, locale-independent) list of Prisma model names — which, for this
 * schema, are identical to the Prisma client property names (models are already declared in
 * snake_case, e.g. `message_log`, and none carry an `@@map`, so the client's lower-first-letter
 * transform is a no-op) — that carry a field mapped to the `branch_id` column.
 *
 * Also asserts that every such field's JS name is `branchId` (true for all 34 occurrences in
 * this schema as of writing), since the generated file exports a single shared
 * TENANT_MODEL_BRANCH_FIELD constant rather than a per-model field name.
 */
export function extractTenantModelNames(schemaSource: string): string[] {
    const names: string[] = [];

    for (const { name, body } of extractModelBlocks(schemaSource)) {
        if (!body.includes(BRANCH_COLUMN_MAP)) continue;

        const fieldLineMatch = /^[ \t]*(\w+)[ \t]+\S.*@map\("branch_id"\)/m.exec(body);
        if (!fieldLineMatch) {
            throw new Error(`Model "${name}" contains ${BRANCH_COLUMN_MAP} but its field declaration line could not be parsed.`);
        }
        if (fieldLineMatch[1] !== BRANCH_FIELD_JS_NAME) {
            throw new Error(`Model "${name}" maps branch_id to field "${fieldLineMatch[1]}", expected "${BRANCH_FIELD_JS_NAME}". Update TENANT_MODEL_BRANCH_FIELD handling before regenerating.`);
        }

        names.push(name);
    }

    return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function renderTenantModelsFile(modelNames: readonly string[]): string {
    const entries = modelNames.map((name) => `    "${name}",`).join("\n");

    return `// AUTO-GENERATED — do not edit; run pnpm run tenant:models:generate
// Source: prisma/schema.prisma. Regenerate whenever a model's branch_id column changes.
// See scripts/tenant/generate-tenant-models.ts for the derivation and its drift test.

export const TENANT_MODELS: ReadonlySet<string> = new Set([
${entries}
]);

export const TENANT_MODEL_BRANCH_FIELD = "${BRANCH_FIELD_JS_NAME}";
`;
}

export function generateTenantModelsFileContent(schemaSource: string): string {
    return renderTenantModelsFile(extractTenantModelNames(schemaSource));
}

function main(): void {
    const schemaSource = readFileSync(SCHEMA_PATH, "utf8");
    writeFileSync(OUTPUT_PATH, generateTenantModelsFileContent(schemaSource));
}

if (require.main === module) {
    main();
}
