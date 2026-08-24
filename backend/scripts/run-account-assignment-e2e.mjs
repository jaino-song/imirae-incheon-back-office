import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const databaseName = `bjj_account_assignment_e2e_${process.pid}_${randomBytes(6).toString("hex")}`;
const databaseUrl = `postgresql://postgres@localhost:5432/${databaseName}`;
const backendDirectory = fileURLToPath(new URL("..", import.meta.url));
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_ACCOUNT_ASSIGNMENT: "1",
    E2E_ACCOUNT_ASSIGNMENT_DB_NAME: databaseName,
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

function assertDisposableDatabaseName(name) {
    if (!/^bjj_account_assignment_e2e_[0-9]+_[0-9a-f]{12}$/.test(name)) {
        throw new Error(`Refusing unsafe account-assignment E2E database name: ${name}`);
    }
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
        "test/e2e/account-assignment.e2e.spec.ts",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
    ]);
} finally {
    if (databaseCreated) {
        dropDatabase();
    }
}
