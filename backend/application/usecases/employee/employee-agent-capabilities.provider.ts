import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { FindEmployeeByIdUsecase } from "./find-employee-by-id.usecase";
import { ListEmployeesUsecase } from "./list-employees.usecase";

const EmployeeSummarySchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    grade: z.string(),
    workArea: z.array(z.string()),
    openToNextWork: z.boolean(),
    status: z.enum(["available", "working", "unavailable"]).optional(),
});
const SearchInputSchema = z.object({ query: z.string().trim().min(1).max(100).optional() });
const SearchOutputSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none"), query: z.string() }),
    z.object({ kind: z.literal("entity"), entity: EmployeeSummarySchema }),
    z.object({
        kind: z.literal("choices"),
        prompt: z.string(),
        choices: z.array(EmployeeSummarySchema.pick({ id: true, name: true })).min(2),
    }),
]);
const GetInputSchema = z.object({ id: z.number().int().positive() });
const GetOutputSchema = z.object({ kind: z.literal("entity"), entity: EmployeeSummarySchema });

const toSummary = (employee: {
    id: number;
    name: string;
    grade: string;
    workArea: string[];
    openToNextWork: boolean;
    status?: "available" | "working" | "unavailable";
}) => ({
    id: employee.id,
    name: employee.name,
    grade: employee.grade,
    workArea: employee.workArea,
    openToNextWork: employee.openToNextWork,
    ...(employee.status ? { status: employee.status } : {}),
});

@Injectable()
@AgentCapabilityProvider()
export class EmployeeAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly listEmployees: ListEmployeesUsecase,
        private readonly findEmployee: FindEmployeeByIdUsecase,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "employees",
            version: "1.0.0",
            risk: "read" as const,
            requiredRoles: ["owner", "admin", "manager", "user"],
            sideEffect: false,
        };
        return [
            {
                meta: {
                    ...common,
                    name: "employees.search",
                    description: "Search employees in the current branch",
                    renderer: "entity-choice",
                    flagKey: "agent.capability.employees.search",
                },
                inputSchema: SearchInputSchema,
                outputSchema: SearchOutputSchema,
                execute: async (context, rawInput) => {
                    const input = SearchInputSchema.parse(rawInput);
                    const employees = await this.listEmployees.execute(context.principal.branchId);
                    const query = input.query?.toLocaleLowerCase();
                    const matches = employees
                        .filter((employee) => !query || employee.name.toLocaleLowerCase().includes(query) || employee.workArea.some((area) => area.toLocaleLowerCase().includes(query)))
                        .slice(0, 20)
                        .map(toSummary);

                    if (matches.length === 0) return { kind: "none" as const, query: input.query ?? "" };
                    if (matches.length === 1) return { kind: "entity" as const, entity: matches[0]! };
                    return {
                        kind: "choices" as const,
                        prompt: "어느 직원을 말씀하시는지 선택해 주세요.",
                        choices: matches.map(({ id, name }) => ({ id, name })),
                    };
                },
            },
            {
                meta: {
                    ...common,
                    name: "employees.get",
                    description: "Get an employee in the current branch",
                    renderer: "text",
                    flagKey: "agent.capability.employees.get",
                },
                inputSchema: GetInputSchema,
                outputSchema: GetOutputSchema,
                execute: async (context, rawInput) => {
                    const input = GetInputSchema.parse(rawInput);
                    const employee = await this.findEmployee.execute(context.principal.branchId, input.id);
                    if (!employee || employee.deletedAt) throw new Error("Employee not found");
                    return { kind: "entity" as const, entity: toSummary(employee) };
                },
            },
        ];
    }
}
