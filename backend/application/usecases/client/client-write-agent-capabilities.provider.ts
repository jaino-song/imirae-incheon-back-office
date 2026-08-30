import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
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
import { normalizeClientPricing } from "domain/services/client-pricing";
import {
    assertClientDurationMatchesDates,
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertPhoneAvailable,
    assertClientPhoneInput,
    deriveClientDuration,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
} from "./client-write-validation";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { KOREAN_WON_INPUT_PATTERN } from "domain/value-objects/money.vo";
import { SERVICE_STATUS_VALUES, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import {
    isVoucherServiceLabel,
    ResolveVoucherServiceSelectionUsecase,
} from "application/usecases/voucher-price-info/resolve-voucher-service-selection.usecase";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";

const DateOnlyInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const DateInputValue = z.union([
    DateOnlyInput,
    z.string().datetime({ offset: true }),
]);
const DateInput = DateInputValue.nullable().optional();
const KoreanWonInput = z.string().trim().regex(
    KOREAN_WON_INPUT_PATTERN,
    "Amount must be a whole Korean-won value with no trailing text or decimals",
);

function isCalendarValidYymmdd(value: string): boolean {
    if (!/^\d{6}$/.test(value)) return false;

    const year = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day < 1) return false;

    const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (daysInMonth[month - 1] ?? 0);
}

const ClientBirthdaySchema = z.string()
    .regex(/^\d{6}$/, "Birthday must be six numeric YYMMDD digits")
    .refine(isCalendarValidYymmdd, "Birthday must be a calendar-valid YYMMDD date")
    .nullable()
    .optional();

const ClientWriteFields = z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    type: z.string().trim().max(40).nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    fullPrice: KoreanWonInput.max(40).nullable().optional(),
    grant: KoreanWonInput.max(80).nullable().optional(),
    actualPrice: KoreanWonInput.max(40).nullable().optional(),
    startDate: DateInput,
    endDate: DateInput,
    careCenter: z.boolean().nullable().optional(),
    voucherClient: z.boolean().optional(),
    birthday: ClientBirthdaySchema,
    dueDate: DateInput,
    birthDate: DateInput,
    serviceStatus: z.enum([...SERVICE_STATUS_VALUES] as [ServiceStatusType, ...ServiceStatusType[]]).nullable().optional(),
    breastPump: z.boolean().optional(),
    areaId: z.string().max(100).nullable().optional(),
});

const CreateClientSchema = ClientWriteFields.extend({
    phone: z.string().trim().min(1).max(40),
});
type CreateClientInput = z.infer<typeof CreateClientSchema>;
const CLIENT_MUTABLE_FIELD_KEYS = Object.keys(ClientWriteFields.shape);
const UpdateClientSchema = ClientWriteFields.partial().extend({
    id: z.number().int().positive(),
    targetVersion: z.string().min(1).optional(),
}).superRefine((value, context) => {
    if (!CLIENT_MUTABLE_FIELD_KEYS.some((key) => value[key as keyof typeof value] !== undefined)) {
        context.addIssue({ code: "custom", message: "At least one client field must be updated" });
    }
});
type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
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
const CLIENT_BRANCH_PHONE_UNIQUE_CONSTRAINT = "client_branch_phone_normalized_key";

function isClientBranchPhoneUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

    const target = error.meta?.["target"];
    if (target === CLIENT_BRANCH_PHONE_UNIQUE_CONSTRAINT) return true;
    if (!Array.isArray(target) || target.length !== 2) return false;

    const fields = target.map(String);
    const phoneField = fields.includes("phoneNormalized")
        || fields.includes("phone_normalized")
        || fields.includes("phone");
    return phoneField && (fields.includes("branchId") || fields.includes("branch_id"));
}

function clientPhoneConflictError(): AgentActionCertainFailureError {
    return new AgentActionCertainFailureError("A client with this phone already exists in this branch");
}

function assertAgentClientPhone(phone: string | null | undefined): void {
    try {
        assertClientPhoneInput(phone);
    } catch (error) {
        if (error instanceof BadRequestException) {
            throw new AgentActionCertainFailureError(error.message);
        }
        throw error;
    }
}

function sameClientValue(actual: unknown, expected: unknown): boolean {
    if (actual instanceof Date && typeof expected === "string") return actual.toISOString() === parseClientDate(expected)?.toISOString();
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function validationErrorMessage(error: BadRequestException | ConflictException): string {
    const response = error.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
        const responseObject = response as { message?: unknown; code?: unknown };
        const message = responseObject.message;
        if (Array.isArray(message)) return message.join(", ");
        if (typeof message === "string") return message;
        const code = responseObject.code;
        if (typeof code === "string") return code;
    }
    return error.message;
}

type ClientPricingUpdate = {
    voucherClient?: boolean;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
};

function hasPricingUpdate(updates: ClientPricingUpdate): boolean {
    return updates.voucherClient !== undefined
        || updates.type !== undefined
        || updates.duration !== undefined
        || updates.fullPrice !== undefined
        || updates.grant !== undefined
        || updates.actualPrice !== undefined;
}

function normalizeMergedClientPricing(
    existing: {
        voucherClient: boolean;
        type: string | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
    },
    updates: ClientPricingUpdate,
) {
    if (!hasPricingUpdate(updates)) return undefined;

    return normalizeClientPricing({
        voucherClient: updates.voucherClient ?? existing.voucherClient,
        type: updates.type === undefined ? existing.type : updates.type,
        fullPrice: updates.fullPrice === undefined ? existing.fullPrice : updates.fullPrice,
        grant: updates.grant === undefined ? existing.grant : updates.grant,
        actualPrice: updates.actualPrice === undefined ? existing.actualPrice : updates.actualPrice,
    });
}

async function validateClientServicePeriod(
    lifecycle: Pick<ServiceRecordLifecycleService, "validatePeriodChange">,
    params: {
        clientId: number;
        startDate?: Date | null;
        endDate?: Date | null;
        duration?: number | null;
    },
    transaction?: Prisma.TransactionClient,
): Promise<void> {
    try {
        await lifecycle.validatePeriodChange(params, transaction);
    } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) {
            throw new AgentActionCertainFailureError(validationErrorMessage(error));
        }
        throw error;
    }
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
        duration?: number | null;
    },
): Promise<number | null> {
    try {
        assertAllowedServiceStatus(updates.serviceStatus);
        await assertAllowedClientArea(prisma, branchId, updates.areaId);
        await assertPhoneAvailable(repository, branchId, updates.phone, existing?.id);
        const mergedServicePeriod = mergeAndValidateClientServicePeriod(existing, {
            startDate: updates.startDate,
            endDate: updates.endDate,
        });
        const derivedDuration = deriveClientDuration(
            mergedServicePeriod.startDate,
            mergedServicePeriod.endDate,
        );
        assertClientDurationMatchesDates(updates.duration, derivedDuration);
        const hasDateUpdate = existing !== null
            && (updates.startDate !== undefined || updates.endDate !== undefined);
        if (hasDateUpdate && derivedDuration !== null && updates.duration === null) {
            throw new BadRequestException(
                `duration must equal the Korean business-day count (${derivedDuration}) for the submitted service period`,
            );
        }
        if (hasDateUpdate && derivedDuration === null && updates.duration !== undefined && updates.duration !== null) {
            throw new BadRequestException("duration requires a complete service period");
        }
        return derivedDuration;
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
    private readonly logger = new Logger(ClientWriteAgentCapabilitiesProvider.name);

    constructor(
        private readonly createClient: CreateClientUsecase,
        private readonly updateClient: UpdateClientUsecase,
        private readonly findClient: FindClientByIdUsecase,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly prisma: PrismaService,
        private readonly serviceRecordLifecycleService: ServiceRecordLifecycleService,
        @Optional() private readonly voucherServiceSelection?: ResolveVoucherServiceSelectionUsecase,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly messageAutomationIntentService?: MessageAutomationIntentService,
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
                meta: {
                    ...common,
                    name: "clients.create",
                    description: "Create a client: ask only for missing facts, complete read-only lookups first, then invoke the write tool immediately once required facts are resolved. Never ask the user for conversational confirmation; the structured proposal card is the sole mandatory approval.",
                    flagKey: "agent.capability.clients.create",
                },
                inputSchema: CreateClientSchema,
                outputSchema: ClientWriteOutputSchema,
                formFields: CLIENT_FORM_FIELDS,
                canonicalizeInput: (_context, input: CreateClientInput) => {
                    assertAgentClientPhone(input.phone);
                    if (isVoucherServiceLabel(input.type)) {
                        if (input.voucherClient === false) {
                            return Promise.reject(new AgentActionCertainFailureError("voucherClient=false conflicts with a voucher type; remove the contradiction or provide a non-voucher type"));
                        }
                        if (!this.voucherServiceSelection) {
                            return Promise.reject(new AgentActionCertainFailureError("Voucher price lookup is unavailable; provide an exact non-voucher type or try again"));
                        }
                        return this.voucherServiceSelection.execute({
                            type: input.type,
                            startDate: input.startDate,
                            duration: input.duration,
                        }).then((selection) => ({
                            ...input,
                            voucherClient: true,
                            type: selection.type,
                            duration: selection.duration,
                            fullPrice: selection.fullPrice,
                            grant: selection.grant,
                            actualPrice: selection.actualPrice,
                        }));
                    }

                    const voucherClient = input.voucherClient ?? false;
                    return {
                        ...input,
                        voucherClient,
                        ...normalizeClientPricing({
                            voucherClient,
                            type: input.type ?? null,
                            fullPrice: input.fullPrice ?? null,
                            grant: input.grant ?? null,
                            actualPrice: input.actualPrice ?? null,
                        }),
                    };
                },
                execute: async (context, rawInput) => {
                    const input = CreateClientSchema.parse(rawInput);
                    assertAgentClientPhone(input.phone);
                    const dates = {
                        startDate: parseClientDate(input.startDate) ?? null,
                        endDate: parseClientDate(input.endDate) ?? null,
                    };
                    const derivedDuration = await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, null, {
                        ...dates,
                        areaId: input.areaId,
                        phone: input.phone,
                        serviceStatus: input.serviceStatus,
                        duration: input.duration,
                    });
                    const normalizedPricing = normalizeClientPricing({
                        voucherClient: input.voucherClient ?? false,
                        type: input.type ?? null,
                        fullPrice: input.fullPrice ?? null,
                        grant: input.grant ?? null,
                        actualPrice: input.actualPrice ?? null,
                    });
                    try {
                        return await this.prisma.$transaction(async (transaction) => {
                            const client = await this.createClient.execute(context.principal.branchId, {
                                name: input.name,
                                address: input.address ?? null,
                                phone: input.phone,
                                type: normalizedPricing.type,
                                duration: derivedDuration ?? input.duration ?? null,
                                fullPrice: normalizedPricing.fullPrice,
                                grant: normalizedPricing.grant,
                                actualPrice: normalizedPricing.actualPrice,
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
                            await this.serviceRecordLifecycleService.ensureForClient(client.id, transaction);
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
                canonicalizeInput: async (context, input: UpdateClientInput) => {
                    assertAgentClientPhone(input.phone);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const normalizedPricing = normalizeMergedClientPricing(existing, input);
                    return normalizedPricing
                        ? {
                            ...input,
                            voucherClient: input.voucherClient ?? existing.voucherClient,
                            ...normalizedPricing,
                        }
                        : input;
                },
                inspect: async (context, rawInput) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    assertAgentClientPhone(input.phone);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const updates = input;
                    const parsedUpdates = {
                        ...updates,
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                    };
                    const normalizedPricing = normalizeMergedClientPricing(existing, updates);
                    const derivedDuration = await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, {
                        ...parsedUpdates,
                        ...normalizedPricing,
                    });
                    await validateClientServicePeriod(this.serviceRecordLifecycleService, {
                        clientId: existing.id,
                        startDate: parsedUpdates.startDate,
                        endDate: parsedUpdates.endDate,
                        duration: derivedDuration ?? parsedUpdates.duration,
                    });
                    return {
                        targetVersion: clientAgentTargetVersion(existing),
                        targetSnapshot: clientAgentTargetSnapshot(existing),
                        summary: `${existing.name} 고객의 ${Object.keys(input).filter((key) => !["id", "targetVersion"].includes(key)).join(", ")} 항목을 변경합니다.`,
                    };
                },
                revalidate: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    assertAgentClientPhone(input.phone);
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
                    assertAgentClientPhone(input.phone);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const { id, targetVersion, ...updates } = input;
                    void targetVersion;
                    const parsedUpdates = {
                        ...updates,
                        ...normalizeMergedClientPricing(existing, updates),
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                        dueDate: parseClientDate(updates.dueDate),
                        birthDate: parseClientDate(updates.birthDate),
                    };
                    const derivedDuration = await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, parsedUpdates);
                    const duration = derivedDuration ?? parsedUpdates.duration;
                    await validateClientServicePeriod(this.serviceRecordLifecycleService, {
                        clientId: existing.id,
                        startDate: parsedUpdates.startDate,
                        endDate: parsedUpdates.endDate,
                        duration,
                    });
                    try {
                        const client = await this.updateClient.execute(context.principal.branchId, id, {
                            ...parsedUpdates,
                            ...(duration === undefined ? {} : { duration }),
                        });
                        await this.serviceRecordLifecycleService.ensureForClient(client.id);
                        await this.refreshEmployeeAssignmentJobsAfterProfileChange(
                            context.principal.branchId,
                            client.id,
                            input.name !== undefined,
                        );
                        return { id: client.id, name: client.name, status: "updated" };
                    } catch (error) {
                        if (isClientBranchPhoneUniqueViolation(error)) throw clientPhoneConflictError();
                        throw error;
                    }
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateClientSchema.parse(rawInput);
                    assertAgentClientPhone(input.phone);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) throw new AgentActionCertainFailureError("Client no longer exists");
                    const { id, targetVersion, ...updates } = input;
                    void targetVersion;
                    const parsedUpdates = {
                        ...updates,
                        ...normalizeMergedClientPricing(existing, updates),
                        startDate: parseClientDate(updates.startDate),
                        endDate: parseClientDate(updates.endDate),
                        dueDate: parseClientDate(updates.dueDate),
                        birthDate: parseClientDate(updates.birthDate),
                    };
                    const derivedDuration = await validateClientWrite(this.prisma, this.clientRepository, context.principal.branchId, existing, parsedUpdates);
                    const duration = derivedDuration ?? parsedUpdates.duration;
                    try {
                        const result = await this.prisma.$transaction(async (transaction) => {
                            await validateClientServicePeriod(this.serviceRecordLifecycleService, {
                                clientId: existing.id,
                                startDate: parsedUpdates.startDate,
                                endDate: parsedUpdates.endDate,
                                duration,
                            }, transaction);
                            const client = await this.updateClient.executeApprovedTarget(
                                context.principal.branchId,
                                id,
                                {
                                    ...parsedUpdates,
                                    ...(duration === undefined ? {} : { duration }),
                                },
                                expectedTargetVersion,
                                transaction,
                            );
                            await this.serviceRecordLifecycleService.ensureForClient(client.id, transaction);
                            const result = { id: client.id, name: client.name, status: "updated" };
                            await recordAgentActionEffect(transaction, context, "clients.update", "client", client.id, result);
                            return result;
                        });
                        await this.refreshEmployeeAssignmentJobsAfterProfileChange(
                            context.principal.branchId,
                            existing.id,
                            input.name !== undefined,
                        );
                        return result;
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
                    assertAgentClientPhone(input.phone);
                    const existing = await this.findClient.execute(context.principal.branchId, input.id);
                    if (!existing) return { status: "failed", reason: "Client no longer exists" };
                    const { id, targetVersion, ...updates } = input;
                    void id;
                    void targetVersion;
                    const desired = Object.entries({
                        ...updates,
                        ...normalizeMergedClientPricing(existing, updates),
                    }).filter(([, value]) => value !== undefined);
                    if (desired.every(([key, value]) => sameClientValue(existing[key as keyof typeof existing], value))) {
                        return { status: "succeeded", result: { id: existing.id, name: existing.name, status: "updated" } };
                    }
                    return { status: "uncertain", reason: "Client does not match the approved update" };
                },
            },
        ];
    }

    private async refreshEmployeeAssignmentJobsAfterProfileChange(
        branchId: string,
        clientId: number,
        nameSupplied: boolean,
    ): Promise<void> {
        if (!this.triggerService || !nameSupplied) return;

        try {
            const refreshed = await this.triggerService.syncEmployeeAssignmentRulesForClient(branchId, clientId);
            if (refreshed === false) {
                await this.persistEmployeeAssignmentRefreshIntents(branchId, clientId);
            }
        } catch (error) {
            this.logger.error(
                `Failed to sync employee assignment triggers for client ${clientId}: ${error}`,
            );
            await this.persistEmployeeAssignmentRefreshIntents(branchId, clientId);
        }
    }

    /**
     * Keep client-name assignment refreshes durable when the immediate rebuild
     * cannot complete. The intent writer owns branch/schedule deduplication;
     * this helper only selects active schedules in the caller's branch and
     * persists their existing schedule intents in one transaction.
     */
    private async persistEmployeeAssignmentRefreshIntents(
        branchId: string,
        clientId: number,
    ): Promise<void> {
        if (!this.messageAutomationIntentService) {
            this.logger.error(`Client assignment refresh retry service is unavailable for client ${clientId}`);
            return;
        }

        try {
            const activeSchedules = await this.prisma.employee_schedule.findMany({
                where: { branchId, clientId, replaced: false },
                select: { id: true },
                orderBy: { id: "asc" },
            });
            const scheduleIds = [...new Set(activeSchedules.map(({ id }) => id))]
                .sort((left, right) => left - right);
            if (scheduleIds.length === 0) return;

            const intentAt = new Date();
            await this.prisma.$transaction(async (transaction) => {
                for (const scheduleId of scheduleIds) {
                    await this.messageAutomationIntentService?.persistScheduleIntent(transaction, {
                        branchId,
                        clientId,
                        scheduleId,
                        includePast: true,
                        intentAt,
                        replaceExisting: true,
                    });
                }
            });
        } catch (error) {
            this.logger.error(
                `Failed to persist employee assignment refresh retries for client ${clientId}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
