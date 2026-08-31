import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const port = process.env.PGPORT ?? "5432";
// pid + random suffix so concurrent runs (e.g. two units' e2e suites racing
// against the same throwaway Postgres instance) never collide on database
// name — mirrors run-canonical-phone-identity-e2e.mjs's uniqueness scheme.
const databaseName = `bjj_call_inbox_e2e_${process.pid}_${randomBytes(6).toString("hex")}`;
const databaseUrl = `postgresql://postgres@localhost:${port}/${databaseName}`;
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_VENDOR_STUBS: "1",
};

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { env, stdio: "inherit", ...options });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

function assertDisposableDatabaseName(name) {
    if (!/^bjj_call_inbox_e2e_[0-9]+_[0-9a-f]{12}$/.test(name)) {
        throw new Error(`Refusing unsafe call-inbox E2E database name: ${name}`);
    }
}

function dropDatabase() {
    assertDisposableDatabaseName(databaseName);
    run("dropdb", ["--host", "localhost", "--port", port, "--username", "postgres", "--if-exists", databaseName]);
}

assertDisposableDatabaseName(databaseName);
let databaseCreated = false;

try {
    run("createdb", ["--host", "localhost", "--port", port, "--username", "postgres", databaseName]);
    databaseCreated = true;
    run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);
    run("pnpm", ["run", "db:seed:e2e"]);
    run("pnpm", [
        "exec",
        "jest",
        "test/e2e/call-inbox.e2e.spec.ts",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
    ]);
} finally {
    if (databaseCreated) {
        dropDatabase();
    }
}
