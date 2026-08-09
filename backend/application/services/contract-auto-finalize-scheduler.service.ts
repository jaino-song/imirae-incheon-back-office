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
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { NotificationService } from "application/services/notification.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import {
    CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS,
    evaluateAutoFinalize,
    isValidIsoDate,
} from "./contract-auto-finalize.policy";

export const CONTRACT_AUTO_FINALIZE_FAILED_NOTIFICATION_TYPE = "contract-auto-finalize-failed";

// Each finalize drives a headless browser through eformsign's editor — worst
// case ~100s per document — and documents run strictly serially, so the run
// budget is sized for a handful of same-day contracts, not for throughput.
const MAX_RUN_MS = 30 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Nightly auto-finalize for maternity contracts stuck at the provider-review
 * stage (070): the first KST midnight after a contract's stored end date, the
 * staff "검토 완료 확인" wizard runs headlessly with that end date prefilled.
 * Retries up to 3 attempts total; exhaustion notifies the branch and leaves the
 * document for manual handling (surfaced on the dashboard card).
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
        private readonly finalizeUsecase: FinalizeDocumentHeadlessUsecase,
        private readonly notificationService: NotificationService,
    ) {}

    @Cron("0 0 * * *", { timeZone: "Asia/Seoul" })
    async autoFinalizeDueContracts(): Promise<void> {
        if (this.configService.get<string>("CONTRACT_AUTO_FINALIZE_ENABLED") !== "true") {
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

        const due: ReviewStageContract[] = [];
        for (const contract of contracts) {
            const verdict = evaluateAutoFinalize(contract, { sinceDate, todayKst });
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

        // Strictly serial: each finalize occupies a headless browser slot for up
        // to ~100s, and a failure on one document must not stop the rest.
        for (const contract of due) {
            await this.finalizeContract(contract);
        }
    }

    private async finalizeContract(contract: ReviewStageContract): Promise<void> {
        const { documentId } = contract;
        try {
            const result = await this.finalizeUsecase.execute({
                documentId,
                prefillEndDate: contract.contractEndDate ?? undefined,
            });
            if (result.ok) {
                this.logger.log(
                    `[Contract Auto Finalize] Finalized ${documentId} (end date ${contract.contractEndDate}) in ${result.durationMs}ms`,
                );
                return;
            }
            await this.recordFailure(contract, result.reason);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            await this.recordFailure(contract, reason);
        }
    }

    private async recordFailure(contract: ReviewStageContract, reason: string): Promise<void> {
        const { documentId } = contract;
        let attempts: number;
        try {
            attempts = await this.eformsignDocRepository.recordAutoFinalizeFailure(documentId, reason);
        } catch (error) {
            // Losing the counter must not lose the failure itself.
            this.logger.error(
                `[Contract Auto Finalize] ${documentId} failed ("${reason}") and the attempt could not be recorded`,
                error instanceof Error ? error.stack : String(error),
            );
            return;
        }

        this.logger.warn(
            `[Contract Auto Finalize] ${documentId} failed attempt ${attempts}/${CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS}: ${reason}`,
        );
        if (attempts >= CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS) {
            await this.notifyExhausted(contract, reason);
        }
    }

    private async notifyExhausted(contract: ReviewStageContract, reason: string): Promise<void> {
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
                `${customerLabel}님의 계약서 자동 검토 완료가 ${CONTRACT_AUTO_FINALIZE_MAX_ATTEMPTS}회 모두 실패했어요. 수동 확인이 필요합니다. (${reason})`,
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
}
