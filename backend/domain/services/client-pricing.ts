import { normalizeKoreanWon } from "domain/value-objects/money.vo";

interface ClientPricingInput {
    voucherClient: boolean;
    type: string | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
}

interface ClientPricingFields {
    type: string | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
}

export function normalizeClientPricing(input: ClientPricingInput): ClientPricingFields {
    if (input.voucherClient) {
        return {
            type: input.type,
            fullPrice: normalizeKoreanWon(input.fullPrice),
            grant: normalizeKoreanWon(input.grant),
            actualPrice: normalizeKoreanWon(input.actualPrice),
        };
    }

    return {
        type: null,
        fullPrice: normalizeKoreanWon(input.fullPrice),
        grant: "0",
        actualPrice: normalizeKoreanWon(input.fullPrice),
    };
}
