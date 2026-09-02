import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Every scheduler entry point must consult the host-level lease (ADR-010).
 * This spec scans the whole backend package (not only application/) for
 * `@Cron(` / `@Interval(` / `@Timeout(` declarations and fails when the method
 * that follows a decorator never calls `holdsLease()`, so a new scheduler
 * cannot be added without the gate — not even inside a file that already
 * has gated schedulers.
 */

const BACKEND_ROOT = resolve(__dirname, "../..");
// Build output, dependencies and generated code are not scheduler sources.
const SKIP_DIRS = new Set<string>(["node_modules", "dist", "coverage", "prisma", ".turbo"]);
const DECORATOR_PATTERN = /@(Cron|Interval|Timeout)\(/;
const LEASE_CALL = "holdsLease()";

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

/**
 * Splits a file at every scheduler decorator. Element 0 is the preamble; each
 * later element is the source that follows one decorator up to the next one,
 * i.e. the decorated method (plus anything after it until the next scheduler).
 * The gate is the first statement of the method, so it must appear in there.
 */
function decoratedSegments(source: string): string[] {
    return source.split(new RegExp(DECORATOR_PATTERN.source, "g")).filter((_, index) => index % 2 === 0).slice(1);
}

describe("scheduler lease drift", () => {
    const schedulerFiles = listSourceFiles(BACKEND_ROOT)
        .filter((file) => DECORATOR_PATTERN.test(readFileSync(file, "utf8")))
        .map((file) => relative(BACKEND_ROOT, file))
        .sort();

    it("finds the scheduler entry points (guards the scan itself)", () => {
        // 15 files declare the 17 @Cron/@Interval methods at the time of ADR-010.
        expect(schedulerFiles.length).toBeGreaterThanOrEqual(15);
    });

    it("every @Cron/@Interval/@Timeout method calls holdsLease() before the next scheduler declaration", () => {
        const missing: string[] = [];
        for (const file of schedulerFiles) {
            const segments = decoratedSegments(readFileSync(join(BACKEND_ROOT, file), "utf8"));
            segments.forEach((segment, index) => {
                if (!segment.includes(LEASE_CALL)) {
                    missing.push(`${file} (scheduler #${index + 1} of ${segments.length})`);
                }
            });
        }

        if (missing.length > 0) {
            throw new Error(
                "These @Cron/@Interval/@Timeout methods never call SchedulerLeaseService.holdsLease(). " +
                    "Add `if (!this.schedulerLease.holdsLease()) return;` as the first statement of each decorated method (ADR-010):\n  " +
                    missing.join("\n  "),
            );
        }
    });
});
