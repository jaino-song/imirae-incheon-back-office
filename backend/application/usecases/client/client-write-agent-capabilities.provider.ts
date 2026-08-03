import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { CreateClientUsecase } from "./create-client.usecase";
import { FindClientByIdUsecase } from "./find-client-by-id.usecase";
import { ListClientsPaginatedUsecase } from "./list-clients-paginated.usecase";
import { UpdateClientUsecase } from "./update-client.usecase";
import type { AgentFormField } from "@babyjamjam/shared";
import { clientAgentTargetSnapshot, clientAgentTargetVersion } from "./client-agent-target";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import { PrismaService } from "infrastructure/database/prisma.service";

const DateInput = z.string().datetime({ offset: true }).nullable().optional();
const ClientWriteFields = z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    type: z.string().trim().max(40).nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    fullPrice: z.string().max(40).nullable().optional(),
    grant: z.string().max(80).nullable().optional(),
    actualPrice: z.string().max(40).nullable().optional(),
    startDate: DateInput,
    endDate: DateInput,
    careCenter: z.boolean().nullable().optional(),
    voucherClient: z.boolean().optional(),
    birthday: z.string().max(20).nullable().optional(),
    dueDate: DateInput,
    birthDate: DateInput,
    serviceStatus: z.string().max(40).nullable().optional(),
    breastPump: z.boolean().optional(),
    areaId: z.string().max(100).nullable().optional(),
});

const CreateClientSchema = ClientWriteFields.extend({
    phone: z.string().trim().min(1).max(40),
});
const UpdateClientSchema = ClientWriteFields.partial().extend({
    id: z.number().int().positive(),
    targetVersion: z.string().min(1).optional(),
});
const ClientWriteOutputSchema = z.object({ id: z.number().int().positive(), name: z.string(), status: z.string() });
const CLIENT_FORM_FIELDS: AgentFormField[] = [
    { name: "name", label: "산모 이름", type: "text", required: true },
    { name: "phone", label: "전화번호", type: "text", required: true },
    { name: "type", label: "서비스 유형", type: "text" },
    { name: "duration", label: "이용 기간", type: "number" },
    { name: "dueDate", label: "출산 예정일", type: "date" },
    { name: "startDate", label: "서비스 시작일", type: "date" },
    { name: "endDate", label: "서비스 종료일", type: "date" },
];
const CLIENT_UPDATE_FORM_FIELDS: AgentFormField[] = [
    { name: "id", label: "고객 ID", type: "number", required: true },
    ...CLIENT_FORM_FIELDS.filter((field) => field.name !== "phone" || !field.required),
];

function date(value: string | null | undefined): Date | null | undefined {
    return value === undefined ? undefined : value === null ? null : new Date(value);
}

function sameClientValue(actual: unknown, expected: unknown): boolean {
    if (actual instanceof Date && typeof expected === "string") return actual.toISOString() === new Date(expected).toISOString();
    return JSON.stringify(actual) === JSON.stringify(expected);
}

@Injectable()
@AgentCapabilityProvider()
export class ClientWriteAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createClient: CreateClientUsecase,
        private readonly updateClient: UpdateClientUsecase,
        private readonly findClient: FindClientByIdUsecase,
        private readonly listClients: ListClientsPaginatedUsecase,
        private readonly prisma: PrismaService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "clients",
            version: "1.0.0",
            requiredRoles: ["owner", "admin", "manager"],
            sideEffect: true,
            risk: "reversible-write" as const,
            renderer: "action-proposal" as const,
            approvalPolicy: "structured" as const,
            idempotencyPolicy: "action-id" as const,
        };
        return [
            {
                meta: { ...common, name: "clients.create", description: "Create a client after explicit approval", flagKey: "agent.capability.clients.create" },
                inputSchema: CreateClientSchema,
                outputSchema: ClientWriteOutputSchema,
                formFields: CLIENT_FORM_FIELDS,
                execute: async (context, rawInput) => {
                    const input = CreateClientSchema.parse(rawInput);
                    const duplicate = input.phone ? await this.listClients.execute(context.principal.branchId, 1, 10, input.phone) : null;
                    if (duplicate?.data.some((candidate) => candidate.phone === input.phone)) {
                        throw new AgentActionCertainFailureError("A client with this phone already exists");
                    }
                    const client = await this.createClient.execute(context.principal.branchId, {
                        name: input.name,
                        address: input.address ?? null,
                        phone: input.phone,
                        type: input.type ?? null,
                        duration: input.duration ?? null,
                        fullPrice: input.fullPrice ?? null,
                        grant: input.grant ?? null,
                        actualPrice: input.actualPrice ?? null,
                        startDate: date(input.startDate) ?? null,
                        endDate: date(input.endDate) ?? null,
                        careCenter: input.careCenter ?? null,
                        voucherClient: input.voucherClient ?? false,
                        birthday: input.birthday ?? null,
                        dueDate: date(input.dueDate) ?? null,
                        birthDate: date(input.birthDate) ?? null,
                        serviceStatus: input.serviceStatus ?? null,
                        breastPump: input.breastPump ?? false,
                        areaId: input.areaId ?? null,
                    });
                    const result = { id: client.id, name: client.name, status: "created" };
                    await recordAgentActionEffect(this.prisma, context, "clients.create", "client", client.id, result);
                    return result;
                },
                reconcile: async (context) => {
                    const receipt = await readAgentActionEffect(this.prisma, context, "clients.create");
                    const result = receipt?.resourceType === "client" ? ClientWriteOutputSchema.safeParse(receipt.result) : null;
                    return result?.success
                        ? { status: "succeeded", result: result.data }
                        : { status: "uncertain", reason: "No action-bound client creation receipt was found" };
                },
            },
            {
                meta: { ...common, name: "clients.update", description: "Update an existing client after explicit approval", flagKey: "agent.capability.clients.update" },
                inputSchema: UpdateClientSchema,
                outputSchema: ClientWriteOutputSchema,
                formFields: CLIENT_UPDATE_FORM_FIELDS,
                inspect: async (context, rawInput) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    return {
                        targetVersion: clientAgentTargetVersion(existing),
                        targetSnapshot: clientAgentTargetSnapshot(existing),
                        summary: `${existing.name} 고객의 ${Object.keys(input).filter((key) => !["id", "targetVersion"].includes(key)).join(", ")} 항목을 변경합니다.`,
                    };
                },
                revalidate: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    const currentVersion = clientAgentTargetVersion(existing);
                    return {
                        valid: Boolean(existing) && currentVersion === expectedTargetVersion,
                        currentVersion,
                        reason: existing ? "Client changed since approval was requested" : "Client no longer exists",
                    };
                },
                execute: async (context, rawInput) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const { id, targetVersion: _targetVersion, ...updates } = input;
                    const client = await this.updateClient.execute(context.principal.branchId, id, {
                        ...updates,
                        startDate: date(updates.startDate),
                        endDate: date(updates.endDate),
                        dueDate: date(updates.dueDate),
                        birthDate: date(updates.birthDate),
                    });
                    return { id: client.id, name: client.name, status: "updated" };
                },
                reconcile: async (context, rawInput) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) return { status: "failed", reason: "Client no longer exists" };
                    const desired = Object.entries(input).filter(([key, value]) => !["id", "targetVersion"].includes(key) && value !== undefined);
                    if (desired.every(([key, value]) => sameClientValue(existing[key as keyof typeof existing], value))) {
                        return { status: "succeeded", result: { id: existing.id, name: existing.name, status: "updated" } };
                    }
                    return { status: "uncertain", reason: "Client does not match the approved update" };
                },
            },
        ];
    }
}
