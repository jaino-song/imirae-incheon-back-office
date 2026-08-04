import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListBankAccountInfoUsecase } from "./list-bank-account-info.usecase";

const AccountSchema = z.object({ area: z.string(), bankName: z.string().nullable(), accountLast4: z.string().nullable() });
const InputSchema = z.object({ area: z.string().trim().max(80).optional() });
const OutputSchema = z.object({ accounts: z.array(AccountSchema) });

function maskAccount(account: string | null): string | null {
    const digits = account?.replace(/\D/g, "") ?? "";
    return digits ? digits.slice(-4) : null;
}

@Injectable()
@AgentCapabilityProvider()
export class BankAccountAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listAccounts: ListBankAccountInfoUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "bank.accounts", domain: "bank", version: "1.0.0", description: "Read branch bank account references without exposing full account numbers", risk: "read", requiredRoles: ["owner", "admin"], renderer: "text", flagKey: "agent.capability.bank.accounts", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                const input = InputSchema.parse(rawInput);
                const accounts = await this.listAccounts.executeForBranch(context.principal.branchId);
                return { accounts: accounts.filter((account) => !input.area || account.area.toLocaleLowerCase().includes(input.area.toLocaleLowerCase())).map((account) => ({ area: account.area, bankName: account.bankName, accountLast4: maskAccount(account.accNum) })) };
            },
        }];
    }
}
