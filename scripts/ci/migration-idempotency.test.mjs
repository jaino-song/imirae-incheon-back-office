import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_ROOT = resolve(WORKSPACE_ROOT, "backend/prisma/migrations");

/**
 * The pre-applied baseline. `database-patches.yml` re-executes every migration after
 * this one on EVERY push to dev/preview/main, against databases where they are already
 * applied — see the sibling contract test that enforces the wiring. That makes
 * re-runnability a hard requirement, not a nicety: the post-lease step is one
 * `bash -e` block, so the first statement that raises aborts the whole step and every
 * later migration in the block silently never applies.
 *
 * This is not hypothetical. `20260902120000_add_scheduler_lease` shipped a bare
 * `CREATE TABLE`, succeeded on the push that introduced it, and then failed every run
 * afterwards with `relation "scheduler_lease" already exists` — taking
 * `20260903000000_add_employee_schedule_terminated_at` down with it while the code that
 * reads that column was already merged.
 */
const BASELINE = "20260813000000_add_eformsign_document_jobs";

/** Statements inside these are assumed to carry their own catalog guard. */
function stripGuardedRegions(sql) {
    // Dollar-quoted bodies (DO blocks, function bodies). Non-greedy, tag-matched.
    let out = sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, " DOLLAR_QUOTED_BODY ");
    out = out.replace(/--[^\n]*/g, " ");
    out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
    return out;
}

function statementsOf(sql) {
    return stripGuardedRegions(sql)
        .split(";")
        .map((statement) => statement.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

/** `"public"."thing"` / `"thing"` / `thing` -> `thing` */
function bareName(raw) {
    if (!raw) return "";
    const parts = raw.split(".");
    return (parts[parts.length - 1] ?? "").replace(/"/g, "").toLowerCase();
}

const IDENT = '(?:"[^"]+"|[A-Za-z_]\\w*)(?:\\.(?:"[^"]+"|[A-Za-z_]\\w*))?';

/**
 * Each rule reports a statement that raises on a second run. `droppedFirst` lets a bare
 * CREATE pass when the same object was dropped with IF EXISTS earlier in the same file —
 * `DROP INDEX IF EXISTS x; CREATE UNIQUE INDEX x ...` is a legitimate idempotent pairing
 * and several migrations rebuild indexes that way.
 */
const RULES = [
    {
        id: "create-table",
        // eslint-disable-next-line
        match: new RegExp(`^CREATE (?:UNLOGGED )?TABLE (?!IF NOT EXISTS)(${IDENT})`, "i"),
        kind: "table",
        why: "CREATE TABLE without IF NOT EXISTS",
    },
    {
        id: "create-index",
        match: new RegExp(`^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?!IF NOT EXISTS)(${IDENT})`, "i"),
        kind: "index",
        why: "CREATE INDEX without IF NOT EXISTS",
    },
    {
        id: "create-sequence",
        match: new RegExp(`^CREATE SEQUENCE (?!IF NOT EXISTS)(${IDENT})`, "i"),
        kind: "sequence",
        why: "CREATE SEQUENCE without IF NOT EXISTS",
    },
    {
        id: "add-column",
        match: new RegExp(`^ALTER TABLE (?:IF EXISTS )?${IDENT} ADD COLUMN (?!IF NOT EXISTS)(${IDENT})`, "i"),
        kind: "column",
        why: "ADD COLUMN without IF NOT EXISTS",
    },
    {
        id: "add-constraint",
        // Postgres has no IF NOT EXISTS for ADD CONSTRAINT, so the only safe forms are a
        // DO-block guard or a preceding DROP CONSTRAINT IF EXISTS.
        match: new RegExp(`^ALTER TABLE (?:IF EXISTS )?${IDENT} ADD CONSTRAINT (${IDENT})`, "i"),
        kind: "constraint",
        why: "ADD CONSTRAINT (Postgres has no IF NOT EXISTS form)",
    },
    {
        id: "create-type",
        // Likewise no IF NOT EXISTS; a re-run raises "type already exists".
        match: new RegExp(`^CREATE TYPE (${IDENT})`, "i"),
        kind: "type",
        why: "CREATE TYPE (Postgres has no IF NOT EXISTS form)",
    },
    {
        id: "drop-without-if-exists",
        match: /^DROP (TABLE|INDEX|SEQUENCE|VIEW|TYPE|SCHEMA)\s+(?!IF EXISTS)/i,
        kind: null,
        why: "DROP without IF EXISTS",
    },
    {
        // `ALTER TABLE IF EXISTS old RENAME TO new` IS idempotent: on the second run the
        // old relation is gone and Postgres skips it. That protection does not extend to
        // RENAME COLUMN / RENAME CONSTRAINT — there the table still exists, so the
        // statement runs and raises on the already-renamed member.
        id: "rename-object",
        match: /^ALTER (?:TABLE|INDEX|TYPE|SEQUENCE|VIEW)\s+(?!IF EXISTS\b)\S+.* RENAME TO /i,
        kind: null,
        why: "RENAME TO without IF EXISTS (the old name is gone on a second run)",
    },
    {
        id: "rename-member",
        match: /^ALTER \S+\s+(?:IF EXISTS\s+)?\S+.* RENAME (?:COLUMN|CONSTRAINT) /i,
        kind: null,
        why: "RENAME COLUMN/CONSTRAINT (IF EXISTS on the table does not cover the member)",
    },
];

const DROP_IF_EXISTS = [
    { kind: "table", match: new RegExp(`^DROP TABLE IF EXISTS (${IDENT})`, "i") },
    { kind: "index", match: new RegExp(`^DROP INDEX IF EXISTS (${IDENT})`, "i") },
    { kind: "sequence", match: new RegExp(`^DROP SEQUENCE IF EXISTS (${IDENT})`, "i") },
    { kind: "type", match: new RegExp(`^DROP TYPE IF EXISTS (${IDENT})`, "i") },
    {
        kind: "constraint",
        match: new RegExp(`^ALTER TABLE (?:IF EXISTS )?${IDENT} DROP CONSTRAINT IF EXISTS (${IDENT})`, "i"),
    },
    {
        kind: "column",
        match: new RegExp(`^ALTER TABLE (?:IF EXISTS )?${IDENT} DROP COLUMN IF EXISTS (${IDENT})`, "i"),
    },
];

export function findNonIdempotentStatements(sql) {
    const dropped = new Set();
    const offenders = [];

    for (const statement of statementsOf(sql)) {
        for (const { kind, match } of DROP_IF_EXISTS) {
            const hit = statement.match(match);
            if (hit) dropped.add(`${kind}:${bareName(hit[1])}`);
        }

        for (const rule of RULES) {
            const hit = statement.match(rule.match);
            if (!hit) continue;
            if (rule.kind && dropped.has(`${rule.kind}:${bareName(hit[1])}`)) continue;
            offenders.push({
                rule: rule.id,
                why: rule.why,
                statement: statement.length > 160 ? `${statement.slice(0, 160)}…` : statement,
            });
            break;
        }
    }

    return offenders;
}

async function postBaselineMigrations() {
    const entries = await readdir(MIGRATION_ROOT, { withFileTypes: true });
    const names = entries
        .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    const baselineIndex = names.indexOf(BASELINE);
    assert.notEqual(baselineIndex, -1, `the pre-applied baseline ${BASELINE} must exist`);
    return names.slice(baselineIndex + 1);
}

/**
 * The workflow re-executes pre-baseline migrations too — the baseline only marks where
 * the sibling contract test starts REQUIRING new wiring. Checking what the workflow
 * actually names is the honest blast radius; the post-baseline set is the floor, so a
 * migration that is wired later still gets checked even before it is referenced.
 */
async function reExecutedMigrations() {
    const workflow = await readFile(
        resolve(WORKSPACE_ROOT, ".github/workflows/database-patches.yml"),
        "utf8",
    );
    const referenced = new Set(
        [...workflow.matchAll(/prisma\/migrations\/([0-9a-z_]+)\/migration\.sql/g)].map((hit) => hit[1]),
    );
    for (const name of await postBaselineMigrations()) referenced.add(name);
    return [...referenced].sort();
}

test("every re-executed migration survives a second run", async () => {
    const migrations = await reExecutedMigrations();
    assert.ok(migrations.length > 0, "there must be migrations to check");

    const failures = [];
    for (const name of migrations) {
        const sql = await readFile(resolve(MIGRATION_ROOT, name, "migration.sql"), "utf8");
        for (const offender of findNonIdempotentStatements(sql)) {
            failures.push(`${name}: ${offender.why}\n    ${offender.statement}`);
        }
    }

    assert.deepEqual(
        failures,
        [],
        "database-patches.yml re-runs these on every push, so each one must be safe to apply twice.\n"
        + "Guard the statement (IF NOT EXISTS / IF EXISTS), wrap it in a DO block that checks the\n"
        + "system catalog, or precede it with the matching DROP ... IF EXISTS.\n\n"
        + failures.join("\n"),
    );
});

test("the checker recognises the shapes that have actually broken this pipeline", () => {
    // The real 20260902120000_add_scheduler_lease defect.
    const bareCreate = findNonIdempotentStatements(`
        CREATE TABLE "scheduler_lease" (
            "name" VARCHAR(64) NOT NULL,
            CONSTRAINT "scheduler_lease_pkey" PRIMARY KEY ("name")
        );
    `);
    assert.equal(bareCreate.length, 1);
    assert.equal(bareCreate[0].rule, "create-table");

    // ...and its fix.
    assert.deepEqual(
        findNonIdempotentStatements(`CREATE TABLE IF NOT EXISTS "scheduler_lease" ("name" VARCHAR(64) NOT NULL);`),
        [],
    );

    for (const [label, sql] of [
        ["bare add column", `ALTER TABLE "client" ADD COLUMN "note" TEXT;`],
        ["bare add constraint", `ALTER TABLE "client" ADD CONSTRAINT "client_note_check" CHECK (true);`],
        ["bare create type", `CREATE TYPE "mood" AS ENUM ('ok');`],
        ["bare create index", `CREATE UNIQUE INDEX "client_note_key" ON "client" ("note");`],
        ["unguarded drop", `DROP TABLE "client_old";`],
        ["bare rename", `ALTER TABLE "feedback" RENAME TO "service_record";`],
        ["rename column behind a table guard", `ALTER TABLE IF EXISTS "client" RENAME COLUMN "a" TO "b";`],
        ["rename constraint behind a table guard", `ALTER TABLE IF EXISTS "client" RENAME CONSTRAINT "a" TO "b";`],
    ]) {
        assert.equal(findNonIdempotentStatements(sql).length, 1, `${label} must be reported`);
    }

    for (const [label, sql] of [
        ["guarded add column", `ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "note" TEXT;`],
        ["guarded drop", `DROP TABLE IF EXISTS "client_old";`],
        ["drop-then-create index", `DROP INDEX IF EXISTS "public"."client_note_key"; CREATE UNIQUE INDEX "client_note_key" ON "client" ("note");`],
        ["drop-then-add constraint", `ALTER TABLE "client" DROP CONSTRAINT IF EXISTS "c1"; ALTER TABLE "client" ADD CONSTRAINT "c1" CHECK (true);`],
        ["catalog-guarded rename", `DO $$ BEGIN IF to_regclass('public.feedback') IS NOT NULL THEN ALTER TABLE "feedback" RENAME TO "service_record"; END IF; END $$;`],
        // The second run finds no "feedback" relation and skips the statement entirely.
        ["rename behind IF EXISTS", `ALTER TABLE IF EXISTS "feedback" RENAME TO "service_record";`],
        ["index rename behind IF EXISTS", `ALTER INDEX IF EXISTS "idx_old" RENAME TO "idx_new";`],
        ["comment-only mention", `-- CREATE TABLE "scheduler_lease" (...)\nSELECT 1;`],
        ["idempotent seed", `INSERT INTO "scheduler_lease" ("name") VALUES ('x') ON CONFLICT ("name") DO NOTHING;`],
        ["guarded update", `UPDATE "employee_schedule" SET "terminated_at" = now() WHERE "terminated_at" IS NULL AND "start_date" > "end_date";`],
    ]) {
        assert.deepEqual(findNonIdempotentStatements(sql), [], `${label} must not be reported`);
    }
});
