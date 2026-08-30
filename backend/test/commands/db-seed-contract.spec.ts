import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(__dirname, "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const backendPackage = JSON.parse(
  readFileSync(path.join(backendRoot, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
  prisma?: Record<string, string>;
};

describe("development database seed contract", () => {
  it("does not configure a missing default Prisma seed entrypoint", () => {
    expect(backendPackage.prisma?.["seed"]).toBeUndefined();
  });

  it("keeps the unsupported-seed guard dependency-free and failing", () => {
    const guard = readFileSync(
      path.join(backendRoot, "scripts/db-seed-unsupported.mjs"),
      "utf8",
    );

    expect(guard).not.toContain("PrismaClient");
    expect(guard).not.toContain("@prisma/client");
    expect(guard).toContain("process.exitCode = 1");
  });

  it("fails db:seed explicitly without attempting a database connection", () => {
    const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(packageManager, ["--filter", "./backend", "run", "db:seed"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://127.0.0.1:1/seed-contract-test",
      },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(output).toContain("No general-purpose development database seed is supported.");
    expect(output).toContain("db:seed:e2e");
    expect(output).toContain("db:seed:auth-e2e");
  });

  it("documents the unsupported default and isolated alternatives", () => {
    const readme = readFileSync(path.join(repositoryRoot, "README.md"), "utf8");

    expect(readme).toContain("No general-purpose development database seed is supported.");
    expect(readme).toContain("pnpm --filter ./backend db:seed:e2e");
    expect(readme).toContain("pnpm --filter ./backend db:seed:auth-e2e");
    expect(readme).not.toContain("Optional development seed:");
  });
});
