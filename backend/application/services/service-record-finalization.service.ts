import { Injectable, Logger } from "@nestjs/common";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "./service-record-lifecycle.service";

const CASE_BATCH_SIZE = 10;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const FINALIZATION_STALE_MS = 20 * 60 * 1000;
const COMPLETED_DOCUMENT_STATUS_TYPES = ["003", "012", "022", "032", "050", "062", "072", "092"];

@Injectable()
export class ServiceRecordFinalizationService {
    private readonly logger = new Logger(ServiceRecordFinalizationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly lifecycleService: ServiceRecordLifecycleService,
        private readonly createSnapshotUsecase: CreateAndSendServiceRecordSnapshotUsecase,
    ) {}

    async processDueCases(referenceDate = new Date(), limit = CASE_BATCH_SIZE): Promise<number> {
        await this.recoverStaleFinalizations(referenceDate);
        await this.completeReviewedCases(referenceDate, limit * 5);
        await this.promoteEligibleCases(referenceDate, limit * 5);
        const candidates = await this.prisma.service_record_case.findMany({
            where: {
                snapshotChunks: { none: { status: "MANUAL_REVIEW" } },
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                    {
                        status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                        nextAttemptAt: { lte: referenceDate },
                    },
                ],
            },
            select: { id: true, branchId: true, finalizationAttempts: true },
            orderBy: [{ finalizationDueAt: "asc" }, { updatedAt: "asc" }],
            take: limit,
        });

        let finalizedCount = 0;
        for (const candidate of candidates) {
            const claimed = await this.prisma.service_record_case.updateMany({
                where: {
                    id: candidate.id,
                    OR: [
                        { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                        {
                            status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                            nextAttemptAt: { lte: referenceDate },
                        },
                    ],
                },
                data: {
                    status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                    finalizationStartedAt: new Date(),
                    finalizationAttempts: { increment: 1 },
                    nextAttemptAt: null,
                    lastError: null,
                    version: { increment: 1 },
                },
            });
            if (claimed.count !== 1) continue;

            try {
                const result = await this.createSnapshotUsecase.executeCase(
                    candidate.branchId,
                    candidate.id,
                );
                if (result.chunkCount < 1 || result.documentIds.length !== result.chunkCount) {
                    throw new Error("Snapshot finalization returned an incomplete document set");
                }
                await this.prisma.$transaction(async (tx) => {
                    const updated = await tx.service_record_case.updateMany({
                        where: {
                            id: candidate.id,
                            status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                        },
                        data: {
                            status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                            finalizedAt: new Date(),
                            nextAttemptAt: null,
                            lastError: null,
                            version: { increment: 1 },
                        },
                    });
                    if (updated.count !== 1) {
                        throw new Error("Service record finalization claim was lost");
                    }
                    await tx.service_record_token.updateMany({
                        where: {
                            serviceRecordCaseId: candidate.id,
                            active: true,
                        },
                        data: { active: false, revokedAt: new Date() },
                    });
                });
                finalizedCount += 1;
                this.logger.log(
                    `Service record finalized: case=${candidate.id}, documents=${result.documentIds.join(",")}`,
                );
            } catch (error) {
                await this.recordFailure(
                    candidate.id,
                    candidate.finalizationAttempts + 1,
                    error,
                );
            }
        }

        return finalizedCount;
    }

    private async recoverStaleFinalizations(referenceDate: Date): Promise<void> {
        const staleBefore = new Date(referenceDate.getTime() - FINALIZATION_STALE_MS);
        const recovered = await this.prisma.service_record_case.updateMany({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                finalizationStartedAt: { lte: staleBefore },
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: referenceDate,
                lastError: "Recovered stale finalization claim",
                version: { increment: 1 },
            },
        });
        if (recovered.count > 0) {
            this.logger.warn(`Recovered ${recovered.count} stale service-record finalization claim(s)`);
        }
    }

    private async completeReviewedCases(referenceDate: Date, limit: number): Promise<void> {
        const cases = await this.prisma.service_record_case.findMany({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                eformsignDocs: {
                    some: { documentKind: "service_record_snapshot" },
                    none: {
                        documentKind: "service_record_snapshot",
                        statusType: { notIn: COMPLETED_DOCUMENT_STATUS_TYPES },
                    },
                },
            },
            select: { id: true },
            take: limit,
        });
        for (const record of cases) {
            await this.prisma.service_record_case.updateMany({
                where: {
                    id: record.id,
                    status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                },
                data: {
                    status: SERVICE_RECORD_CASE_STATUS.COMPLETED,
                    documentsCompletedAt: referenceDate,
                    version: { increment: 1 },
                },
            });
        }
    }

    private async promoteEligibleCases(referenceDate: Date, limit: number): Promise<void> {
        const candidates = await this.prisma.service_record_case.findMany({
            where: {
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.WAITING_FOR_END },
                    {
                        finalizationDueAt: { lte: referenceDate },
                        status: {
                            in: [
                                SERVICE_RECORD_CASE_STATUS.SCHEDULED,
                                SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                            ],
                        },
                    },
                ],
            },
            select: { id: true },
            orderBy: { finalizationDueAt: "asc" },
            take: limit,
        });
        for (const candidate of candidates) {
            await this.lifecycleService.recompute(candidate.id);
        }
    }

    private async recordFailure(
        serviceRecordCaseId: string,
        attempt: number,
        error: unknown,
    ): Promise<void> {
        captureServiceRecordError(error, {
            operation: "auto-finalize",
            handled: true,
            caseId: serviceRecordCaseId,
            retryCount: attempt,
        });
        const manualReview = await this.prisma.service_record_snapshot_chunk.count({
            where: { serviceRecordCaseId, status: "MANUAL_REVIEW" },
        });
        const delayMs = Math.min(
            5 * 60 * 1000 * (2 ** Math.max(0, attempt - 1)),
            MAX_RETRY_DELAY_MS,
        );
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.service_record_case.updateMany({
            where: {
                id: serviceRecordCaseId,
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: manualReview > 0 ? null : new Date(Date.now() + delayMs),
                lastError: message.slice(0, 2000),
                version: { increment: 1 },
            },
        });
        this.logger.error(
            `Service record finalization failed: case=${serviceRecordCaseId}, attempt=${attempt}, manualReview=${manualReview > 0}`,
            error instanceof Error ? error.stack : String(error),
        );
    }
}
