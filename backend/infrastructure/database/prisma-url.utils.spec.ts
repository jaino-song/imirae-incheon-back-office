import {
    createPrismaClientConfig,
    DATABASE_CONNECTION_MODE,
    getDatabaseConnectionMode,
} from "./prisma-url.utils";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["DATABASE_CONNECTION_MODE"];
    delete process.env["DATABASE_URL"];
    delete process.env["DIRECT_URL"];
    delete process.env["PRISMA_CONNECTION_LIMIT"];
    delete process.env["PRISMA_POOL_TIMEOUT"];
});

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

describe("getDatabaseConnectionMode", () => {
    it("defaults to shared when the selector is absent", () => {
        expect(getDatabaseConnectionMode()).toBe(DATABASE_CONNECTION_MODE.SHARED);
    });

    it.each([
        ["shared", DATABASE_CONNECTION_MODE.SHARED],
        ["direct", DATABASE_CONNECTION_MODE.DIRECT],
    ])("accepts the literal %s selector", (value, expected) => {
        expect(getDatabaseConnectionMode(value)).toBe(expected);
    });

    it("rejects an unsupported selector instead of silently choosing a route", () => {
        expect(() => getDatabaseConnectionMode("pooler")).toThrow(
            "DATABASE_CONNECTION_MODE must be shared or direct",
        );
    });
});

describe("createPrismaClientConfig", () => {
    it("selects DATABASE_URL in shared mode and preserves pooler defaults", () => {
        process.env["DATABASE_CONNECTION_MODE"] = "shared";
        process.env["DATABASE_URL"] =
            "postgresql://shared-user:shared-password@shared.example.test:5432/app?pgbouncer=true";
        process.env["DIRECT_URL"] =
            "postgresql://direct-user:direct-password@direct.example.test:5432/app?connection_limit=5";
        process.env["PRISMA_POOL_TIMEOUT"] = "10";

        const result = createPrismaClientConfig();
        const url = result.options?.datasources?.db?.url;

        expect(url).toContain("shared.example.test");
        expect(new URL(url ?? "").searchParams.get("connection_limit")).toBe("5");
        expect(new URL(url ?? "").searchParams.get("pool_timeout")).toBe("10");
        expect(result.appliedDefaults).toEqual(["connection_limit=5", "pool_timeout=10"]);
    });

    it("selects DIRECT_URL in direct mode", () => {
        process.env["DATABASE_CONNECTION_MODE"] = "direct";
        process.env["DATABASE_URL"] =
            "postgresql://shared-user:shared-password@shared.example.test:5432/app?pgbouncer=true";
        process.env["DIRECT_URL"] =
            "postgresql://direct-user:direct-password@direct.example.test:5432/app?connection_limit=5";

        const result = createPrismaClientConfig();

        expect(result.options?.datasources?.db?.url).toContain("direct.example.test");
        expect(result.options?.datasources?.db?.url).not.toContain("shared.example.test");
    });

    it.each([
        "postgresql://direct-user:direct-password@direct.example.test:5432/app",
        "postgresql://direct-user:direct-password@direct.example.test:5432/app?connection_limit=4",
        "postgresql://direct-user:direct-password@direct.example.test:5432/app?connection_limit=05",
        "postgresql://direct-user:direct-password@direct.example.test:5432/app?connection_limit=4&connection_limit=5",
    ])("rejects Direct startup unless the parsed query has connection_limit=5: %s", (url) => {
        process.env["DATABASE_CONNECTION_MODE"] = "direct";
        process.env["DIRECT_URL"] = url;

        expect(() => createPrismaClientConfig()).toThrow(
            "Direct database connection requires connection_limit=5",
        );
    });

    it("rejects an invalid selected URL without exposing its contents", () => {
        const secretUrl = "not-a-url-with-password=super-secret";
        process.env["DATABASE_URL"] = secretUrl;

        let thrown: Error | undefined;
        try {
            createPrismaClientConfig();
        } catch (error) {
            thrown = error as Error;
        }

        expect(thrown?.message).toBe("The selected database URL is invalid");
        expect(thrown?.message).not.toContain(secretUrl);
    });

    it("reports only the selected missing environment variable", () => {
        process.env["DATABASE_CONNECTION_MODE"] = "direct";

        expect(createPrismaClientConfig()).toEqual({
            appliedDefaults: [],
            missingRequiredEnvVars: ["DIRECT_URL"],
        });
    });
});
