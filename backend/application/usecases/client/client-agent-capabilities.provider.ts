import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { FindClientByIdUsecase } from "./find-client-by-id.usecase";
import { ListClientsPaginatedUsecase } from "./list-clients-paginated.usecase";

const ClientSummarySchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    serviceStatus: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    voucherClient: z.boolean(),
});

const SearchInputSchema = z.object({ query: z.string().trim().min(1).max(100) });
const SearchOutputSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none"), query: z.string() }),
    z.object({ kind: z.literal("entity"), entity: ClientSummarySchema }),
    z.object({
        kind: z.literal("choices"),
        prompt: z.string(),
        choices: z.array(ClientSummarySchema.pick({ id: true, name: true, serviceStatus: true })).min(2),
    }),
]);
const GetInputSchema = z.object({ id: z.number().int().positive() });
const GetOutputSchema = z.object({ kind: z.literal("entity"), entity: ClientSummarySchema });

const toSummary = (client: {
    id: number; name: string; serviceStatus: string | null; startDate: Date | null;
    endDate: Date | null; voucherClient: boolean;
}) => ({
    id: client.id,
    name: client.name,
    serviceStatus: client.serviceStatus,
    startDate: client.startDate?.toISOString() ?? null,
    endDate: client.endDate?.toISOString() ?? null,
    voucherClient: client.voucherClient,
});

@Injectable()
@AgentCapabilityProvider()
export class ClientAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly listClients: ListClientsPaginatedUsecase,
        private readonly findClient: FindClientByIdUsecase,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "clients",
            version: "1.0.0",
            risk: "read" as const,
            requiredRoles: ["owner", "admin", "manager", "user"],
            sideEffect: false,
        };
        return [
            {
                meta: {
                    ...common,
                    name: "clients.search",
                    description: "Search clients in the current branch by name or identifier",
                    renderer: "entity-choice",
                    flagKey: "agent.capability.clients.search",
                },
                inputSchema: SearchInputSchema,
                outputSchema: SearchOutputSchema,
                execute: async (context, rawInput) => {
                    const input = SearchInputSchema.parse(rawInput);
                    const result = await this.listClients.execute(context.principal.branchId, 1, 10, input.query);
                    if (result.data.length === 0) return { kind: "none" as const, query: input.query };
                    if (result.data.length === 1) return { kind: "entity" as const, entity: toSummary(result.data[0]!) };
                    return {
                        kind: "choices" as const,
                        prompt: "어느 산모를 말씀하시는지 선택해 주세요.",
                        choices: result.data.map(toSummary),
                    };
                },
            },
            {
                meta: {
                    ...common,
                    name: "clients.get",
                    description: "Get a client from the current branch by canonical client id",
                    renderer: "text",
                    flagKey: "agent.capability.clients.get",
                },
                inputSchema: GetInputSchema,
                outputSchema: GetOutputSchema,
                execute: async (context, rawInput) => {
                    const input = GetInputSchema.parse(rawInput);
                    const client = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!client) throw new Error("Client not found");
                    return { kind: "entity" as const, entity: toSummary(client) };
                },
            },
        ];
    }
}
