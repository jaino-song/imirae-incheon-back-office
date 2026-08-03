import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { FindEmployeeByIdUsecase } from "./find-employee-by-id.usecase";
import { ListEmployeesUsecase } from "./list-employees.usecase";

const EmployeeSchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    grade: z.string(),
    workArea: z.array(z.string()),
    openToNextWork: z.boolean(),
    status: z.enum(["available", "working", "unavailable"]).optional(),
});
const SearchSchema = z.object({ query: z.string().trim().min(1).max(100).optional() });
const OutputSchema = z.object({ employees: z.array(EmployeeSchema) });
const GetSchema = z.object({ id: z.number().int().positive() });

function safeEmployee(employee: {
    id: number; name: string; grade: string; workArea: string[]; openToNextWork: boolean; status?: "available" | "working" | "unavailable";
}) {
    return { id: employee.id, name: employee.name, grade: employee.grade, workArea: employee.workArea, openToNextWork: employee.openToNextWork, ...(employee.status ? { status: employee.status } : {}) };
}

@Injectable()
@AgentCapabilityProvider()
export class EmployeeAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listEmployees: ListEmployeesUsecase, private readonly findEmployee: FindEmployeeByIdUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "employees", version: "1.0.0", risk: "read" as const,
            requiredRoles: ["owner", "admin", "manager", "user"], sideEffect: false,
        };
        return [
            {
                meta: { ...common, name: "employees.search", description: "Search employees in the current branch", renderer: "entity-choice", flagKey: "agent.capability.employees.search" },
                inputSchema: SearchSchema, outputSchema: OutputSchema,
                execute: async (context, rawInput) => {
                    const input = SearchSchema.parse(rawInput);
                    const employees = await this.listEmployees.execute(context.principal.branchId);
                    const query = input.query?.toLocaleLowerCase();
                    return { employees: employees.filter((employee) => !query || employee.name.toLocaleLowerCase().includes(query) || employee.workArea.some((area) => area.toLocaleLowerCase().includes(query))).slice(0, 20).map(safeEmployee) };
                },
            },
            {
                meta: { ...common, name: "employees.get", description: "Get an employee in the current branch", renderer: "text", flagKey: "agent.capability.employees.get" },
                inputSchema: GetSchema, outputSchema: EmployeeSchema,
                execute: async (context, rawInput) => {
                    const employee = await this.findEmployee.execute(context.principal.branchId, GetSchema.parse(rawInput).id);
                    if (!employee) throw new Error("Employee not found");
                    return safeEmployee(employee);
                },
            },
        ];
    }
}
