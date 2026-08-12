import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";

import {
    ResolveVoucherServiceSelectionUsecase,
    VoucherServiceSelectionError,
} from "./resolve-voucher-service-selection.usecase";

describe("ResolveVoucherServiceSelectionUsecase", () => {
    const rows = [
        new VoucherPriceInfoEntity(1, "A통합1형", BigInt(15), "1500000", "1000000", "500000", 2026),
        new VoucherPriceInfoEntity(2, "A통합1형", BigInt(25), "2500000", "1700000", "800000", 2026),
        new VoucherPriceInfoEntity(3, "A통합1형", BigInt(35), "3500000", "2400000", "1100000", 2026),
    ];

    function setup(inputRows = rows) {
        const findByType = { execute: jest.fn().mockResolvedValue(inputRows) };
        return {
            findByType,
            resolver: new ResolveVoucherServiceSelectionUsecase(findByType as never),
        };
    }

    it.each([
        ["단축형", 15, "1500000", "1000000", "500000"],
        ["표준형", 25, "2500000", "1700000", "800000"],
        ["연장형", 35, "3500000", "2400000", "1100000"],
    ])("selects the %s row for an exact type and service year", async (variant, duration, fullPrice, grant, actualPrice) => {
        const { resolver, findByType } = setup();

        await expect(resolver.execute({
            type: `A통합 1형 ${variant}`,
            startDate: "2026-04-01",
        })).resolves.toEqual({
            type: "A통합1형",
            duration,
            fullPrice,
            grant,
            actualPrice,
        });

        expect(findByType.execute).toHaveBeenCalledWith("A통합1형", 2026);
    });

    it("normalizes internal whitespace and hyphen variants before querying", async () => {
        const { resolver, findByType } = setup();

        await expect(resolver.execute({
            type: " A - 통합 - 1형 - 연장형 ",
            startDate: new Date("2026-12-31T00:00:00.000Z"),
        })).resolves.toMatchObject({ type: "A통합1형", duration: 35 });

        expect(findByType.execute).toHaveBeenCalledWith("A통합1형", 2026);
    });

    it("uses an explicit duration when row cardinality cannot map variants safely", async () => {
        const ambiguousRows = [
            ...rows,
            new VoucherPriceInfoEntity(4, "A통합1형", BigInt(45), "4500000", "3000000", "1500000", 2026),
        ];
        const { resolver } = setup(ambiguousRows);

        await expect(resolver.execute({
            type: "A통합1형 연장형",
            startDate: "2026-01-01",
        })).rejects.toBeInstanceOf(VoucherServiceSelectionError);

        await expect(resolver.execute({
            type: "A통합1형 연장형",
            startDate: "2026-01-01",
            duration: 45,
        })).resolves.toMatchObject({ type: "A통합1형", duration: 45 });
    });

    it("rejects a variant whose explicit duration does not identify the same row", async () => {
        const { resolver } = setup();

        await expect(resolver.execute({
            type: "A통합1형 연장형",
            startDate: "2026-01-01",
            duration: 25,
        })).rejects.toThrow("연장형");
    });

    it.each<[{ type: string; startDate?: string; duration?: number }, string]>([
        [{ type: "A통합1형 연장형" }, "service start date"],
        [{ type: "A통합1형 연장형", startDate: "2025-01-01" }, "price row"],
        [{ type: "A통합1형 연장형", startDate: "2026-01-01", duration: 999 }, "duration"],
    ])("fails closed with an actionable error when selection input is incomplete (%s)", async (input, message) => {
        const { resolver } = setup(input.startDate === "2025-01-01" ? [] : rows);

        await expect(resolver.execute(input)).rejects.toThrow(message);
    });

    it("rejects a voucher row whose duration cannot be represented as a safe integer", async () => {
        const { resolver } = setup([
            new VoucherPriceInfoEntity(8, "A통합1형", BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), null, "100", "100", 2026),
        ]);

        await expect(resolver.execute({ type: "A통합1형", startDate: "2026-01-01" }))
            .rejects.toThrow("safe integer");
    });

    it("rejects a voucher row with incomplete authoritative prices", async () => {
        const { resolver } = setup([
            new VoucherPriceInfoEntity(9, "A통합1형", BigInt(15), null, "100", "100", 2026),
        ]);

        await expect(resolver.execute({ type: "A통합1형", startDate: "2026-01-01" }))
            .rejects.toThrow("authoritative price");
    });
});
