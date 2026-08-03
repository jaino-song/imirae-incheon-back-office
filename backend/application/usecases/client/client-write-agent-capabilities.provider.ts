import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { CreateClientUsecase } from "./create-client.usecase";
import { FindClientByIdUsecase } from "./find-client-by-id.usecase";
import { ClientTargetVersionMismatchError, UpdateClientUsecase } from "./update-client.usecase";
import type { AgentFormField } from "@babyjamjam/shared";
import { clientAgentTargetSnapshot, clientAgentTargetVersion } from "./client-agent-target";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertPhoneAvailable,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
} from "./client-write-validation";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { SERVICE_STATUS_VALUES, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { PrismaService } from "infrastructure/database/prisma.service";

const DateOnlyInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const DateInputValue = z.union([
    DateOnlyInput,
    z.string().datetime({ offset: true }),
]);
const DateInput = DateInputValue.nullable().optional();
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
    serviceStatus: z.enum([...SERVICE_STATUS_VALUES] as [ServiceStatusType, ...ServiceStatusType[]]).nullable().optional(),
    breastPump: z.boolean().optional(),
    areaId: z.string().max(100).nullable().optional(),
});

const CreateClientSchema = ClientWriteFields.extend({
    phone: z.string().trim().min(1).max(40),
});
const CLIENT_MUTABLE_FIELD_KEYS = Object.keys(ClientWriteFields.shape);
const UpdateClientSchema = ClientWriteFields.partial().extend({
    id: z.number().int().positive(),
    targetVersion: z.string().min(1).optional(),
}).superRefine((value, context) => {
    if (!CLIENT_MUTABLE_FIELD_KEYS.some((key) => value[key as keyof typeof value] !== undefined)) {
        context.addIssue({ code: "custom", message: "At least one client field must be updated" });
    }
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
    ...CLIENT_FORM_FIELDS.map((field) => ({ ...field, required: false })),
];
const CLIENT_BRANCH_PHONE_UNIQUE_CONSTRAINT = "client_branch_phone_key";

function isClientBranchPhoneUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

    const target = error.meta?.["target"];
    if (target === CLIENT_BRANCH_PHONE_UNIQUE_CONSTRAINT) return true;
    if (!Array.isArray(target) || target.length !== 2) return false;

    const fields = target.map(String);
    return fields.includes("phone") && (fields.includes("branchId") || fields.includes("branch_id"));
}

function clientPhoneConflictError(): AgentActionCertainFailureError {
    return new AgentActionCertainFailureError("A client with this phone already exists in this branch");
}

function sameClientValue(actual: unknown, expected: unknown): boolean {
    if (actual instanceof Date && typeof expected === "string") return actual.toISOString() === parseClientDate(expected)?.toISOString();
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function validationErrorMessage(error: BadRequestException | ConflictException): string {
    const response = error.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
        const message = (response as { message?: unknown }).message;
        if (Array.isArray(message)) return message.join(", ");
        if (typeof message === "string") return message;
    }
    return error.message;
}

async function validateClientWrite(
    prisma: PrismaService,
    repository: Pick<IClientRepository, "findByPhone">,
    branchId: string,
    existing: { id: number; startDate: Date | null; endDate: Date | null } | null,
    updates: {
        areaId?: string | null;
        phone?: string | null;
        serviceStatus?: string | null;
        startDate?: Date | null;
        endDate?: Date | null;
    },
): Promise<void> {
    try {
        assertAllowedServiceStatus(updates.serviceStatus);
        await assertAllowedClientArea(prisma, branchId, updates.areaId);
        await assertPhoneAvailable(repository, branchId, updates.phone, existing?.id);
        mergeAndValidateClientServicePeriod(existing, {
            startDate: updates.startDate,
            endDate: updates.endDate,
        });
    } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) {
            throw new AgentActionCertainFailureError(validationErrorMessage(error));
        }
        throw error;
    }
}

@Injectable()
@AgentCapabilityProvider()
export class ClientWriteAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createClient: CreateClientUsecase,
        private readonly updateClient: UpdateClientUsecase,
        private readonly findClient: FindClientByIdUsecase,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
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
                    const dates = {
                        startDate: parseClientDate(input.startDate) ?? null,
                        endDate: parseClientDate(input.endDate) ?? null,
                    };
                    await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, null, {
                        ...dates,
                        areaId: input.areaId,
                        phone: input.phone,
                        serviceStatus: input.serviceStatus,
                    });
                    try {
                        return await this.prisma.$transaction(async (transaction) => {
                            const client = await this.createClient.execute(context.principal.branchId, {
                                name: input.name,
                                address: input.address ?? null,
                                phone: input.phone,
                                type: input.type ?? null,
                                duration: input.duration ?? null,
                                fullPrice: input.fullPrice ?? null,
                                grant: input.grant ?? null,
                                actualPrice: input.actualPrice ?? null,
                                startDate: dates.startDate,
                                endDate: dates.endDate,
                                careCenter: input.careCenter ?? null,
                                voucherClient: input.voucherClient ?? false,
                                birthday: input.birthday ?? null,
                                dueDate: parseClientDate(input.dueDate) ?? null,
                                birthDate: parseClientDate(input.birthDate) ?? null,
                                serviceStatus: input.serviceStatus ?? null,
                                breastPump: input.breastPump ?? false,
                                areaId: input.areaId ?? null,
                            }, transaction);
                            const result = { id: client.id, name: client.name, status: "created" };
                            await recordAgentActionEffect(transaction, context, "clients.create", "client", client.id, result);
                            return result;
                        });
                    } catch (error) {
                        if (isClientBranchPhoneUniqueViolation(error)) throw clientPhoneConflictError();
                        throw error;
                    }
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
                    const updates = input;
                    await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, {
                        ...updates,
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                    });
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
                    const { id, targetVersion, ...updates } = input;
                    void targetVersion;
                    const parsedUpdates = {
                        ...updates,
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                        dueDate: parseClientDate(updates.dueDate),
                        birthDate: parseClientDate(updates.birthDate),
                    };
                    await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, parsedUpdates);
                    try {
                        const client = await this.updateClient.execute(context.principal.branchId, id, {
                            ...parsedUpdates,
                        });
                        return { id: client.id, name: client.name, status: "updated" };
                    } catch (error) {
                        if (isClientBranchPhoneUniqueViolation(error)) throw clientPhoneConflictError();
                        throw error;
                    }
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const { id, targetVersion, ...updates } = input;
                    void targetVersion;
                    const parsedUpdates = {
                        ...updates,
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                        dueDate: parseClientDate(updates.dueDate),
                        birthDate: parseClientDate(updates.birthDate),
                    };
                    await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, parsedUpdates);
                    try {
                        const client = await this.updateClient.executeApprovedTarget(
                            context.principal.branchId,
                            id,
                            parsedUpdates,
                            expectedTargetVersion,
                        );
                        return { id: client.id, name: client.name, status: "updated" };
                    } catch (error) {
                        if (error instanceof ClientTargetVersionMismatchError) {
                            throw new AgentActionCertainFailureError(error.message);
                        }
                        if (isClientBranchPhoneUniqueViolation(error)) throw clientPhoneConflictError();
                        throw error;
                    }
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
