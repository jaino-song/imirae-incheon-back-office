import { Prisma } from "@prisma/client";

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

    it.each(["P1001", "P1017"])(
        "reads %s from PrismaClientInitializationError.errorCode",
        (errorCode) => {
            const error = new Prisma.PrismaClientInitializationError(
                "Database initialization failed",
                "6.19.2",
                errorCode,
            );

            expect(getPrismaErrorCode(error)).toBe(errorCode);
            expect(isPrismaFailoverEligible(error)).toBe(true);
        },
    );

    it("rejects an ineligible PrismaClientInitializationError.errorCode", () => {
        const error = new Prisma.PrismaClientInitializationError(
            "Database initialization failed",
            "6.19.2",
            "P2024",
        );

        expect(getPrismaErrorCode(error)).toBe("P2024");
        expect(isPrismaFailoverEligible(error)).toBe(false);
    });
});
