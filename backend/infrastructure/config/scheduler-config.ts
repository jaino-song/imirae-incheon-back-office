import type { ScheduleModuleOptions } from "@nestjs/schedule";

interface SchedulerEnvironment {
    SCHEDULERS_ENABLED?: string;
}

export function resolveSchedulerModuleOptions(
    environment: SchedulerEnvironment,
): ScheduleModuleOptions {
    const enabled = environment.SCHEDULERS_ENABLED?.trim().toLowerCase() !== "false";

    return {
        cronJobs: enabled,
        intervals: enabled,
        timeouts: enabled,
    };
}
