import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    EformsignDocumentJobEntity,
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
    EformsignDocumentJobStatus,
    EformsignDocumentJobType,
} from "domain/entities/eformsign-document-job.entity";
import {
    EformsignDocumentJobList,
    EformsignDocumentJobSummary,
    EnqueueEformsignDocumentJobInput,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type RawJob = {
    id: string; branch_id: string; client_id: number | null; document_id: string | null;
    job_type: string; source: string; status: string; request_key: string; active_key: string | null;
    payload: Prisma.JsonValue | string | null; payload_fingerprint: string | null; progress_step: string | null;
    attempts: number; next_attempt_at: Date | string; heartbeat_at: Date | string | null;
    started_at: Date | string | null; completed_at: Date | string | null; last_error_code: string | null;
    created_by_user_id: string | null; created_at: Date | string; updated_at: Date | string;
};

const ACTIVE_STATUSES = Prisma.sql`('queued', 'processing', 'reconciling')`;
const TERMINAL_STATUSES = Prisma.sql`('completed', 'failed')`;

@Injectable()
export class SbEformsignDocumentJobRepository implements IEformsignDocumentJobRepository {
    constructor(private readonly prisma: PrismaService) {}

    async enqueue(input: EnqueueEformsignDocumentJobInput) {
        return this.prisma.$transaction(async (tx) => {
            const inserted = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                INSERT INTO "eformsign_document_job" (
                    branch_id, client_id, document_id, job_type, source, request_key,
                    active_key, payload, payload_fingerprint, progress_step, created_by_user_id
                ) VALUES (
                    ${input.branchId}::uuid, ${input.clientId ?? null}, ${input.documentId ?? null},
                    ${input.jobType}, ${input.source}, ${input.requestKey}, ${input.activeKey},
                    ${JSON.stringify(input.payload)}::jsonb, ${input.payloadFingerprint}, 'queued',
                    ${input.createdByUserId ?? null}::uuid
                )
                ON CONFLICT DO NOTHING
                RETURNING *
            `);
            if (inserted[0]) return { job: this.toDomain(inserted[0]), existing: false };

            const existing = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                SELECT * FROM "eformsign_document_job"
                WHERE branch_id = ${input.branchId}::uuid
                  AND (request_key = ${input.requestKey} OR active_key = ${input.activeKey})
                ORDER BY CASE WHEN request_key = ${input.requestKey} THEN 0 ELSE 1 END
                LIMIT 1
            `);
            if (!existing[0]) throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
            return { job: this.toDomain(existing[0]), existing: true };
        });
    }

    async claimDue(limit = 1): Promise<EformsignDocumentJobEntity[]> {
        const requested = Math.max(1, Math.min(limit, 3));
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(240813, 3)`);
            const counts = await tx.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
                SELECT count(*)::int AS count FROM "eformsign_document_job"
                WHERE status IN ('processing', 'reconciling')
            `);
            const available = Math.max(0, 3 - Number(counts[0]?.count ?? 0));
            if (available === 0) return [];
            const take = Math.min(requested, available);
            const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                WITH picked AS (
                    SELECT id FROM "eformsign_document_job"
                    WHERE status = 'queued' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at ASC, created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT ${take}
                )
                UPDATE "eformsign_document_job" job
                SET status = 'processing', attempts = attempts + 1,
                    started_at = COALESCE(started_at, now()), heartbeat_at = now(), updated_at = now()
                FROM picked WHERE job.id = picked.id
                RETURNING job.*
            `);
            return rows.map((row) => this.toDomain(row));
        });
    }

    async updateProgress(id: string, progressStep: string, heartbeatAt = new Date()) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET progress_step = ${progressStep},
                heartbeat_at = ${heartbeatAt}, updated_at = now()
            WHERE id = ${id}::uuid AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async scheduleRetry(id: string, nextAttemptAt: Date, errorCode: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'queued', next_attempt_at = ${nextAttemptAt},
                last_error_code = ${errorCode}, heartbeat_at = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND status = 'processing' RETURNING *
        `);
    }

    async markReconciling(id: string, progressStep = "reconciling") {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'reconciling', progress_step = ${progressStep},
                payload = NULL, heartbeat_at = now(), updated_at = now()
            WHERE id = ${id}::uuid AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async markCompleted(id: string, documentId?: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'completed',
                document_id = COALESCE(${documentId ?? null}, document_id), completed_at = now(),
                payload = NULL, active_key = NULL, heartbeat_at = NULL, last_error_code = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async markFailed(id: string, errorCode: string) {
        return this.terminal(id, "failed", errorCode);
    }

    async markRequiresAttention(id: string, errorCode: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'requires_attention', last_error_code = ${errorCode},
                payload = NULL, heartbeat_at = NULL, completed_at = now(), updated_at = now()
            WHERE id = ${id}::uuid AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async recoverStale(cutoff: Date) {
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            UPDATE "eformsign_document_job" SET
                status = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN 'queued'
                    ELSE 'reconciling'
                END,
                next_attempt_at = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN now()
                    ELSE next_attempt_at
                END,
                payload = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN payload
                    ELSE NULL
                END,
                heartbeat_at = NULL, updated_at = now()
            WHERE status IN ('processing', 'reconciling')
              AND COALESCE(heartbeat_at, updated_at) < ${cutoff}
            RETURNING *
        `);
        return rows.map((row) => this.toDomain(row));
    }

    async getSummary(branchId: string): Promise<EformsignDocumentJobSummary> {
        const rows = await this.prisma.$queryRaw<Array<{ active_count: number; attention_count: number }>>(Prisma.sql`
            SELECT count(*) FILTER (WHERE status IN ${ACTIVE_STATUSES})::int AS active_count,
                   count(*) FILTER (WHERE status = 'requires_attention')::int AS attention_count
            FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid
        `);
        return { activeCount: Number(rows[0]?.active_count ?? 0), requiresAttentionCount: Number(rows[0]?.attention_count ?? 0) };
    }

    async listForBranch(branchId: string, terminalSince: Date, terminalLimit = 50): Promise<EformsignDocumentJobList> {
        const limit = Math.max(1, Math.min(terminalLimit, 50));
        const [active, requiresAttention, recent] = await Promise.all([
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status IN ${ACTIVE_STATUSES} ORDER BY created_at ASC`),
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status = 'requires_attention' ORDER BY updated_at DESC`),
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status IN ${TERMINAL_STATUSES} AND completed_at >= ${terminalSince} ORDER BY completed_at DESC LIMIT ${limit}`),
        ]);
        return { active: active.map(this.toDomain), requiresAttention: requiresAttention.map(this.toDomain), recent: recent.map(this.toDomain) };
    }

    async deleteExpiredTerminal(cutoff: Date) {
        const count = await this.prisma.$executeRaw(Prisma.sql`
            DELETE FROM "eformsign_document_job" WHERE status IN ${TERMINAL_STATUSES} AND completed_at < ${cutoff}
        `);
        return Number(count);
    }

    private async terminal(id: string, status: "failed", errorCode: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = ${status}, last_error_code = ${errorCode},
                completed_at = now(), payload = NULL, active_key = NULL, heartbeat_at = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    private async updateOne(query: Prisma.Sql) {
        const rows = await this.prisma.$queryRaw<RawJob[]>(query);
        return rows[0] ? this.toDomain(rows[0]) : null;
    }

    private toDomain = (row: RawJob): EformsignDocumentJobEntity => new EformsignDocumentJobEntity({
        id: row.id, branchId: row.branch_id, clientId: row.client_id, documentId: row.document_id,
        jobType: row.job_type as EformsignDocumentJobType, source: row.source as EformsignDocumentJobSource,
        status: row.status as EformsignDocumentJobStatus, requestKey: row.request_key, activeKey: row.active_key,
        payload: this.parsePayload(row.payload), payloadFingerprint: row.payload_fingerprint,
        progressStep: row.progress_step, attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at),
        heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at) : null,
        startedAt: row.started_at ? new Date(row.started_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null, lastErrorCode: row.last_error_code,
        createdByUserId: row.created_by_user_id, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    });

    private parsePayload(value: RawJob["payload"]): EformsignDocumentJobPayload | null {
        if (value === null) return null;
        return (typeof value === "string" ? JSON.parse(value) : value) as EformsignDocumentJobPayload;
    }
}
