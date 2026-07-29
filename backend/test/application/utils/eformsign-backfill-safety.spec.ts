import {
    assertEformsignBackfillConfirmation,
    resolveEformsignBackfillTarget,
} from "application/utils/eformsign-backfill-safety";

describe("eformsign backfill operator safety", () => {
    it("reports a credential-free database target including the Supabase project", () => {
        const target = resolveEformsignBackfillTarget({
            railwayEnvironmentName: "production",
            nodeEnv: "development",
            databaseUrl: "postgresql://postgres.preview-project:secret@db.example.com:6543/babyjamjam?schema=backfill",
        });

        expect(target).toEqual({
            environment: "production",
            databaseHost: "db.example.com",
            databaseTarget: "db.example.com:6543/babyjamjam?schema=backfill&tenant=preview-project",
        });
        expect(JSON.stringify(target)).not.toContain("secret");
        expect(JSON.stringify(target)).not.toContain("postgres.");
    });

    it("requires confirmation bound to the exact normalized database target", () => {
        const target = {
            environment: "production",
            databaseHost: "db.example.com",
            databaseTarget: "db.example.com:5432/babyjamjam?schema=public&tenant=preview-project",
        };

        expect(() =>
            assertEformsignBackfillConfirmation(target, "YES")
        ).toThrow(
            "Set EFORMSIGN_BACKFILL_CONFIRM_TARGET=production@db.example.com:5432/babyjamjam?schema=public&tenant=preview-project",
        );
        expect(() =>
            assertEformsignBackfillConfirmation(
                target,
                "production@db.example.com:5432/babyjamjam?schema=public&tenant=preview-project",
            )
        ).not.toThrow();
    });

    it("distinguishes Supabase projects on the same pooler target", () => {
        const resolveTarget = (project: string) =>
            resolveEformsignBackfillTarget({
                railwayEnvironmentName: "production",
                databaseUrl: `postgresql://postgres.${project}:password@pooler.example.com:6543/postgres?schema=public`,
            }).databaseTarget;

        expect(resolveTarget("dev-project")).not.toBe(resolveTarget("preview-project"));
    });

    it("does not expose the database password in the target or confirmation error", () => {
        const password = "never-print-this-password";
        const target = resolveEformsignBackfillTarget({
            railwayEnvironmentName: "production",
            databaseUrl: `postgresql://postgres.preview-project:${password}@pooler.example.com:6543/postgres?schema=public`,
        });

        expect(JSON.stringify(target)).not.toContain(password);
        expect(() => assertEformsignBackfillConfirmation(target, "wrong"))
            .toThrow(expect.not.stringContaining(password));
    });

    it("fingerprints a generic username instead of exposing it", () => {
        const target = resolveEformsignBackfillTarget({
            railwayEnvironmentName: "production",
            databaseUrl: "postgresql://sensitive-role:secret@db.example.com/app",
        });

        expect(target.databaseTarget).toMatch(
            /^db\.example\.com:5432\/app\?schema=public&tenant=user-[a-f0-9]{12}$/,
        );
        expect(JSON.stringify(target)).not.toContain("sensitive-role");
        expect(JSON.stringify(target)).not.toContain("secret");
    });

    it("distinguishes databases, schemas, and ports on the same host", () => {
        const targets = [
            "postgresql://postgres.project:pw@db.example.com:5432/app_a?schema=public",
            "postgresql://postgres.project:pw@db.example.com:5432/app_b?schema=public",
            "postgresql://postgres.project:pw@db.example.com:5432/app_a?schema=tenant_b",
            "postgresql://postgres.project:pw@db.example.com:6543/app_a?schema=public",
        ].map((databaseUrl) =>
            resolveEformsignBackfillTarget({
                railwayEnvironmentName: "production",
                databaseUrl,
            }).databaseTarget
        );

        expect(new Set(targets).size).toBe(4);
    });

    it("uses NODE_ENV when a Railway environment name is unavailable", () => {
        expect(resolveEformsignBackfillTarget({
            railwayEnvironmentName: " ",
            nodeEnv: "staging",
            databaseUrl: "postgresql://postgres.project@db.example.com/app",
        })).toEqual({
            environment: "staging",
            databaseHost: "db.example.com",
            databaseTarget: "db.example.com:5432/app?schema=public&tenant=project",
        });
    });

    it("fails closed when the target cannot be identified", () => {
        const target = resolveEformsignBackfillTarget({});

        expect(() =>
            assertEformsignBackfillConfirmation(target, "unknown@unknown")
        ).toThrow("Cannot determine the eformsign backfill target");
    });
});
