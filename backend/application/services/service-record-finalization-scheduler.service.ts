import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { ServiceRecordFinalizationService } from "./service-record-finalization.service";

const MAX_RUN_MS = 10 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class ServiceRecordFinalizationSchedulerService {
    private readonly logger = new Logger(ServiceRecordFinalizationSchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Service Record Finalization] Previous run is still active; skipping tick",
        staleRunError: "[Service Record Finalization] Previous run exceeded the max runtime",
        cooldownWarning: "[Service Record Finalization] Database connectivity issue detected",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly configService: ConfigService,
        private readonly finalizationService: ServiceRecordFinalizationService,
    ) {}

    @Cron("* * * * *", { timeZone: "Asia/Seoul" })
    async finalizeDueServiceRecords(): Promise<void> {
        if (this.configService.get<string>("SERVICE_RECORD_AUTO_FINALIZE_ENABLED") !== "true") {
            return;
        }
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            const count = await this.finalizationService.processDueCases();
            if (count > 0) {
                this.logger.log(`[Service Record Finalization] Finalized ${count} service records`);
            }
        } catch (error) {
            captureServiceRecordError(error, {
                operation: "auto-finalize",
                handled: true,
            });
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }
            this.logger.error(
                "[Service Record Finalization] Run failed",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
