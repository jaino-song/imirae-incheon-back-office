import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
    ReviewStageContract,
} from "domain/repositories/eformsign-doc.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { NotificationService } from "application/services/notification.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import {
    CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS,
    evaluateAutoFinalize,
    isValidIsoDate,
} from "./contract-auto-finalize.policy";

export const CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE = "contract-auto-finalize-failed";
export const CONTRACT_AUTO_FINALIZE_CRON = "0 17 * * *";
export const CONTRACT_AUTO_FINALIZE_TIME_ZONE = "Asia/Seoul";

// Queue production is fast and documents run strictly serially, so the run
// budget still leaves room for a large same-day backlog without overlapping ticks.
const MAX_RUN_MS = 30 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Daily producer for maternity contracts stuck at the provider-review stage
 * (070): at 17:00 KST on the contract's stored end date, enqueue the worker's
 * "검토 완료 확인" job with that end date prefilled. Missed runs catch up on a
 * later day. The existing document attempt counter remains the terminal
 * provider-failure budget; queue
 * retries and queue infrastructure failures do not consume it.
 */
@Injectable()
export class ContractAutoFinalizeSchedulerService {
    private readonly logger = new Logger(ContractAutoFinalizeSchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Contract Auto Finalize] Previous run is still active; skipping tick",
        staleRunError: "[Contract Auto Finalize] Previous run exceeded the max runtime",
        cooldownWarning: "[Contract Auto Finalize] Database connectivity issue detected",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly configService: ConfigService,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly documentJobService: EformsignDocumentJobService,
        private readonly notificationService: NotificationService,
        private readonly systemSettingService?: SystemSettingService,
    ) {}

    @Cron(CONTRACT_AUTO_FINALIZE_CRON, { timeZone: CONTRACT_AUTO_FINALIZE_TIME_ZONE })
    async autoFinalizeDueContracts(): Promise<void> {
        if (this.configService.get<string>("CONTRACT_AUTO_FINALIZE_ENABLED") !== "true") {
            return;
        }
        if (
            this.configService
                .get<string>("EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED")
                ?.trim()
                .toLowerCase() !== "true"
        ) {
            return;
        }
        const sinceDate = this.configService.get<string>("CONTRACT_AUTO_FINALIZE_SINCE");
        if (!isValidIsoDate(sinceDate)) {
            // The activation date is the backlog fence. Running without it would
            // finalize every contract that ended before the feature existed.
            this.logger.error(
                "[Contract Auto Finalize] CONTRACT_AUTO_FINALIZE_SINCE is missing or not YYYY-MM-DD; refusing to run",
            );
            return;
        }
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            await this.processDueContracts(sinceDate);
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }
            this.logger.error(
                "[Contract Auto Finalize] Run failed",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }

    private async processDueContracts(sinceDate: string): Promise<void> {
        const todayKst = isoDateInKorea();
        const contracts = await this.eformsignDocRepository.findReviewStageContracts();
        const branchIds = [...new Set(contracts.map((contract) => contract.branchId).filter((id): id is string => Boolean(id)))];
        const configs = new Map(await Promise.all(branchIds.map(async (branchId) => [
            branchId,
            this.systemSettingService
                ? await this.systemSettingService.getContractAutoFinalizeConfig(branchId)
                : { enabled: true, graceDays: 0, maxAttempts: CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS },
        ] as const)));

        const due: ReviewStageContract[] = [];
        for (const contract of contracts) {
            const config = contract.branchId ? configs.get(contract.branchId) : undefined;
            if (config?.enabled === false) {
                this.logger.debug(`[Contract Auto Finalize] Skipping ${contract.documentId}: branch auto-finalize disabled`);
                continue;
            }
            const verdict = evaluateAutoFinalize(contract, {
                sinceDate,
                todayKst,
                graceDays: config?.graceDays,
                maxAttempts: config?.maxAttempts,
            });
            if (verdict.eligible) {
                due.push(contract);
            } else if (verdict.reason === "no-end-date") {
                this.logger.warn(
                    `[Contract Auto Finalize] ${contract.documentId} has no recoverable contract end date; leaving for manual handling`,
                );
            }
        }
        if (due.length === 0) return;

        this.logger.log(
            `[Contract Auto Finalize] ${due.length} contract(s) due (today ${todayKst}, since ${sinceDate})`,
        );

        // Strictly serial: a queue failure on one document must not stop the rest.
        for (const contract of due) {
            await this.enqueueFinalization(contract, todayKst);
        }
    }

    private async enqueueFinalization(
        contract: ReviewStageContract,
        todayKst: string,
    ): Promise<void> {
        const { documentId, branchId } = contract;
        if (!branchId) {
            this.logger.warn(
                `[Contract Auto Finalize] ${documentId} is eligible but has no authoritative branch; refusing to enqueue`,
            );
            return;
        }

        const requestKey = `auto_finalize:${documentId}:${todayKst}`;
        try {
            await this.documentJobService.enqueueFinalizeDocument({
                branchId,
                requestKey,
                documentId,
                prefillEndDate: contract.contractEndDate ?? undefined,
                source: "auto_finalize",
                createdByUserId: null,
            });
            this.logger.log(
                `[Contract Auto Finalize] Enqueued ${documentId} (end date ${contract.contractEndDate}, request ${requestKey})`,
            );
        } catch (error) {
            // Queue infrastructure failure is not a provider terminal outcome:
            // leave the document's attempt budget untouched for the next tick.
            this.logger.error(
                `[Contract Auto Finalize] Failed to enqueue ${documentId}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async notifyExhausted(
        contract: ReviewStageContract,
        reason: string,
        maxAttempts = CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS,
    ): Promise<void> {
        const { documentId, branchId } = contract;
        if (!branchId) {
            this.logger.warn(
                `[Contract Auto Finalize] ${documentId} exhausted its retries but has no branch; cannot notify`,
            );
            return;
        }
        const customerLabel = contract.customerName ?? "고객 미확인";
        try {
            await this.notificationService.sendToBranchUsers(
                branchId,
                "계약서 자동 완료 실패",
                `${customerLabel}님의 계약서 자동 검토 완료가 ${maxAttempts}회 모두 실패했어요. 수동 확인이 필요합니다. (${reason})`,
                {
                    type: CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE,
                    documentId,
                    url: `/contracts?documentId=${encodeURIComponent(documentId)}`,
                },
                { dedupe: { type: CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE, documentId } },
            );
        } catch (error) {
            this.logger.error(
                `[Contract Auto Finalize] Failed to notify branch ${branchId} about ${documentId}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    async recordTerminalFailure(
        documentId: string,
        reason: string,
        attempts: number | null,
    ): Promise<void> {
        if (attempts === null) return;
        const contract = (await this.eformsignDocRepository.findReviewStageContracts())
            .find((candidate) => candidate.documentId === documentId);
        if (!contract) {
            this.logger.warn(
                `[Contract Auto Finalize] ${documentId} exhausted its retries but is no longer in review stage`,
            );
            return;
        }
        const config = contract.branchId && this.systemSettingService
            ? await this.systemSettingService.getContractAutoFinalizeConfig(contract.branchId)
            : undefined;
        const maxAttempts = config?.maxAttempts ?? CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS;
        if (attempts < maxAttempts) return;
        await this.notifyExhausted(contract, reason, maxAttempts);
    }
}
