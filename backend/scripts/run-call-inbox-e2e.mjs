import { spawnSync } from "node:child_process";

const port = process.env.PGPORT ?? "5432";
const databaseName = "bjj_call_inbox_e2e";
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

function dropDatabase() {
    run("dropdb", ["--host", "localhost", "--port", port, "--username", "postgres", "--if-exists", databaseName]);
}

try {
    dropDatabase();
    run("createdb", ["--host", "localhost", "--port", port, "--username", "postgres", databaseName]);
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
    dropDatabase();
}
