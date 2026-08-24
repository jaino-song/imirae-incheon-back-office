import { Prisma } from "@prisma/client";

const TRANSIENT_PRISMA_CONNECTIVITY_CODES = new Set(["P1001", "P1017", "P2024"]);
const PRISMA_FAILOVER_ELIGIBLE_CODES = new Set(["P1001", "P1017"]);
const TRANSIENT_PRISMA_MESSAGE_PATTERNS = [
    "Timed out fetching a new connection from the connection pool",
    "Can't reach database server",
    "Server has closed the connection",
    // The connection pool in front of the database, full. Same meaning as Prisma's own pool
    // timeout above — momentarily out of room, not broken — but it arrives as a
    // PrismaClientUnknownRequestError with no code, so only the text identifies it.
    //
    // Supabase's pooler says EMAXCONNSESSION; pgbouncer says max_client_conn. Both were
    // invisible here, so schedulers took the unrecognised-error path: log an error, no
    // cooldown, and try again on the next tick. On preview that meant every-minute retries
    // against a pool that was already full, from several schedulers at once.
    "EMAXCONNSESSION",
    "max clients reached",
    "max_client_conn",
    "too many clients already",
];

function toErrorWithMessage(error: unknown): { code?: string; message: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return { code: error.code, message: error.message };
    }

    if (error instanceof Error) {
        const maybeCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return { code: maybeCode, message: error.message };
    }

    if (typeof error === "object" && error !== null) {
        const message =
            "message" in error && typeof error.message === "string"
                ? error.message
                : String(error);
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return { code, message };
    }

    return { message: String(error) };
}

export function getPrismaErrorCode(error: unknown): string | null {
    return toErrorWithMessage(error).code ?? null;
}

export function isPrismaFailoverEligible(error: unknown): boolean {
    const code = getPrismaErrorCode(error);
    return code !== null && PRISMA_FAILOVER_ELIGIBLE_CODES.has(code);
}

export function summarizePrismaError(error: unknown): string {
    const { code, message } = toErrorWithMessage(error);
    const compactMessage = message.replace(/\s+/g, " ").trim();
    return code ? `${code}: ${compactMessage}` : compactMessage;
}

export function isTransientPrismaConnectivityError(error: unknown): boolean {
    const { code, message } = toErrorWithMessage(error);

    if (code && TRANSIENT_PRISMA_CONNECTIVITY_CODES.has(code)) {
        return true;
    }

    return TRANSIENT_PRISMA_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}
