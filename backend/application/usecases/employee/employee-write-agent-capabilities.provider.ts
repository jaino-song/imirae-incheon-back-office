import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ChangeEmployeeOpenStatusUsecase } from "./change-employee-open-status.usecase";
import { CreateEmployeeUsecase } from "./create-employee.usecase";
import { UpdateEmployeeUsecase } from "./update-employee.usecase";
import { FindEmployeeByIdUsecase } from "./find-employee-by-id.usecase";
import type { AgentFormField } from "@babyjamjam/shared";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import { PrismaService } from "infrastructure/database/prisma.service";

const CreateEmployeeSchema = z.object({
    name: z.string().trim().min(1).max(100),
    workArea: z.preprocess(
        (value) => typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value,
        z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    ),
    phone: z.string().trim().min(1).max(40),
    grade: z.string().trim().min(1).max(40),
    openToNextWork: z.boolean().default(false),
    birthday: z.string().max(20).optional(),
});
const UpdateEmployeeSchema = CreateEmployeeSchema.partial().extend({ id: z.number().int().positive() });
const AvailabilitySchema = z.object({ id: z.number().int().positive(), openToNextWork: z.boolean() });
const OutputSchema = z.object({ id: z.number().int().positive(), name: z.string(), status: z.string() });
const EMPLOYEE_CREATE_FIELDS: AgentFormField[] = [
    { name: "name", label: "직원 이름", type: "text", required: true },
    { name: "workArea", label: "활동 지역", type: "text", required: true },
    { name: "phone", label: "전화번호", type: "text", required: true },
    { name: "grade", label: "등급", type: "text", required: true },
    { name: "openToNextWork", label: "다음 업무 가능", type: "boolean" },
    { name: "birthday", label: "생년월일", type: "date" },
];
const EMPLOYEE_UPDATE_FIELDS: AgentFormField[] = [
    { name: "id", label: "직원 ID", type: "number", required: true },
    ...EMPLOYEE_CREATE_FIELDS.map((field) => ({ ...field, required: false })),
];
const EMPLOYEE_AVAILABILITY_FIELDS: AgentFormField[] = [
    { name: "id", label: "직원 ID", type: "number", required: true },
    { name: "openToNextWork", label: "다음 업무 가능", type: "boolean", required: true },
];

function employeeVersion(employee: Awaited<ReturnType<FindEmployeeByIdUsecase["execute"]>>): string {
    if (!employee) return "missing";
    return createHash("sha256").update(JSON.stringify({
        id: employee.id, name: employee.name, workArea: employee.workArea, phone: employee.phone,
        grade: employee.grade, openToNextWork: employee.openToNextWork, birthday: employee.birthday ?? null,
        deletedAt: employee.deletedAt?.toISOString() ?? null,
    })).digest("hex");
}

@Injectable()
@AgentCapabilityProvider()
export class EmployeeWriteAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createEmployee: CreateEmployeeUsecase,
        private readonly updateEmployee: UpdateEmployeeUsecase,
        private readonly changeAvailability: ChangeEmployeeOpenStatusUsecase,
        private readonly findEmployee: FindEmployeeByIdUsecase,
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
                    const employee = await this.createEmployee.execute(context.principal.branchId, input.name, input.workArea, input.phone, input.grade, input.openToNextWork, undefined, input.birthday);
                    const result = { id: employee.id, name: employee.name, status: "created" };
                    await recordAgentActionEffect(this.prisma, context, "employees.create", "employee", employee.id, result);
                    return result;
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
                    const { id, ...updates } = input;
                    const employee = await this.updateEmployee.execute(context.principal.branchId, id, updates);
                    return { id: employee.id, name: employee.name, status: "updated" };
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
                    const employee = await this.changeAvailability.execute(context.principal.branchId, input.id, input.openToNextWork);
                    return { id: employee.id, name: employee.name, status: input.openToNextWork ? "available" : "unavailable" };
                },
                reconcile: async (context, rawInput) => {
                    const input = AvailabilitySchema.parse(rawInput);
                    const employee = await this.findEmployee.execute(context.principal.branchId, input.id);
                    if (!employee) return { status: "failed", reason: "Employee no longer exists" };
                    return employee.openToNextWork === input.openToNextWork
                        ? { status: "succeeded", result: { id: employee.id, name: employee.name, status: input.openToNextWork ? "available" : "unavailable" } }
                        : { status: "uncertain", reason: "Employee availability does not match the approved value" };
                },
            },
        ];
    }

    private async inspectEmployee(branchId: string, id: number) {
        const employee = await this.findEmployee.execute(branchId, id);
        if (!employee) throw new Error("Employee no longer exists");
        return {
            targetVersion: employeeVersion(employee),
            targetSnapshot: { id: employee.id, name: employee.name, grade: employee.grade, openToNextWork: employee.openToNextWork },
        };
    }

    private async revalidateEmployee(branchId: string, id: number, expectedTargetVersion: string) {
        const employee = await this.findEmployee.execute(branchId, id);
        const currentVersion = employeeVersion(employee);
        return { valid: Boolean(employee) && currentVersion === expectedTargetVersion, currentVersion, reason: employee ? "Employee changed" : "Employee no longer exists" };
    }

    private async reconcileEmployeeUpdate(branchId: string, input: z.infer<typeof UpdateEmployeeSchema>, status: string) {
        const employee = await this.findEmployee.execute(branchId, input.id);
        if (!employee) return { status: "failed" as const, reason: "Employee no longer exists" };
        const desired = Object.entries(input).filter(([key, value]) => key !== "id" && value !== undefined);
        const matches = desired.every(([key, value]) => JSON.stringify(employee[key as keyof typeof employee]) === JSON.stringify(value));
        return matches
            ? { status: "succeeded" as const, result: { id: employee.id, name: employee.name, status } }
            : { status: "uncertain" as const, reason: "Employee does not match the approved update" };
    }
}
