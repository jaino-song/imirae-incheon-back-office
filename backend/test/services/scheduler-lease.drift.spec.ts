import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Every scheduler entry point must consult the host-level lease (ADR-010).
 * This spec scans the whole backend package (not only application/) for `@Cron(` / `@Interval(` declarations and
 * fails when a declaring file never calls `holdsLease()`, so a new scheduler
 * cannot be added without the gate.
 */

const BACKEND_ROOT = resolve(__dirname, "../..");
// Build output, dependencies and generated code are not scheduler sources.
const SKIP_DIRS = new Set<string>(["node_modules", "dist", "coverage", "prisma", ".turbo"]);
const DECORATOR_PATTERN = /@(Cron|Interval)\(/;
const LEASE_CALL = "holdsLease()";
// The lease service itself declares no scheduler; listed for clarity only.
const EXEMPT = new Set<string>(["application/services/scheduler-lease.service.ts"]);

function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (!SKIP_DIRS.has(entry)) {
                out.push(...listSourceFiles(full));
            }
            continue;
        }
        if (full.endsWith(".ts") && !full.endsWith(".spec.ts") && !full.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

describe("scheduler lease drift", () => {
    const schedulerFiles = listSourceFiles(BACKEND_ROOT)
        .filter((file) => DECORATOR_PATTERN.test(readFileSync(file, "utf8")))
        .map((file) => relative(BACKEND_ROOT, file))
        .filter((file) => !EXEMPT.has(file))
        .sort();

    it("finds the scheduler entry points (guards the scan itself)", () => {
        // 15 files declare the 17 @Cron/@Interval methods at the time of ADR-010.
        expect(schedulerFiles.length).toBeGreaterThanOrEqual(15);
    });

    it("every file declaring @Cron/@Interval calls holdsLease()", () => {
        const missing = schedulerFiles.filter(
            (file) => !readFileSync(join(BACKEND_ROOT, file), "utf8").includes(LEASE_CALL),
        );

        if (missing.length > 0) {
            throw new Error(
                "These files declare @Cron/@Interval schedulers but never call SchedulerLeaseService.holdsLease(). " +
                "Add `if (!this.schedulerLease.holdsLease()) return;` as the first statement of each decorated method (ADR-010):\n  " +
                missing.join("\n  "),
            );
        }
    });
});
