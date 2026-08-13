import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ChangeEmployeeOpenStatusUsecase } from "./change-employee-open-status.usecase";
import { CreateEmployeeUsecase } from "./create-employee.usecase";
import { EmployeeTargetVersionMismatchError, UpdateEmployeeUsecase } from "./update-employee.usecase";
import { FindEmployeeByIdUsecase } from "./find-employee-by-id.usecase";
import type { AgentFormField } from "@babyjamjam/shared";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";
import { EMPLOYEE_GRADES, normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";
import { normalizePhone } from "application/utils/normalize-phone";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

const EmployeeGradeSchema = z.preprocess(
    (value) => typeof value === "string" ? normalizeEmployeeGrade(value) : value,
    z.enum(EMPLOYEE_GRADES),
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

const EmployeeBirthdaySchema = z.string()
    .regex(/^\d{6}$/, "Birthday must be six numeric YYMMDD digits")
    .refine(isCalendarValidYymmdd, "Birthday must be a calendar-valid YYMMDD date")
    .optional();

const EMPLOYEE_BRANCH_PHONE_UNIQUE_CONSTRAINT = "employee_branch_id_phone_key";

function isEmployeeBranchPhoneUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

    const target = error.meta?.["target"];
    if (target === EMPLOYEE_BRANCH_PHONE_UNIQUE_CONSTRAINT) return true;
    if (!Array.isArray(target) || target.length !== 2) return false;

    const fields = target.map(String);
    return fields.includes("phone") && (fields.includes("branchId") || fields.includes("branch_id"));
}

function normalizeEmployeePhone(rawPhone: string): string {
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
        throw new AgentActionCertainFailureError("Employee phone number is invalid");
    }
    return normalized;
}

async function ensureEmployeePhoneAvailable(
    employeeRepository: IEmployeeRepository,
    branchId: string,
    normalizedPhone: string | undefined,
    currentEmployeeId?: number,
): Promise<void> {
    if (normalizedPhone === undefined) return;

    const existing = await employeeRepository.findByPhone(branchId, normalizedPhone);
    if (existing && existing.id !== currentEmployeeId) {
        throw new AgentActionCertainFailureError("An employee with this phone already exists in this branch");
    }
}

const CreateEmployeeSchema = z.object({
    name: z.string().trim().min(1).max(100),
    workArea: z.preprocess(
        (value) => typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value,
        z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    ),
    phone: z.string().trim().min(1).max(40),
    grade: EmployeeGradeSchema,
    openToNextWork: z.boolean().default(false),
    birthday: EmployeeBirthdaySchema,
});
const EMPLOYEE_MUTABLE_FIELD_KEYS = Object.keys(CreateEmployeeSchema.shape);
const UpdateEmployeeSchema = z.object({
    id: z.number().int().positive(),
    name: CreateEmployeeSchema.shape.name.optional(),
    workArea: CreateEmployeeSchema.shape.workArea.optional(),
    phone: CreateEmployeeSchema.shape.phone.optional(),
    grade: CreateEmployeeSchema.shape.grade.optional(),
    // CreateEmployeeSchema defaults this field for new employees. An update
    // must retain the distinction between an omitted field and false.
    openToNextWork: z.boolean().optional(),
    birthday: CreateEmployeeSchema.shape.birthday.optional(),
}).superRefine((value, context) => {
    if (!EMPLOYEE_MUTABLE_FIELD_KEYS.some((key) => value[key as keyof typeof value] !== undefined)) {
        context.addIssue({ code: "custom", message: "At least one employee field must be updated" });
    }
});
const AvailabilitySchema = z.object({ id: z.number().int().positive(), openToNextWork: z.boolean() });
const OutputSchema = z.object({ id: z.number().int().positive(), name: z.string(), status: z.string() });
const EMPLOYEE_CREATE_FIELDS: AgentFormField[] = [
    { name: "name", label: "직원 이름", type: "text", required: true },
    { name: "workArea", label: "활동 지역", type: "text", required: true },
    { name: "phone", label: "전화번호", type: "text", required: true },
    { name: "grade", label: "등급", type: "text", required: true },
    { name: "openToNextWork", label: "다음 업무 가능", type: "boolean" },
    { name: "birthday", label: "생년월일", type: "text", inputMode: "numeric", placeholder: "YYMMDD", maxLength: 6 },
];
const EMPLOYEE_UPDATE_FIELDS: AgentFormField[] = [
    { name: "id", label: "직원 ID", type: "number", required: true },
    ...EMPLOYEE_CREATE_FIELDS.map((field) => ({ ...field, required: false })),
];
const EMPLOYEE_AVAILABILITY_FIELDS: AgentFormField[] = [
    { name: "id", label: "직원 ID", type: "number", required: true },
    { name: "openToNextWork", label: "다음 업무 가능", type: "boolean", required: true },
];

function isActiveEmployee(employee: Awaited<ReturnType<FindEmployeeByIdUsecase["execute"]>>): employee is NonNullable<typeof employee> {
    return Boolean(employee && !employee.deletedAt);
}

@Injectable()
@AgentCapabilityProvider()
export class EmployeeWriteAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createEmployee: CreateEmployeeUsecase,
        private readonly updateEmployee: UpdateEmployeeUsecase,
        private readonly changeAvailability: ChangeEmployeeOpenStatusUsecase,
        private readonly findEmployee: FindEmployeeByIdUsecase,
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
        private readonly prisma: PrismaService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "employees", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"],
            risk: "reversible-write" as const, sideEffect: true, renderer: "action-proposal" as const,
            approvalPolicy: "structured" as const, idempotencyPolicy: "action-id" as const,
        };
        return [
            {
                meta: { ...common, name: "employees.create", description: "Create an employee after explicit approval", flagKey: "agent.capability.employees.create" },
                inputSchema: CreateEmployeeSchema, outputSchema: OutputSchema,
                formFields: EMPLOYEE_CREATE_FIELDS,
                execute: async (context, rawInput) => {
                    const input = CreateEmployeeSchema.parse(rawInput);
                    const normalizedPhone = normalizeEmployeePhone(input.phone);
                    try {
                        await ensureEmployeePhoneAvailable(this.employeeRepository, context.principal.branchId, normalizedPhone);
                        return await this.prisma.$transaction(async (transaction) => {
                            const employee = await this.createEmployee.execute(context.principal.branchId, input.name, input.workArea, normalizedPhone, input.grade, input.openToNextWork, undefined, input.birthday, transaction);
                            const result = { id: employee.id, name: employee.name, status: "created" };
                            await recordAgentActionEffect(transaction, context, "employees.create", "employee", employee.id, result);
                            return result;
                        });
                    } catch (error) {
                        if (isEmployeeBranchPhoneUniqueViolation(error)) {
                            throw new AgentActionCertainFailureError("An employee with this phone already exists in this branch");
                        }
                        throw error;
                    }
                },
                reconcile: async (context) => {
                    const receipt = await readAgentActionEffect(this.prisma, context, "employees.create");
                    const result = receipt?.resourceType === "employee" ? OutputSchema.safeParse(receipt.result) : null;
                    return result?.success
                        ? { status: "succeeded", result: result.data }
                        : { status: "uncertain", reason: "No action-bound employee creation receipt was found" };
                },
            },
            {
                meta: { ...common, name: "employees.update", description: "Update an employee after explicit approval", flagKey: "agent.capability.employees.update" },
                inputSchema: UpdateEmployeeSchema, outputSchema: OutputSchema,
                formFields: EMPLOYEE_UPDATE_FIELDS,
                inspect: async (context, rawInput) => this.inspectEmployee(context.principal.branchId, UpdateEmployeeSchema.parse(rawInput).id),
                revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateEmployee(context.principal.branchId, UpdateEmployeeSchema.parse(rawInput).id, expectedTargetVersion),
                execute: async (context, rawInput) => {
                    const input = UpdateEmployeeSchema.parse(rawInput);
                    const normalizedPhone = input.phone === undefined ? undefined : normalizeEmployeePhone(input.phone);
                    await this.requireActiveEmployee(context.principal.branchId, input.id);
                    const { id, ...updates } = input;
                    try {
                        await ensureEmployeePhoneAvailable(this.employeeRepository, context.principal.branchId, normalizedPhone, id);
                        const employee = await this.updateEmployee.execute(
                            context.principal.branchId,
                            id,
                            normalizedPhone === undefined ? updates : { ...updates, phone: normalizedPhone },
                        );
                        return { id: employee.id, name: employee.name, status: "updated" };
                    } catch (error) {
                        if (isEmployeeBranchPhoneUniqueViolation(error)) {
                            throw new AgentActionCertainFailureError("An employee with this phone already exists in this branch");
                        }
                        throw error;
                    }
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateEmployeeSchema.parse(rawInput);
                    const normalizedPhone = input.phone === undefined ? undefined : normalizeEmployeePhone(input.phone);
                    const { id, ...updates } = input;
                    try {
                        await ensureEmployeePhoneAvailable(this.employeeRepository, context.principal.branchId, normalizedPhone, id);
                        const employee = await this.updateEmployee.executeApprovedTarget(
                            context.principal.branchId,
                            id,
                            normalizedPhone === undefined ? updates : { ...updates, phone: normalizedPhone },
                            expectedTargetVersion,
                        );
                        return { id: employee.id, name: employee.name, status: "updated" };
                    } catch (error) {
                        if (error instanceof EmployeeTargetVersionMismatchError) {
                            throw new AgentActionCertainFailureError(error.message);
                        }
                        if (isEmployeeBranchPhoneUniqueViolation(error)) {
                            throw new AgentActionCertainFailureError("An employee with this phone already exists in this branch");
                        }
                        throw error;
                    }
                },
                reconcile: async (context, rawInput) => this.reconcileEmployeeUpdate(context.principal.branchId, UpdateEmployeeSchema.parse(rawInput), "updated"),
            },
            {
                meta: { ...common, name: "employees.changeAvailability", description: "Change employee availability after explicit approval", flagKey: "agent.capability.employees.changeAvailability" },
                inputSchema: AvailabilitySchema, outputSchema: OutputSchema,
                formFields: EMPLOYEE_AVAILABILITY_FIELDS,
                inspect: async (context, rawInput) => this.inspectEmployee(context.principal.branchId, AvailabilitySchema.parse(rawInput).id),
                revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateEmployee(context.principal.branchId, AvailabilitySchema.parse(rawInput).id, expectedTargetVersion),
                execute: async (context, rawInput) => {
                    const input = AvailabilitySchema.parse(rawInput);
                    await this.requireActiveEmployee(context.principal.branchId, input.id);
                    const employee = await this.changeAvailability.execute(context.principal.branchId, input.id, input.openToNextWork);
                    return { id: employee.id, name: employee.name, status: input.openToNextWork ? "available" : "unavailable" };
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = AvailabilitySchema.parse(rawInput);
                    try {
                        const employee = await this.changeAvailability.executeApprovedTarget(
                            context.principal.branchId,
                            input.id,
                            input.openToNextWork,
                            expectedTargetVersion,
                        );
                        return { id: employee.id, name: employee.name, status: input.openToNextWork ? "available" : "unavailable" };
                    } catch (error) {
                        if (error instanceof EmployeeTargetVersionMismatchError) {
                            throw new AgentActionCertainFailureError(error.message);
                        }
                        throw error;
                    }
                },
                reconcile: async (context, rawInput) => {
                    const input = AvailabilitySchema.parse(rawInput);
                    const employee = await this.findEmployee.execute(context.principal.branchId, input.id);
                    if (!isActiveEmployee(employee)) return { status: "failed", reason: "Employee no longer exists or was deleted" };
                    return employee.openToNextWork === input.openToNextWork
                        ? { status: "succeeded", result: { id: employee.id, name: employee.name, status: input.openToNextWork ? "available" : "unavailable" } }
                        : { status: "uncertain", reason: "Employee availability does not match the approved value" };
                },
            },
        ];
    }

    private async inspectEmployee(branchId: string, id: number) {
        const employee = await this.requireActiveEmployee(branchId, id);
        return {
            targetVersion: employeeAgentTargetVersion(employee),
            targetSnapshot: { id: employee.id, name: employee.name, grade: employee.grade, openToNextWork: employee.openToNextWork },
        };
    }

    private async revalidateEmployee(branchId: string, id: number, expectedTargetVersion: string) {
        const employee = await this.findEmployee.execute(branchId, id);
        const currentVersion = employeeAgentTargetVersion(employee);
        return { valid: isActiveEmployee(employee) && currentVersion === expectedTargetVersion, currentVersion, reason: isActiveEmployee(employee) ? "Employee changed" : "Employee no longer exists or was deleted" };
    }

    private async reconcileEmployeeUpdate(branchId: string, input: z.infer<typeof UpdateEmployeeSchema>, status: string) {
        const employee = await this.findEmployee.execute(branchId, input.id);
        if (!isActiveEmployee(employee)) return { status: "failed" as const, reason: "Employee no longer exists or was deleted" };
        const normalizedPhone = input.phone === undefined ? undefined : normalizePhone(input.phone);
        if (input.phone !== undefined && !normalizedPhone) {
            return { status: "uncertain" as const, reason: "Employee phone number is invalid" };
        }
        const desired = Object.entries(input)
            .filter(([key, value]) => key !== "id" && value !== undefined)
            .map(([key, value]) => [key, key === "phone" ? normalizedPhone : value] as const);
        const matches = desired.every(([key, value]) => JSON.stringify(employee[key as keyof typeof employee]) === JSON.stringify(value));
        return matches
            ? { status: "succeeded" as const, result: { id: employee.id, name: employee.name, status } }
            : { status: "uncertain" as const, reason: "Employee does not match the approved update" };
    }

    private async requireActiveEmployee(branchId: string, id: number) {
        const employee = await this.findEmployee.execute(branchId, id);
        if (!isActiveEmployee(employee)) {
            throw new AgentActionCertainFailureError("Employee no longer exists or was deleted");
        }
        return employee;
    }
}
