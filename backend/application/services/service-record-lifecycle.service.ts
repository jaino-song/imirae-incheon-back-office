import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { countBusinessDaysKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";

export const SERVICE_RECORD_CASE_STATUS = {
    WAITING_FOR_DETAILS: "WAITING_FOR_DETAILS",
    WAITING_FOR_ASSIGNMENT: "WAITING_FOR_ASSIGNMENT",
    SCHEDULED: "SCHEDULED",
    IN_PROGRESS: "IN_PROGRESS",
    WAITING_FOR_END: "WAITING_FOR_END",
    AWAITING_COMPLETION: "AWAITING_COMPLETION",
    READY_TO_FINALIZE: "READY_TO_FINALIZE",
    FINALIZING: "FINALIZING",
    DOCUMENTS_CREATED: "DOCUMENTS_CREATED",
    COMPLETED: "COMPLETED",
    FINALIZATION_FAILED: "FINALIZATION_FAILED",
    TERMINATED_REVIEW_REQUIRED: "TERMINATED_REVIEW_REQUIRED",
    MIGRATION_REVIEW_REQUIRED: "MIGRATION_REVIEW_REQUIRED",
} as const;

export type ServiceRecordCaseStatus = typeof SERVICE_RECORD_CASE_STATUS[keyof typeof SERVICE_RECORD_CASE_STATUS];

const IMMUTABLE_FINALIZATION_STATUSES = new Set<string>([
    SERVICE_RECORD_CASE_STATUS.FINALIZING,
    SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
    SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
    SERVICE_RECORD_CASE_STATUS.COMPLETED,
]);

type DbClient = Prisma.TransactionClient | PrismaService;

type LockedServiceRecordSnapshot = {
    id: number;
    documentId: string;
    branchId: string;
    documentKind: string;
    statusType: string;
    detailPayload: Prisma.JsonValue | null;
    detailSourceUpdatedDate: Date | null;
    detailSyncedAt: Date | null;
    syncStatus: string;
    permanentPurgeRequestedAt: Date | null;
    hasCurrentDocumentPdf: boolean;
    hasCurrentAuditTrailPdf: boolean;
};

function isoDate(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function todayKst(now: Date): string {
    return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function requiredSessionCount(params: {
    startDate: Date | null;
    endDate: Date | null;
    fallback: number | null;
}): number | null {
    const startDate = isoDate(params.startDate);
    const endDate = isoDate(params.endDate);
    if (!startDate || !endDate) return params.fallback;
    return countBusinessDaysKr(startDate, endDate) ?? params.fallback;
}

function isWithinServicePeriod(serviceDate: Date, startDate: Date | null, endDate: Date | null): boolean {
    const serviceDateIso = isoDate(serviceDate);
    const startDateIso = isoDate(startDate);
    const endDateIso = isoDate(endDate);
    if (!serviceDateIso || !startDateIso || !endDateIso) return true;
    return serviceDateIso >= startDateIso && serviceDateIso <= endDateIso;
}

function hasCompleteHeader(record: {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
}): boolean {
    return [
        record.momName,
        record.momBirth,
        record.babyName,
        record.babyBirth,
        record.deliveryType,
        record.babyWeight,
    ].every((value) => Boolean(value?.trim()));
}

function isCurrentMirrorSnapshotVersion(
    snapshot: LockedServiceRecordSnapshot,
    mirrorVersion: {
        detailSourceUpdatedDate: Date;
        detailSyncedAt: Date;
    } | undefined,
): boolean {
    if (!isReadyCurrentSnapshot(snapshot)) return false;
    if (!mirrorVersion) return true;
    return snapshot.detailSourceUpdatedDate?.getTime() === mirrorVersion.detailSourceUpdatedDate.getTime()
        && snapshot.detailSyncedAt?.getTime() === mirrorVersion.detailSyncedAt.getTime();
}

function isReadyCurrentSnapshot(snapshot: LockedServiceRecordSnapshot): boolean {
    return snapshot.detailPayload !== null
        && snapshot.detailSourceUpdatedDate !== null
        && snapshot.detailSyncedAt !== null
        && snapshot.syncStatus === "ready"
        && !snapshot.permanentPurgeRequestedAt
        && snapshot.hasCurrentDocumentPdf
        && snapshot.hasCurrentAuditTrailPdf;
}

@Injectable()
export class ServiceRecordLifecycleService {
    constructor(private readonly prisma: PrismaService) {}

    async ensureForSchedule(scheduleId: number, tx?: Prisma.TransactionClient) {
        const db = tx ?? this.prisma;
        const schedule = await db.employee_schedule.findUnique({
            where: { id: scheduleId },
            select: { clientId: true },
        });
        if (!schedule) throw new NotFoundException("Assignment not found");
        return this.ensureForClient(schedule.clientId, tx);
    }

    async ensureForClient(clientId: number, tx?: Prisma.TransactionClient) {
        const db = tx ?? this.prisma;
        const client = await db.client.findUnique({
            where: { id: clientId },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                duration: true,
                serviceStatus: true,
                employeeSchedules: {
                    include: { primaryEmployee: true },
                    orderBy: [{ startDate: "asc" }, { id: "asc" }],
                },
            },
        });
        if (!client) throw new NotFoundException("Client not found");
        const branchId = client.branchId
            ?? client.employeeSchedules.find((schedule) => schedule.branchId)?.branchId
            ?? null;
        if (!branchId || !client.startDate) return null;

        const existing = await db.service_record_case.findUnique({ where: { clientId } });
        const endDateChanged = Boolean(
            existing && isoDate(existing.endDate) !== isoDate(client.endDate),
        );
        const finalizationDueAt = client.endDate
            ? getServiceRecordTokenExpiresAt(client.endDate)
            : null;
        const sessionCount = requiredSessionCount({
            startDate: client.startDate,
            endDate: client.endDate,
            fallback: client.duration,
        });
        const status = existing && IMMUTABLE_FINALIZATION_STATUSES.has(existing.status)
            ? existing.status
            : this.deriveBaseStatus({
                startDate: client.startDate,
                endDate: client.endDate,
                duration: sessionCount,
                hasAssignment: client.employeeSchedules.some((schedule) => !schedule.replaced),
                terminated: client.serviceStatus === "terminated",
            });

        const record = await db.service_record_case.upsert({
            where: { clientId },
            create: {
                branchId,
                clientId,
                status,
                startDate: client.startDate,
                endDate: client.endDate,
                requiredSessionCount: sessionCount,
                finalizationDueAt,
            },
            update: {
                branchId,
                startDate: client.startDate,
                endDate: client.endDate,
                requiredSessionCount: sessionCount,
                finalizationDueAt,
                ...(existing && IMMUTABLE_FINALIZATION_STATUSES.has(existing.status) ? {} : { status }),
                version: { increment: 1 },
            },
        });

        for (const schedule of client.employeeSchedules) {
            await db.service_record_assignment.upsert({
                where: { scheduleId: schedule.id },
                create: {
                    branchId: schedule.branchId ?? branchId,
                    serviceRecordCaseId: record.id,
                    scheduleId: schedule.id,
                    employeeId: schedule.primaryEmployeeId,
                    employeeNameSnapshot: schedule.primaryEmployee.name,
                    employeePhoneSnapshot: schedule.primaryEmployee.phone,
                    startDate: schedule.startDate,
                    endDate: schedule.endDate,
                },
                update: {
                    serviceRecordCaseId: record.id,
                    employeeId: schedule.primaryEmployeeId,
                    employeeNameSnapshot: schedule.primaryEmployee.name,
                    employeePhoneSnapshot: schedule.primaryEmployee.phone,
                    startDate: schedule.startDate,
                    endDate: schedule.endDate,
                },
            });
        }

        const scheduleIds = client.employeeSchedules.map((schedule) => schedule.id);
        if (scheduleIds.length > 0) {
            await Promise.all([
                db.service_record.updateMany({
                    where: { scheduleId: { in: scheduleIds } },
                    data: { serviceRecordCaseId: record.id },
                }),
                db.service_record_token.updateMany({
                    where: { scheduleId: { in: scheduleIds } },
                    data: { serviceRecordCaseId: record.id },
                }),
                db.eformsign_doc.updateMany({
                    where: {
                        employeeScheduleId: { in: scheduleIds },
                        documentKind: "service_record_snapshot",
                    },
                    data: { serviceRecordCaseId: record.id },
                }),
            ]);
            await this.linkLegacyDays(record.id, client.employeeSchedules, db);
        }

        if (endDateChanged && finalizationDueAt) {
            await db.service_record_token.updateMany({
                where: {
                    serviceRecordCaseId: record.id,
                    active: true,
                    revokedAt: null,
                },
                data: { expiresAt: finalizationDueAt },
            });
        }

        return this.recompute(record.id, tx);
    }

    async validatePeriodChange(params: {
        clientId: number;
        startDate?: Date | null;
        endDate?: Date | null;
        duration?: number | null;
        now?: Date;
    }, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prisma;
        const record = await db.service_record_case.findUnique({
            where: { clientId: params.clientId },
            include: {
                days: { select: { serviceDate: true, locked: true } },
            },
        });
        if (!record) return;
        const now = params.now ?? new Date();

        if (IMMUTABLE_FINALIZATION_STATUSES.has(record.status)) {
            const dateChanged = (
                params.startDate !== undefined && isoDate(params.startDate) !== isoDate(record.startDate)
            ) || (
                params.endDate !== undefined && isoDate(params.endDate) !== isoDate(record.endDate)
            ) || (
                params.duration !== undefined && params.duration !== record.requiredSessionCount
            );
            if (dateChanged) {
                throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
            }
        }

        if (
            params.startDate !== undefined
            && isoDate(params.startDate) !== isoDate(record.startDate)
            && (record.days.length > 0 || (record.startDate && todayKst(now) >= isoDate(record.startDate)!))
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_START_DATE_LOCKED" });
        }

        if (params.endDate === null && record.days.length > 0) {
            throw new ConflictException({ code: "SERVICE_RECORD_END_DATE_REQUIRED" });
        }
        if (params.duration === null && record.days.length > 0) {
            throw new ConflictException({ code: "SERVICE_RECORD_DURATION_REQUIRED" });
        }
        if (
            params.duration !== undefined
            && params.duration !== null
            && record.requiredSessionCount !== null
            && params.duration < record.requiredSessionCount
            && record.days.length > 0
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_DURATION_CANNOT_DECREASE" });
        }
    }

    async syncEndDateFromContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
    }): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await this.syncEndDateFromContractInTransaction(params, tx);
        });
    }

    async syncEndDateFromMirroredContract(params: {
        branchId: string;
        clientId: number;
        endDate: Date;
        documentId: string;
        detailSourceUpdatedDate: Date;
        detailSyncedAt: Date;
    }): Promise<boolean> {
        return await this.prisma.$transaction(async (tx) => {
            const current = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
                SELECT id
                FROM eformsign_doc
                WHERE document_id = ${params.documentId}
                  AND branch_id = ${params.branchId}::uuid
                  AND detail_source_updated_date = ${params.detailSourceUpdatedDate}
                  AND detail_synced_at = ${params.detailSyncedAt}
                  AND sync_status = 'ready'
                  AND permanent_purge_requested_at IS NULL
                  AND EXISTS (
                      SELECT 1
                      FROM eformsign_doc_file AS document_file
                      WHERE document_file.eformsign_doc_id = eformsign_doc.id
                        AND document_file.file_type = 'document'
                        AND document_file.source_updated_date
                          = eformsign_doc.detail_source_updated_date
                  )
                  AND EXISTS (
                      SELECT 1
                      FROM eformsign_doc_file AS audit_trail_file
                      WHERE audit_trail_file.eformsign_doc_id = eformsign_doc.id
                        AND audit_trail_file.file_type = 'audit_trail'
                        AND audit_trail_file.source_updated_date
                          = eformsign_doc.detail_source_updated_date
                  )
                FOR UPDATE
            `);
            if (current.length !== 1) {
                return false;
            }

            await this.syncEndDateFromContractInTransaction(params, tx);
            return true;
        });
    }

    async completeServiceRecordSnapshotIfReady(params: {
        branchId: string;
        documentId: string;
        mirrorVersion?: {
            detailSourceUpdatedDate: Date;
            detailSyncedAt: Date;
        };
    }): Promise<boolean> {
        return this.prisma.$transaction(async (tx) =>
            this.completeServiceRecordSnapshotIfReadyInTransaction(params, tx));
    }

    private async completeServiceRecordSnapshotIfReadyInTransaction(
        params: {
            branchId: string;
            documentId: string;
            mirrorVersion?: {
                detailSourceUpdatedDate: Date;
                detailSyncedAt: Date;
            };
        },
        tx: Prisma.TransactionClient,
    ): Promise<boolean> {
        const trigger = await tx.eformsign_doc.findFirst({
            where: {
                branchId: params.branchId,
                documentId: params.documentId,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                serviceRecordCaseId: { not: null },
            },
            select: { serviceRecordCaseId: true },
        });
        if (!trigger?.serviceRecordCaseId) return false;

        const cases = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id
            FROM service_record_case
            WHERE id = ${trigger.serviceRecordCaseId}::uuid
              AND branch_id = ${params.branchId}::uuid
              AND status = ${SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED}
            FOR UPDATE
        `);
        if (cases.length !== 1) return false;

        const snapshots = await tx.$queryRaw<LockedServiceRecordSnapshot[]>(Prisma.sql`
            SELECT
                id,
                document_id AS "documentId",
                branch_id AS "branchId",
                document_kind AS "documentKind",
                status_type AS "statusType",
                detail_payload AS "detailPayload",
                detail_source_updated_date AS "detailSourceUpdatedDate",
                detail_synced_at AS "detailSyncedAt",
                sync_status AS "syncStatus",
                permanent_purge_requested_at AS "permanentPurgeRequestedAt",
                EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS document_file
                    WHERE document_file.eformsign_doc_id = eformsign_doc.id
                      AND document_file.file_type = 'document'
                      AND document_file.source_updated_date
                        = eformsign_doc.detail_source_updated_date
                ) AS "hasCurrentDocumentPdf",
                EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS audit_trail_file
                    WHERE audit_trail_file.eformsign_doc_id = eformsign_doc.id
                      AND audit_trail_file.file_type = 'audit_trail'
                      AND audit_trail_file.source_updated_date
                        = eformsign_doc.detail_source_updated_date
                ) AS "hasCurrentAuditTrailPdf"
            FROM eformsign_doc
            WHERE branch_id = ${params.branchId}::uuid
              AND service_record_case_id = ${trigger.serviceRecordCaseId}::uuid
              AND document_kind = ${EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT}
            ORDER BY id ASC
            FOR UPDATE
        `);
        const lockedTrigger = snapshots.find((snapshot) =>
            snapshot.documentId === params.documentId
            && snapshot.branchId === params.branchId
            && snapshot.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
        );
        if (
            snapshots.length === 0
            || !lockedTrigger
            || !isCurrentMirrorSnapshotVersion(lockedTrigger, params.mirrorVersion)
            || snapshots.some((snapshot) =>
                !isReadyCurrentSnapshot(snapshot)
                || !EFORMSIGN_COMPLETED_STATUS_CODES.has(snapshot.statusType))
        ) return false;

        const completed = await tx.service_record_case.updateMany({
            where: {
                id: trigger.serviceRecordCaseId,
                branchId: params.branchId,
                status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.COMPLETED,
                documentsCompletedAt: new Date(),
                version: { increment: 1 },
            },
        });
        return completed.count === 1;
    }

    private async syncEndDateFromContractInTransaction(
        params: {
            branchId: string;
            clientId: number;
            endDate: Date;
        },
        tx: Prisma.TransactionClient,
    ): Promise<void> {
        await this.validatePeriodChange({
            clientId: params.clientId,
            endDate: params.endDate,
        }, tx);

        const updated = await tx.client.updateMany({
            where: {
                id: params.clientId,
                OR: [
                    { branchId: params.branchId },
                    { branchId: null },
                ],
            },
            data: { endDate: params.endDate },
        });
        if (updated.count !== 1) {
            throw new NotFoundException("Client not found for branch");
        }

        await this.ensureForClient(params.clientId, tx);
    }

    async recompute(serviceRecordCaseId: string, tx?: Prisma.TransactionClient) {
        const db = tx ?? this.prisma;
        const record = await db.service_record_case.findUnique({
            where: { id: serviceRecordCaseId },
            include: {
                assignments: { include: { schedule: { select: { replaced: true } } } },
                days: {
                    select: {
                        caseSessionIndex: true,
                        serviceDate: true,
                        locked: true,
                        momApproval: true,
                    },
                },
            },
        });
        if (!record) throw new NotFoundException("Service record not found");
        if (
            IMMUTABLE_FINALIZATION_STATUSES.has(record.status)
            || record.status === SERVICE_RECORD_CASE_STATUS.MIGRATION_REVIEW_REQUIRED
            || record.status === SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED
        ) {
            return record;
        }

        const required = requiredSessionCount({
            startDate: record.startDate,
            endDate: record.endDate,
            fallback: record.requiredSessionCount,
        }) ?? 0;
        const inPeriodDays = record.days.filter((day) => (
            isWithinServicePeriod(day.serviceDate, record.startDate, record.endDate)
            && (day.caseSessionIndex === null || day.caseSessionIndex <= required)
        ));
        const submitted = inPeriodDays.filter((day) => day.locked && day.momApproval === "approved").length;
        const complete = required > 0
            && inPeriodDays.length === required
            && submitted === required
            && hasCompleteHeader(record);
        const now = new Date();
        const hasActiveAssignment = record.assignments.some((assignment) => assignment.schedule && !assignment.schedule.replaced);
        let status: ServiceRecordCaseStatus;

        if (!record.startDate || !record.endDate || required <= 0) {
            status = SERVICE_RECORD_CASE_STATUS.WAITING_FOR_DETAILS;
        } else if (!hasActiveAssignment) {
            status = SERVICE_RECORD_CASE_STATUS.WAITING_FOR_ASSIGNMENT;
        } else if (complete) {
            status = SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE;
        } else if (record.finalizationDueAt && record.finalizationDueAt <= now) {
            status = SERVICE_RECORD_CASE_STATUS.AWAITING_COMPLETION;
        } else if (isoDate(record.startDate)! > todayKst(now)) {
            status = SERVICE_RECORD_CASE_STATUS.SCHEDULED;
        } else {
            status = SERVICE_RECORD_CASE_STATUS.IN_PROGRESS;
        }

        return db.service_record_case.update({
            where: { id: record.id },
            data: {
                status,
                completedAt: complete ? (record.completedAt ?? now) : null,
                requiredSessionCount: required,
                version: { increment: 1 },
            },
        });
    }

    async markTerminated(clientId: number, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prisma;
        await db.service_record_case.updateMany({
            where: { clientId, status: { notIn: [...IMMUTABLE_FINALIZATION_STATUSES] } },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED,
                version: { increment: 1 },
            },
        });
    }

    private deriveBaseStatus(params: {
        startDate: Date | null;
        endDate: Date | null;
        duration: number | null;
        hasAssignment: boolean;
        terminated: boolean;
    }): ServiceRecordCaseStatus {
        if (params.terminated) return SERVICE_RECORD_CASE_STATUS.TERMINATED_REVIEW_REQUIRED;
        if (!params.startDate || !params.endDate || !params.duration || params.duration <= 0) {
            return SERVICE_RECORD_CASE_STATUS.WAITING_FOR_DETAILS;
        }
        if (!params.hasAssignment) return SERVICE_RECORD_CASE_STATUS.WAITING_FOR_ASSIGNMENT;
        return isoDate(params.startDate)! > todayKst(new Date())
            ? SERVICE_RECORD_CASE_STATUS.SCHEDULED
            : SERVICE_RECORD_CASE_STATUS.IN_PROGRESS;
    }

    private async linkLegacyDays(
        serviceRecordCaseId: string,
        schedules: Array<{
            id: number;
            startDate: Date;
            primaryEmployeeId: number;
            primaryEmployee: { name: string };
        }>,
        db: DbClient,
    ): Promise<void> {
        const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
        const scheduleIds = schedules.map((schedule) => schedule.id);
        const rows = await db.service_record_day.findMany({
            where: {
                scheduleId: { in: scheduleIds },
                OR: [
                    { serviceRecordCaseId: null },
                    { caseSessionIndex: null },
                    { employeeId: null },
                ],
            },
            orderBy: [
                { serviceDate: "asc" },
                { scheduleId: "asc" },
                { sessionIndex: "asc" },
                { createdAt: "asc" },
            ],
        });
        if (rows.length === 0) return;

        const currentMax = await db.service_record_day.aggregate({
            where: { serviceRecordCaseId, caseSessionIndex: { not: null } },
            _max: { caseSessionIndex: true },
        });
        let nextIndex = (currentMax._max.caseSessionIndex ?? 0) + 1;
        for (const row of rows) {
            const schedule = row.scheduleId ? scheduleById.get(row.scheduleId) : undefined;
            await db.service_record_day.update({
                where: { id: row.id },
                data: {
                    serviceRecordCaseId,
                    caseSessionIndex: row.caseSessionIndex ?? nextIndex++,
                    employeeId: row.employeeId ?? schedule?.primaryEmployeeId ?? null,
                    employeeNameSnapshot: row.employeeNameSnapshot ?? schedule?.primaryEmployee.name ?? null,
                },
            });
        }
    }
}
