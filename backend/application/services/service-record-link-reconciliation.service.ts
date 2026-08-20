import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { normalizePhone } from "application/utils/normalize-phone";
import {
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";
import { PrismaService } from "infrastructure/database/prisma.service";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { ServiceRecordLinkService } from "./service-record-link.service";

const MAX_RUN_MS = 10 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KOREAN_MOBILE_PATTERN = /^01[016789]\d{7,8}$/;

@Injectable()
export class ServiceRecordLinkReconciliationService {
    private readonly logger = new Logger(ServiceRecordLinkReconciliationService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Service Record Link Repair] Previous run is still active; skipping tick",
        staleRunError: "[Service Record Link Repair] Previous run exceeded the max runtime",
        cooldownWarning: "[Service Record Link Repair] Database connectivity issue detected",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly prisma: PrismaService,
        private readonly linkService: ServiceRecordLinkService,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async repairMissingJobs(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            const repairedCount = await this.reconcileMissingJobs();
            if (repairedCount > 0) {
                this.logger.log(
                    `[Service Record Link Repair] Recreated ${repairedCount} missing message jobs`,
                );
            }
        } catch (error) {
            captureServiceRecordError(error, {
                operation: "link-schedule",
                handled: true,
            });
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }
            this.logger.error(
                "[Service Record Link Repair] Run failed",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }

    async reconcileMissingJobs(referenceDate = new Date()): Promise<number> {
        const kstDate = new Date(referenceDate.getTime() + KST_OFFSET_MS)
            .toISOString()
            .slice(0, 10);
        const today = new Date(`${kstDate}T00:00:00.000Z`);
        const approvedBranches = await this.prisma.branch.findMany({
            where: { smsSenderApprovalStatus: "approved" },
            select: { id: true },
        });
        const approvedBranchIds = approvedBranches.map((branch) => branch.id);
        if (approvedBranchIds.length === 0) return 0;

        let repairedCount = 0;
        let attemptedCount = 0;
        let cursor: string | undefined;
        while (attemptedCount < BATCH_SIZE) {
            const markers = await this.prisma.message_trigger_job.findMany({
                where: {
                    branchId: { in: approvedBranchIds },
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                    dedupeKey: { not: { contains: ":manual:" } },
                    canceledByUser: false,
                    OR: [
                        {
                            status: "failed",
                            cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                            nextAttemptAt: { lte: referenceDate },
                        },
                        {
                            status: "canceled",
                            cancelReason: {
                                in: [
                                    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
                                    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
                                ],
                            },
                        },
                    ],
                    employeeSchedule: {
                        is: {
                            branchId: { in: approvedBranchIds },
                            replaced: false,
                            startDate: { gte: today },
                            messageTriggerJobs: {
                                none: {
                                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                                    OR: [
                                        { status: { in: ["pending", "processing", "sent"] } },
                                        {
                                            status: "failed",
                                            OR: [
                                                { cancelReason: null },
                                                {
                                                    cancelReason: {
                                                        not: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                                                    },
                                                },
                                            ],
                                        },
                                        {
                                            status: "canceled",
                                            OR: [
                                                { canceledByUser: true },
                                                { cancelReason: null },
                                                {
                                                    cancelReason: {
                                                        notIn: [
                                                            SERVICE_RECORD_LINK_RESCHEDULED_REASON,
                                                            MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
                                                        ],
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
                select: {
                    id: true,
                    employeeSchedule: {
                        select: {
                            id: true,
                            primaryEmployee: {
                                select: { phone: true },
                            },
                        },
                    },
                },
                orderBy: [
                    { nextAttemptAt: "asc" },
                    { updatedAt: "asc" },
                    { id: "asc" },
                ],
                take: BATCH_SIZE,
                ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
            });
            if (markers.length === 0) break;
            cursor = markers[markers.length - 1]?.id;

            for (const marker of markers) {
                const schedule = marker.employeeSchedule;
                if (!schedule) continue;

                const phone = normalizePhone(schedule.primaryEmployee.phone);
                if (!phone || !KOREAN_MOBILE_PATTERN.test(phone)) {
                    continue;
                }

                attemptedCount += 1;
                try {
                    const repaired = await this.linkService.scheduleForServiceStart(schedule.id);
                    if (repaired) repairedCount += 1;
                } catch (error) {
                    if (isTransientPrismaConnectivityError(error)) {
                        throw error;
                    }
                    captureServiceRecordError(error, {
                        operation: "link-schedule",
                        handled: true,
                        scheduleId: schedule.id,
                    });
                    this.logger.warn(
                        `[Service Record Link Repair] Failed scheduleId=${schedule.id}; next cycle will retry`,
                    );
                }

                if (attemptedCount >= BATCH_SIZE) break;
            }

            if (markers.length < BATCH_SIZE) break;
        }

        return repairedCount;
    }
}
