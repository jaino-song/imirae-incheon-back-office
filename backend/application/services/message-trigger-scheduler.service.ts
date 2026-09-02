import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MessageTriggerService } from "./message-trigger.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const MAX_RUN_MS = 15 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class MessageTriggerSchedulerService {
    private readonly logger = new Logger(MessageTriggerSchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Scheduler] Previous due-job dispatch is still running; skipping tick",
        staleRunError: "[Scheduler] Previous due-job dispatch exceeded the max runtime",
        cooldownWarning: "[Scheduler] Database connectivity issue detected during due-job dispatch",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly triggerService: MessageTriggerService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("*/1 * * * *", { timeZone: "Asia/Seoul" })
    async dispatchDueJobs(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }

        const runToken = this.executionGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            await this.triggerService.dispatchDueJobs();
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                "[Scheduler] Failed to dispatch due trigger jobs",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
