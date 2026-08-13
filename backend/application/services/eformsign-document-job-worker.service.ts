import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";

import type { ContractDataDto } from "application/dto/contract.dto";
import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import {
    DispatchDocumentHeadlessUsecase,
    DispatchHeadlessResult,
} from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import {
    FinalizeDocumentHeadlessUsecase,
    FinalizeHeadlessResult,
} from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import {
    EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";

const WORKER_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_CUTOFF_MS = HEARTBEAT_INTERVAL_MS;
const PRE_SEND_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const MAX_PRE_SEND_RETRIES = PRE_SEND_RETRY_DELAYS_MS.length;
const MAX_CONSECUTIVE_FINALIZE_STEPS = 3;
const WORKER_ENABLED_ENV = "EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED";

interface CreateDocumentJobPayload {
    clientId: number;
    contractData: ContractDataDto;
    progressId?: string;
    force?: boolean;
}

interface FinalizeDocumentJobPayload {
    documentId?: string;
    prefillEndDate?: string;
    progressId?: string;
}

/**
 * Polls durable eformsign jobs and runs one claimed provider operation at a
 * time. The repository owns the global three-job claim boundary; this service
 * owns retry safety and heartbeat/progress updates.
 */
@Injectable()
export class EformsignDocumentJobWorkerService {
    private readonly logger = new Logger(EformsignDocumentJobWorkerService.name);
    private running = false;

    constructor(
        private readonly configService: ConfigService,
        @Inject(EFORMSIGN_DOCUMENT_JOB_REPOSITORY)
        private readonly repository: IEformsignDocumentJobRepository,
        private readonly dispatchUsecase: DispatchDocumentHeadlessUsecase,
        private readonly finalizeUsecase: FinalizeDocumentHeadlessUsecase,
        private readonly reconciliationService: EformsignDocumentJobReconciliationService,
    ) {}

    @Interval(WORKER_INTERVAL_MS)
    async processDueJobs(): Promise<void> {
        if (!this.isEnabled() || this.running) return;
        this.running = true;
        try {
            const stale = await this.repository.recoverStale(
                new Date(Date.now() - STALE_CUTOFF_MS),
            );
            for (const job of stale) {
                if (job.status === "reconciling") {
                    await this.reconcile(job);
                }
            }

            const jobs = await this.repository.claimDue(3);
            for (const job of jobs) {
                await this.processClaimedJob(job);
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Eformsign document job worker tick failed: ${reason}`);
        } finally {
            this.running = false;
        }
    }

    private async processClaimedJob(job: EformsignDocumentJobEntity): Promise<void> {
        if (!job.payload) {
            await this.repository.markRequiresAttention(job.id, "MISSING_JOB_PAYLOAD");
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        const heartbeat = this.startHeartbeat(job.id, () => latestProgressStep);
        try {
            if (job.jobType === "create_document") {
                await this.processCreation(job, (step) => {
                    latestProgressStep = step;
                });
            } else if (job.jobType === "finalize_document") {
                await this.processFinalization(job, (step) => {
                    latestProgressStep = step;
                });
            } else {
                await this.repository.markFailed(job.id, "UNSUPPORTED_JOB_TYPE");
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Eformsign document job ${job.id} failed: ${reason}`);
            await this.handleExecutionFailure(job, latestProgressStep);
        } finally {
            clearInterval(heartbeat);
        }
    }

    private async processCreation(
        job: EformsignDocumentJobEntity,
        onProgressStep?: (step: EformsignHeadlessProgressStep) => void,
    ): Promise<void> {
        const payload = parseCreatePayload(job.payload ?? {});
        if (!payload) {
            await this.repository.markRequiresAttention(job.id, "INVALID_CREATE_JOB_PAYLOAD");
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        const result = await this.dispatchUsecase.execute(job.branchId, {
            contractData: payload.contractData,
            clientId: payload.clientId,
            progressId: payload.progressId,
            force: payload.force,
            onProgress: (step) => {
                latestProgressStep = step;
                onProgressStep?.(step);
                void this.recordProgress(job.id, step);
            },
        });

        if (result.ok) {
            await this.repository.markCompleted(job.id, result.documentId);
            return;
        }
        if (this.isAmbiguous(result, latestProgressStep)) {
            await this.markAndReconcile(job, latestProgressStep);
            return;
        }
        await this.handlePreSendFailure(job, "HEADLESS_CREATE_PRE_SEND_FAILURE");
    }

    private async processFinalization(
        job: EformsignDocumentJobEntity,
        onProgressStep?: (step: EformsignHeadlessProgressStep) => void,
    ): Promise<void> {
        const payload = parseFinalizePayload(job.payload ?? {});
        const documentId = job.documentId ?? payload?.documentId;
        if (!payload || !documentId) {
            await this.repository.markRequiresAttention(job.id, "INVALID_FINALIZE_JOB_PAYLOAD");
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        for (let step = 0; step < MAX_CONSECUTIVE_FINALIZE_STEPS; step += 1) {
            const result = await this.finalizeUsecase.execute({
                documentId,
                prefillEndDate: payload.prefillEndDate,
                progressId: payload.progressId,
                onProgress: (progressStep) => {
                    latestProgressStep = progressStep;
                    onProgressStep?.(progressStep);
                    void this.recordProgress(job.id, progressStep);
                },
            });

            if (!result.ok) {
                if (this.isAmbiguous(result, latestProgressStep)) {
                    await this.markAndReconcile(job, latestProgressStep);
                    return;
                }
                await this.handlePreSendFailure(job, "HEADLESS_FINALIZE_PRE_SEND_FAILURE");
                return;
            }
            if (result.completed) {
                await this.repository.markCompleted(job.id, documentId);
                return;
            }
        }

        await this.markAndReconcile(job, "reconciling");
    }

    private async handleExecutionFailure(
        job: EformsignDocumentJobEntity,
        latestProgressStep?: EformsignHeadlessProgressStep,
    ): Promise<void> {
        const sendAttempted = latestProgressStep === "creating"
            || latestProgressStep === "sent"
            || job.progressStep === "creating"
            || job.progressStep === "sent";
        if (sendAttempted) {
            await this.markAndReconcile(
                job,
                latestProgressStep ?? job.progressStep ?? "reconciling",
            );
            return;
        }
        await this.handlePreSendFailure(job, "HEADLESS_EXECUTION_FAILURE");
    }

    private async handlePreSendFailure(job: EformsignDocumentJobEntity, errorCode: string): Promise<void> {
        if (job.attempts <= MAX_PRE_SEND_RETRIES) {
            const delayMs = PRE_SEND_RETRY_DELAYS_MS[job.attempts - 1] ?? PRE_SEND_RETRY_DELAYS_MS.at(-1)!;
            await this.repository.scheduleRetry(
                job.id,
                new Date(Date.now() + delayMs),
                errorCode,
            );
            return;
        }
        await this.repository.markFailed(job.id, "PRE_SEND_RETRY_EXHAUSTED");
    }

    private async markAndReconcile(
        job: EformsignDocumentJobEntity,
        progressStep?: string,
    ): Promise<void> {
        const reconciling = await this.repository.markReconciling(job.id, progressStep ?? "reconciling");
        if (!reconciling) return;
        // markReconciling intentionally clears the persisted payload so a
        // reconciling row cannot retain customer data. Keep the claimed copy
        // in memory for this immediate provider lookup, otherwise creation
        // matching loses its customer/template hints on the first pass.
        const reconciliationJob = reconciling && !reconciling.payload
            ? new EformsignDocumentJobEntity({ ...reconciling, payload: job.payload })
            : reconciling ?? job;
        await this.reconcile(reconciliationJob);
    }

    private async reconcile(job: EformsignDocumentJobEntity): Promise<void> {
        await this.reconciliationService.reconcile(job);
    }

    private startHeartbeat(
        jobId: string,
        progressStep: () => string | undefined,
    ): ReturnType<typeof setInterval> {
        const heartbeat = setInterval(() => {
            void this.repository.updateProgress(jobId, progressStep() ?? "processing", new Date()).catch((error: unknown) => {
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Eformsign document job heartbeat failed: ${reason}`);
            });
        }, HEARTBEAT_INTERVAL_MS);
        if (typeof heartbeat !== "number") heartbeat.unref?.();
        return heartbeat;
    }

    private async recordProgress(jobId: string, step: EformsignHeadlessProgressStep): Promise<void> {
        try {
            await this.repository.updateProgress(jobId, step, new Date());
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Eformsign document job progress update failed: ${reason}`);
        }
    }

    private isEnabled(): boolean {
        return this.configService.get<string>(WORKER_ENABLED_ENV)?.trim().toLowerCase() === "true";
    }

    private isAmbiguous(
        result: DispatchHeadlessResult | FinalizeHeadlessResult,
        latestProgressStep: EformsignHeadlessProgressStep | undefined,
    ): boolean {
        if (latestProgressStep === "creating" || latestProgressStep === "sent") return true;
        if ("remoteDocumentId" in result && Boolean(result.remoteDocumentId)) return true;
        if ("fallbackHint" in result && result.fallbackHint === "manual_check") return true;
        return "reason" in result
            && ["remote_unconfirmed", "ambiguous", "provider_timeout", "send_outcome_unknown"]
                .some((reason) => result.reason === reason);
    }
}

function parseCreatePayload(payload: Record<string, unknown>): CreateDocumentJobPayload | null {
    const clientId = payload["clientId"];
    const contractData = payload["contractData"];
    if (typeof clientId !== "number" || !isContractData(contractData)) return null;
    return {
        clientId,
        contractData,
        ...(readOptionalString(payload["progressId"]) ? { progressId: readOptionalString(payload["progressId"]) } : {}),
        ...(payload["force"] === true ? { force: true } : {}),
    };
}

function parseFinalizePayload(payload: Record<string, unknown>): FinalizeDocumentJobPayload | null {
    const documentId = readOptionalString(payload["documentId"]);
    const prefillEndDate = readOptionalString(payload["prefillEndDate"]);
    const progressId = readOptionalString(payload["progressId"]);
    if (payload["documentId"] !== undefined && !documentId) return null;
    if (payload["prefillEndDate"] !== undefined && !prefillEndDate) return null;
    if (payload["progressId"] !== undefined && !progressId) return null;
    return {
        ...(documentId ? { documentId } : {}),
        ...(prefillEndDate ? { prefillEndDate } : {}),
        ...(progressId ? { progressId } : {}),
    };
}

function isContractData(value: unknown): value is ContractDataDto {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const required = [
        "customerName", "customerContact", "customerDOB", "customerAddress",
        "caretaker1Name", "caretaker1Contact", "type", "days", "area",
        "contractDuration", "startYear", "startMonth", "startDay", "startDate",
        "endYear", "endMonth", "endDay", "endDate", "paymentYear", "paymentMonth",
        "paymentDay", "fullPrice", "grant", "actualPrice",
    ];
    return required.every((key) => typeof record[key] === "string")
        && (record["issuerPhone"] === undefined || typeof record["issuerPhone"] === "string");
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}
