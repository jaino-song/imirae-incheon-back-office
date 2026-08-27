/**
 * @jest-environment node
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const frontendRoot = path.resolve(__dirname);
const nextConfigLoader = path.resolve(frontendRoot, "node_modules/next/dist/server/config");
const nextConstants = path.resolve(frontendRoot, "node_modules/next/constants");

function readAllowedDevOrigins(nodeEnv: "development" | "production") {
    const script = `
        const loadConfig = require(${JSON.stringify(nextConfigLoader)}).default;
        const { PHASE_PRODUCTION_SERVER } = require(${JSON.stringify(nextConstants)});
        loadConfig(PHASE_PRODUCTION_SERVER, ${JSON.stringify(frontendRoot)}, { silent: true })
            .then((config) => process.stdout.write(JSON.stringify(config.allowedDevOrigins ?? null)))
            .catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
    `;
    return execFileSync(process.execPath, ["-e", script], {
        cwd: frontendRoot,
        env: { ...process.env, NODE_ENV: nodeEnv },
        stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
}

describe("Next development origin allowance", () => {
    it("allows the loopback IP for development HMR", () => {
        expect(readAllowedDevOrigins("development")).toBe('["127.0.0.1"]');
    });

    it("does not add a production origin allowance", () => {
        expect(readAllowedDevOrigins("production")).toBe("null");
    });
});
