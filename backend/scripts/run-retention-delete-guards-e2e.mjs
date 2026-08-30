import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const databaseName = `bjj_retention_delete_e2e_${process.pid}_${randomBytes(6).toString("hex")}`;
const databaseUrl = `postgresql://postgres@localhost:5432/${databaseName}`;
const backendDirectory = fileURLToPath(new URL("..", import.meta.url));
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_RETENTION_DELETE_GUARDS: "1",
};

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: backendDirectory,
        env,
        stdio: "inherit",
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

function assertDisposableDatabaseName(name) {
    if (!/^bjj_retention_delete_e2e_[0-9]+_[0-9a-f]{12}$/.test(name)) {
        throw new Error(`Refusing unsafe retention-delete E2E database name: ${name}`);
    }
}

function dropDatabase() {
    assertDisposableDatabaseName(databaseName);
    run("dropdb", [
        "--host",
        "localhost",
        "--username",
        "postgres",
        "--if-exists",
        "--force",
        databaseName,
    ]);
}

assertDisposableDatabaseName(databaseName);
let databaseCreated = false;

try {
    run("createdb", ["--host", "localhost", "--username", "postgres", databaseName]);
    databaseCreated = true;
    run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);
    run("pnpm", [
        "exec",
        "jest",
        "test/e2e/retention-delete-guards.e2e.spec.ts",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
    ]);
} finally {
    if (databaseCreated) {
        dropDatabase();
    }
}
