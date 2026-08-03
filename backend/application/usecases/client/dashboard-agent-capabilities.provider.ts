import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListClientsPaginatedUsecase } from "./list-clients-paginated.usecase";

const InputSchema = z.object({}).default({});
const OutputSchema = z.object({
    totalClients: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative(),
});

@Injectable()
@AgentCapabilityProvider()
export class DashboardAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listClients: ListClientsPaginatedUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: {
                name: "dashboard.summary",
                domain: "dashboard",
                version: "1.0.0",
                description: "Summarize branch client counts without exposing personal contact data",
                risk: "read",
                requiredRoles: ["owner", "admin", "manager", "user"],
                renderer: "activity",
                flagKey: "agent.capability.dashboard.summary",
                sideEffect: false,
            },
            inputSchema: InputSchema,
            outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                InputSchema.parse(rawInput);
                const firstPage = await this.listClients.execute(context.principal.branchId, 1, 100);
                const pages = [firstPage.data];
                for (let page = 2; page <= firstPage.totalPages; page += 1) {
                    pages.push((await this.listClients.execute(context.principal.branchId, page, 100)).data);
                }
                const activeClients = pages.flat().filter((client) => {
                    const status = client.serviceStatus?.toLowerCase();
                    return status !== "completed" && status !== "cancelled" && status !== "canceled";
                }).length;
                return OutputSchema.parse({ totalClients: firstPage.total, activeClients });
            },
        }];
    }
}
