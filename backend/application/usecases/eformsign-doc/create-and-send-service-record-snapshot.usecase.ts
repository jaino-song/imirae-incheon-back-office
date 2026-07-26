import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import {
    buildServiceRecordDocumentFields,
    chunkSessionsByTier,
    type ServiceRecordDayInput,
} from "./service-record-field-mapper";
import {
    FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT,
    FEEDBACK_TEMPLATE_TIER_ENV_KEYS,
} from "./service-record-field-ids";

const CASE_SNAPSHOT_INCLUDE = {
    client: { select: { name: true } },
    assignments: {
        select: {
            id: true,
            scheduleId: true,
            employeeId: true,
            employeeNameSnapshot: true,
            startDate: true,
            endDate: true,
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
    },
    days: {
        select: {
            scheduleId: true,
            caseSessionIndex: true,
            employeeId: true,
            employeeNameSnapshot: true,
            serviceDate: true,
            answers: true,
            etcService: true,
            notes: true,
            paymentConfirmed: true,
            momApproval: true,
            clientSignature: true,
            locked: true,
        },
        orderBy: [{ caseSessionIndex: "asc" }, { serviceDate: "asc" }],
    },
} satisfies Prisma.service_record_caseInclude;

type ServiceRecordCaseForSnapshot = Prisma.service_record_caseGetPayload<{
    include: typeof CASE_SNAPSHOT_INCLUDE;
}>;

interface PreparedSnapshotChunk {
    assignmentId: string | null;
    scheduleId: number | null;
    employeeName: string;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
    sourceHash: string;
    documentName: string;
    days: ServiceRecordDayInput[];
    tier: number;
    templateId: string;
}

interface PersistedSnapshotChunkLayout {
    assignmentId: string | null;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
    employeeNameSnapshot: string;
}

const CHUNK_CLAIM_STALE_MS = 10 * 60 * 1000;
const CHUNK_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_DEFINITIVE_CREATE_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 12;

/**
 * Finalize a completed 제공기록지 into one or more fully-prefilled eformsign documents and route
 * them to the template's 제공업체 확인 (reviewer) step (BJJ-249). The 제공인력 fills everything in
 * the app — nobody fills anything in eformsign — so the document goes straight to the org's
 * pre-specified reviewer for confirmation.
 *
 * Templates come in fixed session-grid tiers (5/10/15/20 — BJJ-multi-tier): each provider
 * segment is packed into the smallest configured tier that holds it in one document, and
 * segments longer than the max tier are cut at max-tier size with the remainder re-tiered.
 * Each document's fields are prefilled from `service_record` + `service_record_day`
 * by the pure mapper. Persisted with linkToClient:false — the client's eDocId is NEVER touched —
 * and the webhook template_id gate (all EFORMSIGN_FEEDBACK_TEMPLATE_ID* tiers) keeps completion
 * from marking the contract done.
 *
 * Retry-safe: durable `service_record_snapshot_chunk` rows let a re-run skip documents already created.
 */
@Injectable()
export class CreateAndSendServiceRecordSnapshotUsecase {
    private readonly logger = new Logger(CreateAndSendServiceRecordSnapshotUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        private readonly prisma: PrismaService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Reads the configured 제공기록지 template tiers from env (BJJ-multi-tier). Only tiers whose
     * env var is actually set are usable — an environment with just the base 5회 id configured
     * behaves exactly as before (every chunk is 5 sessions). Throws the same message as before
     * when even the base tier is missing, preserving the existing "not configured" contract.
     */
    private getConfiguredTiers(): Array<{ tier: number; templateId: string }> {
        const tiers = FEEDBACK_TEMPLATE_TIER_ENV_KEYS
            .map(({ tier, envKey }) => ({ tier, templateId: this.configService.get<string>(envKey)?.trim() ?? "" }))
            .filter((entry) => entry.templateId !== "");
        const hasBase = tiers.some((entry) => entry.tier === FEEDBACK_TEMPLATE_SESSIONS_PER_DOCUMENT);
        if (!hasBase) {
            throw new BadRequestException("EFORMSIGN_FEEDBACK_TEMPLATE_ID is not configured.");
        }
        return tiers;
    }

    /**
     * Client-owned finalization path. Chunk rows are durable claims, so multiple app instances
     * cannot create the same remote document concurrently. Ambiguous remote calls are reconciled
     * by deterministic title and are never blindly retried.
     */
    async executeCase(
        branchid: string,
        serviceRecordCaseId: string,
    ): Promise<{ documentIds: string[]; documentId: string; chunkCount: number }> {
        const tiers = this.getConfiguredTiers();
        const tierNumbers = tiers.map((t) => t.tier);
        const templateIdByTier = new Map(tiers.map((t) => [t.tier, t.templateId]));

        const record = await this.prisma.service_record_case.findUnique({
            where: { id: serviceRecordCaseId },
            include: CASE_SNAPSHOT_INCLUDE,
        });
        if (!record || record.branchId !== branchid) {
            throw new NotFoundException("Service record not found");
        }
        this.assertReadyForSnapshot(record);

        const persistedChunkLayout = await this.prisma.service_record_snapshot_chunk.findMany({
            where: {
                serviceRecordCaseId: record.id,
                snapshotVersion: record.formVersion,
            },
            select: {
                assignmentId: true,
                chunkIndex: true,
                chunkCount: true,
                firstSessionIndex: true,
                lastSessionIndex: true,
                employeeNameSnapshot: true,
            },
            orderBy: { chunkIndex: "asc" },
        });
        const chunks = this.buildCaseChunks(
            record,
            tierNumbers,
            templateIdByTier,
            persistedChunkLayout,
        );
        const chunkRows = await this.prepareChunkRows(record, chunks);
        const existingDocs = await this.prisma.eformsign_doc.findMany({
            where: {
                serviceRecordCaseId: record.id,
                snapshotVersion: record.formVersion,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        const existingByChunk = new Map(
            existingDocs.map((document) => [document.snapshotChunkIndex, document]),
        );

        const missingChunks = chunks.filter((chunk) => !existingByChunk.has(chunk.chunkIndex));
        let accessToken: string | null = null;
        // The reviewer recipient must mirror each used template's pre-specified 제공업체 확인 step
        // exactly (eformsign rejects mismatches), so it is read once per distinct templateId
        // actually needed by chunks not yet created — reviewer configuration can differ per template.
        const reviewerByTemplateId = new Map<
            string,
            NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>
        >();
        if (missingChunks.length > 0) {
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            accessToken = tokenResponse.oauth_token.access_token;
            const neededTemplateIds = new Set(missingChunks.map((chunk) => chunk.templateId));
            for (const templateId of neededTemplateIds) {
                const reviewer = await this.eformsignClient.getTemplateReviewer(accessToken, templateId);
                if (!reviewer) {
                    throw new BadRequestException("제공기록지 템플릿에 검토자(제공업체 확인) 지정이 없습니다.");
                }
                reviewerByTemplateId.set(templateId, reviewer);
            }
        }

        const documentIds: string[] = [];
        for (const chunk of chunks) {
            const existingDoc = existingByChunk.get(chunk.chunkIndex);
            const row = chunkRows.find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
            if (!row) throw new Error(`Snapshot chunk ${chunk.chunkIndex} was not prepared`);

            if (existingDoc) {
                await this.markChunkCreated(row.id, existingDoc.documentId);
                documentIds.push(existingDoc.documentId);
                continue;
            }
            const reviewer = reviewerByTemplateId.get(chunk.templateId);
            if (!accessToken || !reviewer) {
                throw new Error("Eformsign credentials were not initialized");
            }

            const documentId = await this.processChunk({
                record,
                chunk,
                chunkId: row.id,
                chunkStatus: row.status,
                chunkAttempts: row.attempts,
                chunkClaimedAt: row.claimedAt,
                chunkCreateAttemptedAt: row.createAttemptedAt,
                templateId: chunk.templateId,
                accessToken,
                reviewer,
            });
            documentIds.push(documentId);
        }

        return {
            documentIds,
            documentId: documentIds[0] ?? "",
            chunkCount: chunks.length,
        };
    }

    private assertReadyForSnapshot(record: ServiceRecordCaseForSnapshot): void {
        const required = record.requiredSessionCount ?? 0;
        const completeHeader = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].every((value) => Boolean(value?.trim()));
        const indicesAreContinuous = record.days.every(
            (day, index) => day.caseSessionIndex === index + 1,
        );
        const sessionsComplete = required > 0
            && record.days.length === required
            && indicesAreContinuous
            && record.days.every((day) => day.locked && day.momApproval === "approved");

        if (!completeHeader || !sessionsComplete) {
            throw new ConflictException({ code: "SERVICE_RECORD_INCOMPLETE" });
        }
    }

    private buildCaseChunks(
        record: ServiceRecordCaseForSnapshot,
        tiers: number[],
        templateIdByTier: Map<number, string>,
        persistedLayout: PersistedSnapshotChunkLayout[] = [],
    ): PreparedSnapshotChunk[] {
        if (persistedLayout.length > 0) {
            return this.buildCaseChunksFromPersistedLayout(
                record,
                tiers,
                templateIdByTier,
                persistedLayout,
            );
        }

        const assignmentsBySchedule = new Map(
            record.assignments
                .filter((assignment) => assignment.scheduleId !== null)
                .map((assignment) => [assignment.scheduleId!, assignment]),
        );
        const groups: Array<{
            key: string;
            assignmentId: string | null;
            scheduleId: number | null;
            employeeName: string;
            days: ServiceRecordDayInput[];
        }> = [];

        for (const day of record.days) {
            const assignment = day.scheduleId
                ? assignmentsBySchedule.get(day.scheduleId) ?? null
                : this.findAssignmentForDay(record, day.employeeId, day.serviceDate);
            const employeeName = day.employeeNameSnapshot
                ?? assignment?.employeeNameSnapshot
                ?? "미확인 제공인력";
            const groupKey = assignment?.id
                ?? `employee:${day.employeeId ?? "unknown"}:${employeeName}`;
            let group = groups.at(-1);
            if (!group || group.key !== groupKey) {
                group = {
                    key: groupKey,
                    assignmentId: assignment?.id ?? null,
                    scheduleId: day.scheduleId ?? assignment?.scheduleId ?? null,
                    employeeName,
                    days: [],
                };
                groups.push(group);
            }
            group.days.push({
                sessionIndex: day.caseSessionIndex!,
                serviceDate: day.serviceDate,
                answers: (day.answers ?? {}) as Record<string, unknown>,
                etcService: day.etcService,
                notes: day.notes,
                paymentConfirmed: day.paymentConfirmed,
                momApproval: day.momApproval,
                clientSignature: day.clientSignature,
            });
        }

        const rawChunks = groups.flatMap((group) => (
            chunkSessionsByTier(group.days, tiers).map(({ days, tier }) => ({ ...group, days, tier }))
        ));
        const chunkCount = rawChunks.length;
        return rawChunks.map((chunk, index) => {
            const chunkIndex = index + 1;
            const firstSessionIndex = chunk.days[0]!.sessionIndex;
            const lastSessionIndex = chunk.days.at(-1)!.sessionIndex;
            const documentName = this.caseDocumentName(
                record.client?.name || record.momName?.trim() || "삭제된 고객",
                record.id,
                record.formVersion,
                chunkIndex,
                chunkCount,
            );
            const sourceHash = createHash("sha256")
                .update(this.stableStringify({
                    formVersion: record.formVersion,
                    header: {
                        momName: record.momName,
                        momBirth: record.momBirth,
                        babyName: record.babyName,
                        babyBirth: record.babyBirth,
                        deliveryType: record.deliveryType,
                        babyWeight: record.babyWeight,
                    },
                    employeeName: chunk.employeeName,
                    days: chunk.days,
                }))
                .digest("hex");
            const templateId = templateIdByTier.get(chunk.tier);
            if (!templateId) throw new Error(`No 제공기록지 template configured for tier ${chunk.tier}`);
            return {
                assignmentId: chunk.assignmentId,
                scheduleId: chunk.scheduleId,
                employeeName: chunk.employeeName,
                chunkIndex,
                chunkCount,
                firstSessionIndex,
                lastSessionIndex,
                sourceHash,
                documentName,
                days: chunk.days,
                tier: chunk.tier,
                templateId,
            };
        });
    }

    /**
     * Once durable chunk rows exist, their session boundaries are the layout of record for this
     * snapshot version. Rebuild the payload inside those boundaries instead of re-tiering with the
     * current environment, otherwise a newly enabled larger tier could reuse chunkIndex 1 for a
     * different session range and make an existing document hide sessions from the retry.
     */
    private buildCaseChunksFromPersistedLayout(
        record: ServiceRecordCaseForSnapshot,
        tiers: number[],
        templateIdByTier: Map<number, string>,
        persistedLayout: PersistedSnapshotChunkLayout[],
    ): PreparedSnapshotChunk[] {
        const layouts = [...persistedLayout].sort((a, b) => a.chunkIndex - b.chunkIndex);
        const assignmentsById = new Map(record.assignments.map((assignment) => [assignment.id, assignment]));
        const sortedTiers = [...tiers].sort((a, b) => a - b);
        let expectedFirstSessionIndex = 1;

        const chunks = layouts.map((layout, index) => {
            const expectedChunkIndex = index + 1;
            const layoutIsValid = (
                layout.chunkIndex === expectedChunkIndex
                && layout.chunkCount === layouts.length
                && layout.firstSessionIndex === expectedFirstSessionIndex
                && layout.lastSessionIndex >= layout.firstSessionIndex
                && layout.lastSessionIndex <= record.days.length
            );
            if (!layoutIsValid) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
            }

            const sourceDays = record.days.filter((day) => (
                day.caseSessionIndex! >= layout.firstSessionIndex
                && day.caseSessionIndex! <= layout.lastSessionIndex
            ));
            const expectedDayCount = layout.lastSessionIndex - layout.firstSessionIndex + 1;
            if (sourceDays.length !== expectedDayCount) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
            }

            const tier = sortedTiers.find((candidate) => candidate >= sourceDays.length);
            const templateId = tier === undefined ? undefined : templateIdByTier.get(tier);
            if (tier === undefined || !templateId) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_TEMPLATE_TIER_UNAVAILABLE" });
            }

            const days = sourceDays.map((day) => ({
                sessionIndex: day.caseSessionIndex!,
                serviceDate: day.serviceDate,
                answers: (day.answers ?? {}) as Record<string, unknown>,
                etcService: day.etcService,
                notes: day.notes,
                paymentConfirmed: day.paymentConfirmed,
                momApproval: day.momApproval,
                clientSignature: day.clientSignature,
            }));
            const assignment = layout.assignmentId
                ? assignmentsById.get(layout.assignmentId) ?? null
                : null;
            const employeeName = layout.employeeNameSnapshot;
            const chunkCount = layouts.length;
            const documentName = this.caseDocumentName(
                record.client?.name || record.momName?.trim() || "삭제된 고객",
                record.id,
                record.formVersion,
                layout.chunkIndex,
                chunkCount,
            );
            const sourceHash = createHash("sha256")
                .update(this.stableStringify({
                    formVersion: record.formVersion,
                    header: {
                        momName: record.momName,
                        momBirth: record.momBirth,
                        babyName: record.babyName,
                        babyBirth: record.babyBirth,
                        deliveryType: record.deliveryType,
                        babyWeight: record.babyWeight,
                    },
                    employeeName,
                    days,
                }))
                .digest("hex");

            expectedFirstSessionIndex = layout.lastSessionIndex + 1;
            return {
                assignmentId: layout.assignmentId,
                scheduleId: sourceDays[0]?.scheduleId ?? assignment?.scheduleId ?? null,
                employeeName,
                chunkIndex: layout.chunkIndex,
                chunkCount,
                firstSessionIndex: layout.firstSessionIndex,
                lastSessionIndex: layout.lastSessionIndex,
                sourceHash,
                documentName,
                days,
                tier,
                templateId,
            };
        });

        if (expectedFirstSessionIndex !== record.days.length + 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
        }
        return chunks;
    }

    private findAssignmentForDay(
        record: ServiceRecordCaseForSnapshot,
        employeeId: number | null,
        serviceDate: Date,
    ) {
        return record.assignments.find((assignment) => (
            (employeeId === null || assignment.employeeId === employeeId)
            && assignment.startDate <= serviceDate
            && assignment.endDate >= serviceDate
        )) ?? null;
    }

    private async prepareChunkRows(
        record: ServiceRecordCaseForSnapshot,
        chunks: PreparedSnapshotChunk[],
    ) {
        return this.prisma.$transaction(async (tx) => {
            const existingRows = await tx.service_record_snapshot_chunk.findMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                },
            });
            const existingByIndex = new Map(existingRows.map((row) => [row.chunkIndex, row]));
            await tx.service_record_snapshot_chunk.deleteMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                    chunkIndex: { notIn: chunks.map((chunk) => chunk.chunkIndex) },
                    status: { not: "CREATED" },
                },
            });

            for (const chunk of chunks) {
                const existing = existingByIndex.get(chunk.chunkIndex);
                const data = {
                    branchId: record.branchId,
                    assignmentId: chunk.assignmentId,
                    chunkCount: chunk.chunkCount,
                    firstSessionIndex: chunk.firstSessionIndex,
                    lastSessionIndex: chunk.lastSessionIndex,
                    employeeNameSnapshot: chunk.employeeName,
                    sourceHash: chunk.sourceHash,
                };
                if (!existing) {
                    await tx.service_record_snapshot_chunk.create({
                        data: {
                            ...data,
                            serviceRecordCaseId: record.id,
                            snapshotVersion: record.formVersion,
                            chunkIndex: chunk.chunkIndex,
                        },
                    });
                    continue;
                }
                if (
                    existing.status === "CREATED"
                    && existing.sourceHash !== chunk.sourceHash
                    && !existing.sourceHash.startsWith("legacy:")
                ) {
                    throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_SOURCE_CHANGED" });
                }
                if (existing.status !== "CREATED") {
                    await tx.service_record_snapshot_chunk.update({
                        where: { id: existing.id },
                        data,
                    });
                }
            }

            return tx.service_record_snapshot_chunk.findMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                },
                orderBy: { chunkIndex: "asc" },
            });
        });
    }

    private async processChunk(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        chunkStatus: string;
        chunkAttempts: number;
        chunkClaimedAt: Date | null;
        chunkCreateAttemptedAt: Date | null;
        templateId: string;
        accessToken: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
    }): Promise<string> {
        let status = params.chunkStatus;
        if (
            status === "CLAIMED"
            && params.chunkCreateAttemptedAt === null
            && params.chunkClaimedAt
            && params.chunkClaimedAt.getTime() <= Date.now() - CHUNK_CLAIM_STALE_MS
        ) {
            await this.prisma.service_record_snapshot_chunk.update({
                where: { id: params.chunkId },
                data: { status: "FAILED", nextAttemptAt: new Date(), lastError: "Stale pre-create claim recovered" },
            });
            status = "FAILED";
        }

        if (status === "CREATE_REQUESTED" || status === "RECONCILING") {
            return this.reconcileChunk(params);
        }
        if (status === "MANUAL_REVIEW") {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_MANUAL_REVIEW" });
        }

        const now = new Date();
        const claim = await this.prisma.service_record_snapshot_chunk.updateMany({
            where: {
                id: params.chunkId,
                status: { in: ["PENDING", "FAILED"] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            data: {
                status: "CLAIMED",
                claimedAt: now,
                createAttemptedAt: null,
                nextAttemptAt: null,
                attempts: { increment: 1 },
                lastError: null,
            },
        });
        if (claim.count !== 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_CHUNK_BUSY" });
        }

        await this.prisma.service_record_snapshot_chunk.update({
            where: { id: params.chunkId },
            data: { status: "CREATE_REQUESTED", createAttemptedAt: new Date() },
        });

        try {
            const prefillFields = buildServiceRecordDocumentFields({
                header: params.record,
                employeeName: params.chunk.employeeName,
                days: params.chunk.days,
                slotCount: params.chunk.tier,
            });
            const result = await this.eformsignClient.createDocument(params.accessToken, {
                templateId: params.templateId,
                documentName: params.chunk.documentName,
                prefillFields,
                reviewer: params.reviewer,
            });
            await this.persistRemoteDocument({
                ...params,
                documentId: result.documentId,
                remoteDocument: null,
            });
            return result.documentId;
        } catch (error) {
            const message = this.errorMessage(error);
            const definitiveClientError = /Failed to create document: 4\d\d\b/.test(message);
            const attempts = params.chunkAttempts + 1;
            const statusAfterFailure = definitiveClientError
                ? (attempts >= MAX_DEFINITIVE_CREATE_ATTEMPTS ? "MANUAL_REVIEW" : "FAILED")
                : "RECONCILING";
            await this.prisma.service_record_snapshot_chunk.update({
                where: { id: params.chunkId },
                data: {
                    status: statusAfterFailure,
                    nextAttemptAt: statusAfterFailure === "MANUAL_REVIEW"
                        ? null
                        : new Date(Date.now() + CHUNK_RETRY_DELAY_MS),
                    lastError: message.slice(0, 2000),
                },
            });
            if (!definitiveClientError) {
                captureServiceRecordError(error, {
                    operation: "snapshot-create",
                    handled: true,
                    caseId: params.record.id,
                    scheduleId: params.chunk.scheduleId ?? undefined,
                    retryCount: attempts,
                });
            }
            throw error;
        }
    }

    private async reconcileChunk(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        chunkAttempts: number;
        templateId: string;
        accessToken: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
    }): Promise<string> {
        const documents = this.eformsignClient.findDocumentsByTitle
            ? await this.eformsignClient.findDocumentsByTitle(params.accessToken, params.chunk.documentName)
            : (await this.eformsignClient.getAllDocuments(params.accessToken))
                .filter((document) => document.document_name === params.chunk.documentName);
        if (documents.length > 1) {
            await this.prisma.service_record_snapshot_chunk.update({
                where: { id: params.chunkId },
                data: {
                    status: "MANUAL_REVIEW",
                    nextAttemptAt: null,
                    lastError: `Multiple remote documents match ${params.chunk.documentName}`,
                },
            });
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_DUPLICATE_REMOTE" });
        }
        const document = documents[0];
        if (document) {
            await this.persistRemoteDocument({
                ...params,
                documentId: document.id,
                remoteDocument: document,
            });
            return document.id;
        }

        const attempts = params.chunkAttempts + 1;
        const manualReview = attempts >= MAX_RECONCILIATION_ATTEMPTS;
        await this.prisma.service_record_snapshot_chunk.update({
            where: { id: params.chunkId },
            data: {
                status: manualReview ? "MANUAL_REVIEW" : "RECONCILING",
                attempts: { increment: 1 },
                nextAttemptAt: manualReview ? null : new Date(Date.now() + CHUNK_RETRY_DELAY_MS),
                lastError: `Remote document not visible for reconciliation: ${params.chunk.documentName}`,
            },
        });
        throw new ConflictException({
            code: manualReview
                ? "SERVICE_RECORD_SNAPSHOT_MANUAL_REVIEW"
                : "SERVICE_RECORD_SNAPSHOT_RECONCILIATION_PENDING",
        });
    }

    private async persistRemoteDocument(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        templateId: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
        documentId: string;
        remoteDocument: Awaited<ReturnType<IEformsignClientRepository["getDocument"]>> | null;
    }): Promise<void> {
        const now = new Date();
        const remoteStatus = params.remoteDocument?.current_status;
        const recipient = remoteStatus?.step_recipients?.[0];
        const createdDate = params.remoteDocument?.created_date
            ? new Date(params.remoteDocument.created_date)
            : now;
        const updatedDate = params.remoteDocument?.updated_date
            ? new Date(params.remoteDocument.updated_date)
            : now;
        const expiredDate = remoteStatus?.expired_date
            ? new Date(remoteStatus.expired_date)
            : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const marker = `제공기록지 C${params.record.id.slice(0, 8)} V${params.record.formVersion} ${params.chunk.chunkIndex}/${params.chunk.chunkCount}`;

        await this.prisma.$transaction(async (tx) => {
            await tx.eformsign_doc.upsert({
                where: { documentId: params.documentId },
                create: {
                    documentId: params.documentId,
                    createdDate,
                    updatedDate,
                    statusType: remoteStatus?.status_type ?? "070",
                    statusDetail: remoteStatus?.status_doc_detail ?? "검토 요청",
                    stepType: remoteStatus?.step_type ?? "06",
                    stepIndex: remoteStatus?.step_index ?? "2",
                    stepName: marker,
                    stepRecipientType: recipient?.recipient_type ?? "reviewer",
                    stepRecipientName: recipient?.name ?? params.reviewer.name,
                    stepRecipientSms: params.reviewer.phoneNumber ?? "-",
                    expiredDate,
                    expired: remoteStatus?._expired ?? false,
                    clientId: params.record.clientId,
                    branchId: params.record.branchId,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                    employeeScheduleId: params.chunk.scheduleId,
                    templateId: params.templateId,
                    serviceRecordCaseId: params.record.id,
                    snapshotVersion: params.record.formVersion,
                    snapshotChunkIndex: params.chunk.chunkIndex,
                },
                update: {
                    ...(remoteStatus ? {
                        updatedDate,
                        statusType: remoteStatus.status_type,
                        statusDetail: remoteStatus.status_doc_detail,
                        stepType: remoteStatus.step_type,
                        stepIndex: remoteStatus.step_index,
                        stepName: marker,
                        stepRecipientType: recipient?.recipient_type ?? "reviewer",
                        stepRecipientName: recipient?.name ?? params.reviewer.name,
                        stepRecipientSms: params.reviewer.phoneNumber ?? "-",
                        expiredDate,
                        expired: remoteStatus._expired ?? false,
                    } : {}),
                    clientId: params.record.clientId,
                    branchId: params.record.branchId,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                    employeeScheduleId: params.chunk.scheduleId,
                    templateId: params.templateId,
                    serviceRecordCaseId: params.record.id,
                    snapshotVersion: params.record.formVersion,
                    snapshotChunkIndex: params.chunk.chunkIndex,
                },
            });
            await tx.service_record_snapshot_chunk.update({
                where: { id: params.chunkId },
                data: {
                    status: "CREATED",
                    eformsignDocumentId: params.documentId,
                    nextAttemptAt: null,
                    lastError: null,
                },
            });
        });
        this.logger.log(
            `Service record snapshot chunk created: case=${params.record.id}, chunk=${params.chunk.chunkIndex}/${params.chunk.chunkCount}, document=${params.documentId}`,
        );
    }

    private async markChunkCreated(chunkId: string, documentId: string): Promise<void> {
        await this.prisma.service_record_snapshot_chunk.updateMany({
            where: { id: chunkId, status: { not: "CREATED" } },
            data: {
                status: "CREATED",
                eformsignDocumentId: documentId,
                nextAttemptAt: null,
                lastError: null,
            },
        });
    }

    private caseDocumentName(
        clientName: string,
        caseId: string,
        version: number,
        chunkIndex: number,
        chunkCount: number,
    ): string {
        return `서비스 제공기록지 - ${clientName} (${chunkIndex}/${chunkCount}) [SR-${caseId.slice(0, 8)}-v${version}]`;
    }

    private stableStringify(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
        }
        if (value instanceof Date) {
            return JSON.stringify(value.toISOString());
        }
        if (value && typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right));
            return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`).join(",")}}`;
        }
        return JSON.stringify(value) ?? "null";
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
