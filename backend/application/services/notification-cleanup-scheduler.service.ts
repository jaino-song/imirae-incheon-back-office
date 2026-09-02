import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CleanupNotificationsUsecase } from "application/usecases/notification";
import {
    IBranchRepository,
    BRANCH_REPOSITORY,
} from "domain/repositories/branch.repository.interface";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const RETENTION_DAYS = 30;

@Injectable()
export class NotificationCleanupSchedulerService {
    private readonly logger = new Logger(NotificationCleanupSchedulerService.name);

    constructor(
        private readonly cleanupNotificationsUsecase: CleanupNotificationsUsecase,
        @Inject(BRANCH_REPOSITORY)
        private readonly branchRepository: IBranchRepository,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("0 2 * * *", { timeZone: "Asia/Seoul" })
    async cleanupOldNotifications(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }

        this.logger.log("[Notification Cleanup] Starting cleanup...");

        try {
            const branches = await this.branchRepository.findAllActive();

            if (branches.length === 0) {
                this.logger.log("[Notification Cleanup] No active branches found");
                return;
            }

            let deletedCount = 0;
            let processedCount = 0;
            for (const branch of branches) {
                if (!this.schedulerLease.holdsLease()) {
                    this.logger.warn(
                        `[Notification Cleanup] scheduler lease lost mid-run; stopping after ${processedCount} branches`,
                    );
                    break;
                }
                deletedCount += await this.cleanupNotificationsUsecase.execute(
                    branch.id,
                    RETENTION_DAYS,
                );
                processedCount += 1;
            }

            this.logger.log(
                `[Notification Cleanup] Deleted ${deletedCount} notifications older than ${RETENTION_DAYS} days across ${processedCount} branches`,
            );
        } catch (error) {
            this.logger.error("[Notification Cleanup] Failed to cleanup notifications", error);
        }
    }
}
