import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListEmployeeSchedulesUsecase } from "./list-employee-schedules.usecase";

const ScheduleSchema = z.object({ id: z.number().int().positive(), clientId: z.number().int().positive(), primaryEmployeeId: z.number().int().positive(), secondaryEmployeeId: z.number().int().positive().nullable(), startDate: z.string(), endDate: z.string(), replaced: z.boolean() });
const InputSchema = z.object({ date: z.string().date().optional() });
const OutputSchema = z.object({ schedules: z.array(ScheduleSchema) });

@Injectable()
@AgentCapabilityProvider()
export class EmployeeScheduleAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listSchedules: ListEmployeeSchedulesUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "schedules.list", domain: "schedules", version: "1.0.0", description: "List schedules in the current branch", risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.schedules.list", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                const { date } = InputSchema.parse(rawInput);
                const schedules = await this.listSchedules.execute(context.principal.branchId);
                return { schedules: schedules.filter((schedule) => !date || schedule.startDate.toISOString().startsWith(date)).slice(0, 50).map((schedule) => ({ id: schedule.id, clientId: schedule.clientId, primaryEmployeeId: schedule.primaryEmployeeId, secondaryEmployeeId: schedule.secondaryEmployeeId, startDate: schedule.startDate.toISOString(), endDate: schedule.endDate.toISOString(), replaced: schedule.replaced })) };
            },
        }];
    }
}
