import { normalizeClientPricing } from "domain/services/client-pricing";

describe("normalizeClientPricing", () => {
    it("should clear voucher fields and mirror the editable total for out-of-pocket clients", () => {
        expect(normalizeClientPricing({
            voucherClient: false,
            type: "A가1형",
            fullPrice: "900000",
            grant: "500000",
            actualPrice: "400000",
        })).toEqual({
            type: null,
            fullPrice: "900000",
            grant: "0",
            actualPrice: "900000",
        });
    });

    it("should preserve voucher pricing fields for voucher clients", () => {
        expect(normalizeClientPricing({
            voucherClient: true,
            type: "A가1형",
            fullPrice: "1464000",
            grant: "1002000",
            actualPrice: "462000",
        })).toEqual({
            type: "A가1형",
            fullPrice: "1464000",
            grant: "1002000",
            actualPrice: "462000",
        });
    });

    it("canonicalizes formatted Korean-won input before persistence", () => {
        expect(normalizeClientPricing({
            voucherClient: true,
            type: "A가1형",
            fullPrice: " 1,464,000원 ",
            grant: "1,002,000원",
            actualPrice: "462,000",
        })).toEqual({
            type: "A가1형",
            fullPrice: "1464000",
            grant: "1002000",
            actualPrice: "462000",
        });
    });

    it.each(["1000abc", "1000.50", "1,00"])
    ("rejects malformed Korean-won input: %s", (value) => {
        expect(() => normalizeClientPricing({
            voucherClient: true,
            type: "A가1형",
            fullPrice: value,
            grant: "0",
            actualPrice: "0",
        })).toThrow("Invalid Korean won amount");
    });
});
