import {
    getPrismaErrorCode,
    isPrismaFailoverEligible,
} from "./prisma-error.utils";

describe("Prisma failover eligibility", () => {
    it.each(["P1001", "P1017"])("accepts %s", (code) => {
        expect(isPrismaFailoverEligible({ code })).toBe(true);
    });

    it.each(["P2024", "P2002", "P2025", "UNKNOWN"])("rejects %s", (code) => {
        expect(isPrismaFailoverEligible({ code })).toBe(false);
    });

    it("rejects non-Prisma errors even when their message resembles a database failure", () => {
        expect(isPrismaFailoverEligible(new Error("Can't reach database server"))).toBe(false);
    });

    it("does not infer a code from a raw database message", () => {
        expect(getPrismaErrorCode(new Error("P1001: database is unavailable"))).toBeNull();
    });
});
