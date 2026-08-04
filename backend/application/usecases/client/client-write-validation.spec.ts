import { BadRequestException, ConflictException } from "@nestjs/common";

import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertPhoneAvailable,
    findClientByNormalizedPhone,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
} from "./client-write-validation";

describe("client write validation", () => {
    it("accepts branch-local and global areas but rejects foreign areas with one generic error", async () => {
        const prisma = { area: { findFirst: jest.fn() } };
        prisma.area.findFirst.mockResolvedValueOnce({ id: "local" });
        await expect(assertAllowedClientArea(prisma, "branch-a", "local")).resolves.toBeUndefined();

        prisma.area.findFirst.mockResolvedValueOnce({ id: "global" });
        await expect(assertAllowedClientArea(prisma, "branch-a", "global")).resolves.toBeUndefined();

        prisma.area.findFirst.mockResolvedValueOnce(null);
        await expect(assertAllowedClientArea(prisma, "branch-a", "foreign"))
            .rejects.toEqual(new BadRequestException("areaId must reference an available area"));
        expect(prisma.area.findFirst).toHaveBeenLastCalledWith({
            where: { id: "foreign", OR: [{ branchId: "branch-a" }, { branchId: null }] },
            select: { id: true },
        });
    });

    it("normalizes formatted phones, allows self, and rejects another client in the same branch", async () => {
        const ownClient = { id: 10 } as never;
        const otherClient = { id: 11 } as never;
        const repository = { findByPhone: jest.fn() };

        repository.findByPhone.mockResolvedValueOnce(ownClient);
        await expect(assertPhoneAvailable(repository, "branch-a", "010-1234-5678", 10)).resolves.toBe("01012345678");
        expect(repository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");

        repository.findByPhone.mockResolvedValueOnce(otherClient);
        await expect(assertPhoneAvailable(repository, "branch-a", "010 1234 5678", 10)).rejects.toBeInstanceOf(ConflictException);
        expect(repository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");

        repository.findByPhone.mockResolvedValueOnce(null);
        await expect(findClientByNormalizedPhone(repository, "branch-a", "010.1234.5678"))
            .resolves.toEqual({ normalizedPhone: "01012345678", existingClient: null });
    });

    it("enforces merged date ordering while preserving canonical null and equal-date behavior", () => {
        const existing = {
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
        };
        expect(() => mergeAndValidateClientServicePeriod(existing, {
            endDate: new Date("2023-12-31T00:00:00.000Z"),
        })).toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        expect(mergeAndValidateClientServicePeriod(existing, {
            endDate: existing.startDate,
        })).toEqual({ startDate: existing.startDate, endDate: existing.startDate });
        expect(mergeAndValidateClientServicePeriod(existing, { startDate: null })).toEqual({
            startDate: null,
            endDate: existing.endDate,
        });
        expect(mergeAndValidateClientServicePeriod(existing, { endDate: null })).toEqual({
            startDate: existing.startDate,
            endDate: null,
        });
        expect(mergeAndValidateClientServicePeriod(existing, { startDate: null, endDate: null })).toEqual({
            startDate: null,
            endDate: null,
        });
    });

    it("accepts only canonical service statuses and keeps calendar date components", () => {
        expect(() => assertAllowedServiceStatus("active")).not.toThrow();
        expect(() => assertAllowedServiceStatus(null)).not.toThrow();
        expect(() => assertAllowedServiceStatus("pending")).toThrow("serviceStatus must be one of");
        expect(parseClientDate("2024-02-29T23:30:00-09:00")).toEqual(new Date("2024-02-29T00:00:00.000Z"));
        expect(parseClientDate(null)).toBeNull();
        expect(parseClientDate(undefined)).toBeUndefined();
    });
});
