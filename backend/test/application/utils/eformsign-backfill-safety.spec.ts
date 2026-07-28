import {
    assertEformsignBackfillConfirmation,
    resolveEformsignBackfillTarget,
} from "application/utils/eformsign-backfill-safety";

describe("eformsign backfill operator safety", () => {
    it("reports the environment and database hostname without exposing credentials", () => {
        const target = resolveEformsignBackfillTarget({
            railwayEnvironmentName: "production",
            nodeEnv: "development",
            databaseUrl: "postgresql://admin:secret@db.example.com:5432/babyjamjam",
        });

        expect(target).toEqual({
            environment: "production",
            databaseHost: "db.example.com",
        });
        expect(JSON.stringify(target)).not.toContain("secret");
    });

    it("requires confirmation bound to the exact environment and database host", () => {
        const target = {
            environment: "production",
            databaseHost: "db.example.com",
        };

        expect(() =>
            assertEformsignBackfillConfirmation(target, "YES")
        ).toThrow(
            "Set EFORMSIGN_BACKFILL_CONFIRM_TARGET=production@db.example.com",
        );
        expect(() =>
            assertEformsignBackfillConfirmation(
                target,
                "production@db.example.com",
            )
        ).not.toThrow();
    });

    it("uses NODE_ENV when a Railway environment name is unavailable", () => {
        expect(resolveEformsignBackfillTarget({
            railwayEnvironmentName: " ",
            nodeEnv: "staging",
            databaseUrl: "postgresql://db.example.com/app",
        })).toEqual({
            environment: "staging",
            databaseHost: "db.example.com",
        });
    });

    it("fails closed when the target cannot be identified", () => {
        const target = resolveEformsignBackfillTarget({});

        expect(() =>
            assertEformsignBackfillConfirmation(target, "unknown@unknown")
        ).toThrow("Cannot determine the eformsign backfill target");
    });
});
