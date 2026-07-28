import { spawnSync } from "node:child_process";

const databaseName = "bjj_full_flow_e2e";
const databaseUrl = `postgresql://postgres@localhost:5432/${databaseName}`;
const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NODE_ENV: "test",
    E2E_VENDOR_STUBS: "1",
    EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID: "tpl-test",
};

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { env, stdio: "inherit", ...options });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }
}

function dropDatabase() {
    run("dropdb", ["--host", "localhost", "--username", "postgres", "--if-exists", databaseName]);
}

try {
    dropDatabase();
    run("createdb", ["--host", "localhost", "--username", "postgres", databaseName]);
    run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);
    run("pnpm", ["run", "db:seed:e2e"]);
    run("pnpm", [
        "exec",
        "jest",
        "test/e2e/full-flow.e2e.spec.ts",
        "--testPathIgnorePatterns=/node_modules/",
        "--runInBand",
    ]);
} finally {
    dropDatabase();
}
