import { Prisma } from "@prisma/client";

const DEFAULT_PGBOUNCER_CONNECTION_LIMIT = "5";
const DIRECT_CONNECTION_LIMIT = "5";

export const DATABASE_CONNECTION_MODE = {
    SHARED: "shared",
    DIRECT: "direct",
} as const;

export type DatabaseConnectionMode =
    (typeof DATABASE_CONNECTION_MODE)[keyof typeof DATABASE_CONNECTION_MODE];

export interface PrismaClientConfigResult {
    options?: Prisma.PrismaClientOptions;
    appliedDefaults: string[];
    missingRequiredEnvVars: string[];
}

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

export function getDatabaseConnectionMode(
    rawMode = process.env["DATABASE_CONNECTION_MODE"],
): DatabaseConnectionMode {
    if (rawMode === undefined || rawMode === "") {
        return DATABASE_CONNECTION_MODE.SHARED;
    }

    if (
        rawMode === DATABASE_CONNECTION_MODE.SHARED ||
        rawMode === DATABASE_CONNECTION_MODE.DIRECT
    ) {
        return rawMode;
    }

    throw new Error("DATABASE_CONNECTION_MODE must be shared or direct");
}

function getSelectedDatabaseUrl(mode: DatabaseConnectionMode): string | undefined {
    return mode === DATABASE_CONNECTION_MODE.DIRECT
        ? process.env["DIRECT_URL"]
        : process.env["DATABASE_URL"];
}

function parseDatabaseUrl(rawUrl: string): URL {
    try {
        return new URL(stripWrappingQuotes(rawUrl));
    } catch {
        throw new Error("The selected database URL is invalid");
    }
}

function assertDirectConnectionLimit(parsedUrl: URL): void {
    const connectionLimits = parsedUrl.searchParams.getAll("connection_limit");
    if (connectionLimits.length === 1 && connectionLimits[0] === DIRECT_CONNECTION_LIMIT) {
        return;
    }

    throw new Error("Direct database connection requires connection_limit=5");
}

export function createPrismaClientConfig(
    rawUrl?: string,
): PrismaClientConfigResult {
    const mode = getDatabaseConnectionMode();
    const selectedEnvName = mode === DATABASE_CONNECTION_MODE.DIRECT
        ? "DIRECT_URL"
        : "DATABASE_URL";
    const selectedUrl = rawUrl ?? getSelectedDatabaseUrl(mode);
    const missingRequiredEnvVars = selectedUrl
        ? []
        : [selectedEnvName];

    if (!selectedUrl) {
        return { appliedDefaults: [], missingRequiredEnvVars };
    }

    const parsedUrl = parseDatabaseUrl(selectedUrl);
    const appliedDefaults: string[] = [];

    if (mode === DATABASE_CONNECTION_MODE.DIRECT) {
        assertDirectConnectionLimit(parsedUrl);
    }

    if (parsedUrl.searchParams.get("pgbouncer") === "true") {
        if (!parsedUrl.searchParams.has("connection_limit")) {
            parsedUrl.searchParams.set(
                "connection_limit",
                process.env["PRISMA_CONNECTION_LIMIT"] ?? DEFAULT_PGBOUNCER_CONNECTION_LIMIT,
            );
            appliedDefaults.push(`connection_limit=${parsedUrl.searchParams.get("connection_limit")}`);
        }

        const poolTimeout = process.env["PRISMA_POOL_TIMEOUT"];
        if (poolTimeout && !parsedUrl.searchParams.has("pool_timeout")) {
            parsedUrl.searchParams.set("pool_timeout", poolTimeout);
            appliedDefaults.push(`pool_timeout=${poolTimeout}`);
        }
    }

    return {
        options: {
            datasources: {
                db: {
                    url: parsedUrl.toString(),
                },
            },
        },
        appliedDefaults,
        missingRequiredEnvVars,
    };
}
