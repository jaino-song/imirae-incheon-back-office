import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListVoucherPriceInfoUsecase } from "./list-voucher-price-info.usecase";

const ItemSchema = z.object({ id: z.number().int().positive(), type: z.string().nullable(), duration: z.string().nullable(), fullPrice: z.string().nullable(), grant: z.string().nullable(), actualPrice: z.string().nullable(), year: z.number().int() });
const InputSchema = z.object({ year: z.number().int().min(2000).max(2100).optional(), type: z.string().trim().max(80).optional() });
const OutputSchema = z.object({ items: z.array(ItemSchema) });

@Injectable()
@AgentCapabilityProvider()
export class VoucherAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listVoucherPrices: ListVoucherPriceInfoUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "vouchers.prices", domain: "vouchers", version: "1.0.0", description: "Read voucher price information", risk: "read", requiredRoles: ["owner", "admin", "manager"], renderer: "text", flagKey: "agent.capability.vouchers.prices", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (_context, rawInput) => {
                const input = InputSchema.parse(rawInput);
                const items = await this.listVoucherPrices.execute();
                return { items: items.filter((item) => (input.year === undefined || item.year === input.year) && (!input.type || item.type?.toLocaleLowerCase().includes(input.type.toLocaleLowerCase()))).slice(0, 100).map((item) => ({ id: item.id, type: item.type, duration: item.duration?.toString() ?? null, fullPrice: item.fullPrice, grant: item.grant, actualPrice: item.actualPrice, year: item.year })) };
            },
        }];
    }
}
