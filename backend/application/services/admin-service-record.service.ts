import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { message_log, message_trigger_job, Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { countBusinessDaysKr } from "domain/utils/business-days";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { MessageTriggerService } from "./message-trigger.service";
import { ServiceRecordSecurityEventService } from "./service-record-security-event.service";
import {
    AdminServiceRecordAssignmentDto,
    AdminServiceRecordCaseDto,
    AdminServiceRecordHeaderDto,
    AdminServiceRecordLinkDto,
    AdminServiceRecordLinkStatus,
    AdminServiceRecordOverviewDto,
    AdminServiceRecordPreparedLinkDto,
    AdminServiceRecordResetLinkDto,
    AdminServiceRecordSessionDto,
    AdminServiceRecordSignatureDocDto,
    AdminServiceRecordTokenDto,
    AdminServiceRecordTokenState,
} from "interface/dto/admin-service-record.dto";

type ScheduleForOverview = Prisma.employee_scheduleGetPayload<{
    include: {
        client: true;
        primaryEmployee: true;
        serviceRecord: true;
        serviceRecordDays: true;
        serviceRecordTokens: true;
    };
}>;
type CaseForOverview = Prisma.service_record_caseGetPayload<{
    include: { days: true };
}>;

type ServiceRecordLinkJob = message_trigger_job;
type ServiceRecordLinkLog = message_log;
type SignatureDocRow = Prisma.eformsign_docGetPayload<{
    select: {
        employeeScheduleId: true;
        documentId: true;
        statusDetail: true;
        stepName: true;
        createdDate: true;
        updatedDate: true;
        snapshotVersion: true;
        snapshotChunkIndex: true;
    };
}>;

export interface ServiceRecordAdminActor {
    userId: string;
    globalRole: string;
    branchRole: string;
}

function isoDate(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function servicePeriodSessionCount(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
    fallback: number | null,
): number {
    const startDateIso = isoDate(startDate);
    const endDateIso = isoDate(endDate);
    if (!startDateIso || !endDateIso) return fallback ?? 0;
    return countBusinessDaysKr(startDateIso, endDateIso) ?? fallback ?? 0;
}

@Injectable()
export class AdminServiceRecordService {
    private readonly logger = new Logger(AdminServiceRecordService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly serviceRecordLinkService: ServiceRecordLinkService,
        private readonly messageTriggerService: MessageTriggerService,
        @Optional() private readonly securityEventService?: ServiceRecordSecurityEventService,
    ) {}

    async getClientOverview(branchId: string, clientId: number): Promise<AdminServiceRecordOverviewDto> {
        const [record, schedules] = await Promise.all([
            this.prisma.service_record_case.findFirst({
                where: { branchId, clientId },
                include: { days: { orderBy: { caseSessionIndex: "asc" } } },
            }),
            this.prisma.employee_schedule.findMany({
                where: { branchId, clientId },
                include: {
                    client: true,
                    primaryEmployee: true,
                    serviceRecord: true,
                    serviceRecordDays: { orderBy: { sessionIndex: "asc" } },
                    serviceRecordTokens: {
                        where: {
                            OR: [
                                { active: true },
                                { revokedAt: { not: null } },
                            ],
                        },
                        orderBy: { createdAt: "desc" },
                    },
                },
                orderBy: { startDate: "desc" },
            }),
        ]);

        const scheduleIds = schedules.map((schedule) => schedule.id);
        const jobs = scheduleIds.length > 0 ? await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                employeeScheduleId: { in: scheduleIds },
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
            },
            orderBy: { createdAt: "desc" },
        }) : [];
        const jobIds = jobs.map((job) => job.id);
        const logs = scheduleIds.length > 0 ? await this.prisma.message_log.findMany({
            where: {
                branchId,
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                OR: [
                    ...(jobIds.length > 0 ? [{ triggerJobId: { in: jobIds } }] : []),
                    { clientId, triggerJobId: null },
                ],
            },
            orderBy: { createdAt: "desc" },
        }) : [];
        const signatureDocs = await this.findServiceRecordSignatureDocs(
            branchId,
            scheduleIds,
            record?.id ?? null,
        );
        const signatureDocByScheduleId = latestSignatureDocByScheduleId(signatureDocs);

        return {
            record: record ? this.mapCase(record, signatureDocs) : null,
            assignments: schedules.map((schedule) => this.mapAssignment(
                schedule,
                jobs.filter((job) => job.employeeScheduleId === schedule.id),
                logs.filter((log) => (
                    (log.triggerJobId !== null && jobIdsForSchedule(jobs, schedule.id).has(log.triggerJobId))
                    || (log.triggerJobId === null && logScheduleId(log) === schedule.id)
                )),
                signatureDocByScheduleId.get(schedule.id) ?? null,
            )),
        };
    }

    private mapCase(
        record: CaseForOverview,
        signatureDocs: SignatureDocRow[],
    ): AdminServiceRecordCaseDto {
        const header = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].some((value) => Boolean(value));
        return {
            id: record.id,
            status: record.status,
            startDate: record.startDate,
            endDate: record.endDate,
            totalSessions: servicePeriodSessionCount(
                record.startDate,
                record.endDate,
                record.requiredSessionCount,
            ),
            completedAt: record.completedAt,
            finalizationDueAt: record.finalizationDueAt,
            finalizedAt: record.finalizedAt,
            documentsCompletedAt: record.documentsCompletedAt,
            lastError: record.lastError,
            header: header ? {
                momName: record.momName,
                momBirth: record.momBirth,
                babyName: record.babyName,
                babyBirth: record.babyBirth,
                deliveryType: record.deliveryType,
                babyWeight: record.babyWeight,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
            } : null,
            sessions: record.days.map((session) => this.mapSession(session)),
            signatureDocs: signatureDocs.map((document) => this.mapSignatureDoc(document)),
        };
    }

    async prepareLink(
        branchId: string,
        scheduleId: number,
        recipientPhone?: string,
    ): Promise<AdminServiceRecordPreparedLinkDto> {
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        return this.serviceRecordLinkService.prepareLink(scheduleId, recipientPhone);
    }

    async resetLink(
        branchId: string,
        scheduleId: number,
        actor?: ServiceRecordAdminActor,
    ): Promise<AdminServiceRecordResetLinkDto> {
        if (this.securityEventService && !actor?.userId) {
            throw new ForbiddenException("Authenticated administrator required");
        }
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        const reset = await this.serviceRecordLinkService.resetLink(scheduleId);
        this.securityEventService?.emit({
            outcome: "link_reissued",
            actorUserId: actor?.userId,
            branchId,
            scheduleId,
        });
        return reset;
    }

    async sendLinkNow(
        branchId: string,
        scheduleId: number,
        preparedLinkToken?: string,
        recipientPhone?: string,
    ) {
        await this.assertScheduleBelongsToBranch(branchId, scheduleId);
        const queued = await this.serviceRecordLinkService.sendNow(
            scheduleId,
            preparedLinkToken,
            recipientPhone,
        );
        const dispatched = await this.messageTriggerService.dispatchPendingJobNow(queued.jobId);

        return {
            ok: dispatched.status === "sent",
            jobId: dispatched.id,
            status: dispatched.status,
            scheduledFor: queued.scheduledFor,
        };
    }

    private async assertScheduleBelongsToBranch(branchId: string, scheduleId: number): Promise<void> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId },
            select: { id: true },
        });
        if (!schedule) {
            throw new NotFoundException("Assignment not found");
        }
    }

    private mapAssignment(
        schedule: ScheduleForOverview,
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        signatureDoc: AdminServiceRecordSignatureDocDto | null,
    ): AdminServiceRecordAssignmentDto {
        return {
            scheduleId: schedule.id,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            replaced: schedule.replaced,
            employee: {
                id: schedule.primaryEmployee.id,
                name: schedule.primaryEmployee.name,
                phone: schedule.primaryEmployee.phone,
            },
            link: this.deriveLink(jobs, logs, schedule.serviceRecordTokens[0] ?? null),
            header: schedule.serviceRecord ? this.mapHeader(schedule.serviceRecord) : null,
            totalSessions: servicePeriodSessionCount(
                schedule.client.startDate ?? schedule.startDate,
                schedule.client.endDate ?? schedule.endDate,
                schedule.client.duration,
            ),
            sessions: schedule.serviceRecordDays.map((session) => this.mapSession(session)),
            signatureDoc,
        };
    }

    private deriveLink(
        jobs: ServiceRecordLinkJob[],
        logs: ServiceRecordLinkLog[],
        token: ScheduleForOverview["serviceRecordTokens"][number] | null,
    ): AdminServiceRecordLinkDto {
        const sentLogs = logs
            .filter((log) => log.status === "sent")
            .sort((left, right) => this.logActivityTime(right) - this.logActivityTime(left));
        const pendingJob = jobs.find((job) => job.status === "pending") ?? null;
        const newestLog = logs[0] ?? null;
        const newestJob = jobs[0] ?? null;
        const sentCount = sentLogs.length;
        let status: AdminServiceRecordLinkStatus = "none";
        let scheduledFor: Date | null = null;

        if (sentCount > 0) {
            status = "sent";
        } else if (pendingJob) {
            status = "scheduled";
            scheduledFor = pendingJob.scheduledFor;
        } else if (newestLog?.status === "failed") {
            status = "failed";
        } else if (newestJob?.status === "canceled") {
            status = "canceled";
        }

        return {
            status,
            scheduledFor,
            sentCount,
            lastSentAt: sentLogs[0]?.lastAttemptAt ?? sentLogs[0]?.createdAt ?? null,
            token: token ? this.mapToken(token) : null,
        };
    }

    private mapToken(token: ScheduleForOverview["serviceRecordTokens"][number]): AdminServiceRecordTokenDto {
        return {
            issuedAt: token.createdAt,
            verifiedAt: token.verifiedAt,
            expiresAt: token.expiresAt,
            state: this.getTokenState(token),
        };
    }

    private getTokenState(token: ScheduleForOverview["serviceRecordTokens"][number]): AdminServiceRecordTokenState {
        if (token.revokedAt) return "revoked";
        if (token.expiresAt.getTime() < Date.now()) return "expired";
        if (token.active) return "active";
        return "revoked";
    }

    private mapHeader(header: ScheduleForOverview["serviceRecord"]): AdminServiceRecordHeaderDto {
        return {
            momName: header?.momName ?? null,
            momBirth: header?.momBirth ?? null,
            babyName: header?.babyName ?? null,
            babyBirth: header?.babyBirth ?? null,
            deliveryType: header?.deliveryType ?? null,
            babyWeight: header?.babyWeight ?? null,
            createdAt: header?.createdAt ?? new Date(0),
            updatedAt: header?.updatedAt ?? new Date(0),
        };
    }

    private mapSession(session: ScheduleForOverview["serviceRecordDays"][number]): AdminServiceRecordSessionDto {
        return {
            sessionIndex: session.caseSessionIndex ?? session.sessionIndex,
            serviceDate: session.serviceDate,
            locked: session.locked,
            submittedAt: session.submittedAt,
            updatedAt: session.updatedAt,
            answers: session.answers,
            etcService: session.etcService,
            notes: session.notes,
            paymentConfirmed: session.paymentConfirmed,
            hasMomApproval: Boolean(session.momApproval),
            employeeId: session.employeeId,
            employeeName: session.employeeNameSnapshot,
            formVersion: session.formVersion,
        };
    }

    private mapSignatureDoc(document: SignatureDocRow): AdminServiceRecordSignatureDocDto {
        return {
            documentId: document.documentId,
            statusDetail: document.statusDetail,
            stepName: document.stepName,
            createdDate: document.createdDate,
            updatedDate: document.updatedDate,
            snapshotVersion: document.snapshotVersion,
            snapshotChunkIndex: document.snapshotChunkIndex,
            employeeScheduleId: document.employeeScheduleId,
        };
    }

    private logActivityTime(log: ServiceRecordLinkLog): number {
        return (log.lastAttemptAt ?? log.createdAt).getTime();
    }

    private async findServiceRecordSignatureDocs(
        branchId: string,
        scheduleIds: number[],
        serviceRecordCaseId: string | null,
    ): Promise<SignatureDocRow[]> {
        try {
            return await this.prisma.eformsign_doc.findMany({
                where: {
                    branchId,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
                    OR: [
                        ...(serviceRecordCaseId ? [{ serviceRecordCaseId }] : []),
                        ...(scheduleIds.length > 0 ? [{ employeeScheduleId: { in: scheduleIds } }] : []),
                    ],
                },
                select: {
                    employeeScheduleId: true,
                    documentId: true,
                    statusDetail: true,
                    stepName: true,
                    createdDate: true,
                    updatedDate: true,
                    snapshotVersion: true,
                    snapshotChunkIndex: true,
                },
                orderBy: [
                    { employeeScheduleId: "asc" },
                    { updatedDate: "desc" },
                    { createdDate: "desc" },
                ],
            });
        } catch (error) {
            if (!isPendingEformsignServiceRecordColumnError(error)) {
                throw error;
            }

            this.logger.warn(
                "Skipping service-record signature docs because eformsign_doc service-record columns are not migrated yet.",
            );
            return [];
        }
    }
}

function isPendingEformsignServiceRecordColumnError(error: unknown): boolean {
    const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "P2022") {
        return true;
    }

    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${message} ${typeof column === "string" ? column : ""}`;
    return /document_kind|employee_schedule_id|template_id|service_record_case_id|snapshot_version|snapshot_chunk_index|documentKind|employeeScheduleId|templateId|serviceRecordCaseId|snapshotVersion|snapshotChunkIndex/i.test(haystack);
}

function jobIdsForSchedule(jobs: ServiceRecordLinkJob[], scheduleId: number): Set<string> {
    return new Set(
        jobs
            .filter((job) => job.employeeScheduleId === scheduleId)
            .map((job) => job.id),
    );
}

/** Permanent-failure logs carry no trigger job; their scheduleId lives only in the variables payload. */
function logScheduleId(log: ServiceRecordLinkLog): number | null {
    const variables = log.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
    const raw = (variables as Record<string, unknown>)["scheduleId"];
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN;
    return Number.isNaN(parsed) ? null : parsed;
}

function latestSignatureDocByScheduleId(docs: SignatureDocRow[]): Map<number, AdminServiceRecordSignatureDocDto> {
    const byScheduleId = new Map<number, AdminServiceRecordSignatureDocDto>();
    for (const doc of docs) {
        if (doc.employeeScheduleId === null || byScheduleId.has(doc.employeeScheduleId)) continue;
        byScheduleId.set(doc.employeeScheduleId, {
            ...mapSignatureDocRow(doc),
        });
    }
    return byScheduleId;
}

function mapSignatureDocRow(doc: SignatureDocRow): AdminServiceRecordSignatureDocDto {
    return {
        documentId: doc.documentId,
        statusDetail: doc.statusDetail,
        stepName: doc.stepName,
        createdDate: doc.createdDate,
        updatedDate: doc.updatedDate,
        snapshotVersion: doc.snapshotVersion,
        snapshotChunkIndex: doc.snapshotChunkIndex,
        employeeScheduleId: doc.employeeScheduleId,
    };
}
