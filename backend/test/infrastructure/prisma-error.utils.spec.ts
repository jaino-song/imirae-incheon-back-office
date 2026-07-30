import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

/**
 * What Supabase's pooler actually sent on preview at 2026-07-29 17:00:01Z, reduced to the
 * parts that matter: no `code`, and the only signal in the message text.
 */
const POOLER_EXHAUSTED_MESSAGE =
    "Invalid `this.prisma.service_record_case.findMany()` invocation in"
    + " /app/application/services/service-record-finalization.service.ts:29:66"
    + " Error in connector: Error querying the database:"
    + " FATAL: (EMAXCONNSESSION) max clients reached in session mode"
    + " - max clients are limited to pool_size: 15";

describe("isTransientPrismaConnectivityError", () => {
    it("recognises a full connection pool as transient", () => {
        // Before this, the schedulers took the unrecognised-error branch: log an error and
        // retry on the next tick. Several of them, every minute, against a pool that was
        // already full. The cooldown exists for exactly this and was never reached.
        expect(isTransientPrismaConnectivityError(new Error(POOLER_EXHAUSTED_MESSAGE)))
            .toBe(true);
    });

    it.each([
        ["pgbouncer", "FATAL: no more connections allowed (max_client_conn)"],
        ["postgres itself", "FATAL: sorry, too many clients already"],
    ])("recognises %s reporting the same condition", (_label, message) => {
        expect(isTransientPrismaConnectivityError(new Error(message))).toBe(true);
    });

    it.each(["P1001", "P1017", "P2024"])("still recognises %s", (code) => {
        expect(isTransientPrismaConnectivityError(Object.assign(new Error("x"), { code })))
            .toBe(true);
    });

    it("still treats a real query fault as non-transient", () => {
        // Backing off would hide it, and it will not fix itself.
        const error = Object.assign(
            new Error("Unique constraint failed on the fields: (`documentId`)"),
            { code: "P2002" },
        );

        expect(isTransientPrismaConnectivityError(error)).toBe(false);
    });
});

describe("summarizePrismaError", () => {
    it("collapses the multi-line pooler message into one line", () => {
        // It goes into a cooldown warning, which is read in a log stream.
        const summary = summarizePrismaError(new Error(POOLER_EXHAUSTED_MESSAGE));

        expect(summary).not.toContain("\n");
        expect(summary).toContain("EMAXCONNSESSION");
    });
});
