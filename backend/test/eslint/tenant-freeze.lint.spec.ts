import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for eslint.config.mjs's two `no-restricted-imports`
 * tenant-isolation gates (prisma-freeze + system-scope). Both gates died
 * silently once already: flat config does NOT merge `no-restricted-imports`
 * options across blocks that both match a file — the later matching block's
 * rule value wholly REPLACES the earlier one's for that rule — so a block
 * reordering (or a block losing one of its two patterns) can quietly stop
 * enforcing without any existing test noticing.
 *
 * This spec drives the REAL flat config through the real ESLint CLI (not
 * `ESLint#lintText`/`calculateConfigForFile` in-process) because ESLint's
 * flat-config loader dynamically `import()`s `eslint.config.mjs`, and
 * Jest's CommonJS VM refuses dynamic `import()` without
 * `--experimental-vm-modules` (verified empirically while writing this
 * spec). Shelling out to a real `node` process sidesteps that boundary
 * entirely and is closer to what `pnpm lint` actually runs.
 */

const backendRoot = join(__dirname, "..", "..");
const eslintBin = join(backendRoot, "node_modules", "eslint", "bin", "eslint.js");

interface LintMessage {
    ruleId: string | null;
    message: string;
    severity: number;
}

interface LintResult {
    messages: LintMessage[];
}

/** Lints `code` as if it lived at `virtualPath` (relative to backendRoot), via stdin. */
function lint(virtualPath: string, code: string): LintMessage[] {
    const result = spawnSync(
        process.execPath,
        [eslintBin, "--stdin", "--stdin-filename", virtualPath, "--format", "json"],
        { cwd: backendRoot, input: code, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );

    // ESLint exits 1 when lint errors are found — that's an expected outcome
    // for several of the cases below, not a harness failure. Anything other
    // than 0 (clean) or 1 (lint errors found) means the invocation itself
    // broke (config load failure, syntax error in stdin, etc).
    if (result.status !== 0 && result.status !== 1) {
        throw new Error(
            `eslint --stdin invocation failed (status ${result.status}): ${result.stderr || result.stdout}`,
        );
    }

    const parsed = JSON.parse(result.stdout) as LintResult[];
    return parsed[0]?.messages ?? [];
}

function lintRealFile(relativePath: string): LintMessage[] {
    const code = readFileSync(join(backendRoot, relativePath), "utf8");
    return lint(relativePath, code);
}

function restrictedImportErrors(messages: LintMessage[]): LintMessage[] {
    return messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("eslint.config.mjs tenant-isolation gates", () => {
    describe("given a non-allowlisted application/ file importing PrismaService directly", () => {
        it("should report a no-restricted-imports error", () => {
            // #given
            const code =
                'import { PrismaService } from "infrastructure/database/prisma.service";\n' +
                "export const probe = PrismaService;\n";

            // #when
            const messages = restrictedImportErrors(lint("application/services/__probe__.ts", code));

            // #then
            expect(messages.length).toBeGreaterThanOrEqual(1);
            expect(messages.some((m) => /prisma\.service/i.test(m.message))).toBe(true);
        });
    });

    describe("given an application/ file importing runSystemScope directly", () => {
        it("should report a no-restricted-imports error", () => {
            // #given
            const code =
                'import { runSystemScope } from "infrastructure/tenant/run-system-scope";\n' +
                "export const probe = runSystemScope;\n";

            // #when
            const messages = restrictedImportErrors(lint("application/services/__probe__.ts", code));

            // #then
            expect(messages.length).toBeGreaterThanOrEqual(1);
            expect(messages.some((m) => /runSystemScope/i.test(m.message))).toBe(true);
        });
    });

    describe("given a domain/ file importing runSystemScope directly", () => {
        it("should report a no-restricted-imports error (system-scope gate covers domain/, not just application/interface/module/infrastructure)", () => {
            // #given
            const code =
                'import { runSystemScope } from "infrastructure/tenant/run-system-scope";\n' +
                "export const probe = runSystemScope;\n";

            // #when
            const messages = restrictedImportErrors(lint("domain/services/__probe__.ts", code));

            // #then
            expect(messages.length).toBeGreaterThanOrEqual(1);
            expect(messages.some((m) => /runSystemScope/i.test(m.message))).toBe(true);
        });
    });

    describe("given a REAL grandfathered application/ file importing PrismaService", () => {
        // Any entry from eslint.tenant-freeze.allowlist.mjs works; this one is
        // asserted to stay in that list by this test itself (if it's ever
        // removed from the allowlist, this test starts failing, which is the
        // point).
        const grandfatheredPath = "application/agent/action-coordinator.service.ts";

        it("should NOT report a no-restricted-imports error for its prisma.service import", () => {
            // #when
            const messages = restrictedImportErrors(lintRealFile(grandfatheredPath));

            // #then
            expect(messages).toHaveLength(0);
        });
    });

    describe("given the allowlisted TenantGuard file importing runSystemScope", () => {
        const guardPath = "infrastructure/tenant/tenant.guard.ts";

        it("should NOT report a no-restricted-imports error", () => {
            // #when
            const messages = restrictedImportErrors(lintRealFile(guardPath));

            // #then
            expect(messages).toHaveLength(0);
        });
    });
});
