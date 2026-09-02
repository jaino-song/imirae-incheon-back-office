import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    assertNoActiveEmployeeScheduleOverlap,
    EMPLOYEE_SCHEDULE_OVERLAP_CODE,
    lockClientForScheduleWrite,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";
import { addBusinessDaysKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SaveServiceHeaderDto, UpsertSessionDto } from "interface/dto/service-record-entry.dto";

import {
    ServiceRecordTokenService,
    ServiceRecordTokenContext,
    VerifyPhoneResult,
} from "./service-record-token.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "./service-record-lifecycle.service";

const MAX_ANSWERS_BYTES = 16 * 1024;
const ANSWER_KEYS = new Set([
    "perineum",
    "breast",
    "excretion",
    "sitzBath",
    "meals_meal",
    "meals_snack",
    "temperature_temp",
    "sleep",
    "breastFeeding_count",
    "formulaFeeding_count",
    "formulaFeeding_ml",
    "stool",
    "stool_color",
    "bath",
]);

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * No-login 제공기록지 capture (BJJ-247). The phone challenge is public (link token);
 * everything else runs behind ServiceRecordGuard, which supplies the assignment context.
 */
@Injectable()
export class ServiceRecordEntryService {
    private readonly logger = new Logger(ServiceRecordEntryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly lifecycleService: ServiceRecordLifecycleService,
    ) {}

    /** Is this SMS link still usable (before asking for the phone number)? No PII returned. */
    async linkStatus(linkToken: string): Promise<{ valid: boolean }> {
        return { valid: Boolean(await this.tokenService.resolveLink(linkToken)) };
    }

    /** Phone challenge → mint access token (or report wrong/locked). */
    async verify(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        return this.tokenService.verifyPhoneAndMintAccess(linkToken, phone);
    }

    /** Full wizard context: header + existing sessions + how many sessions are contracted. */
    async getContext(ctx: ServiceRecordTokenContext) {
        const serviceRecordCase = await this.resolveCase(ctx);
        const [schedule, record, pendingScheduleChange] = await Promise.all([
            this.prisma.employee_schedule.findUnique({
                where: { id: ctx.scheduleId },
                include: {
                    client: true,
                    primaryEmployee: true,
                },
            }),
            this.prisma.service_record_case.findUnique({
                where: { id: serviceRecordCase.id },
                include: {
                    days: { orderBy: { caseSessionIndex: "asc" } },
                },
            }),
            this.prisma.schedule_change_request.findFirst({
                where: { scheduleId: ctx.scheduleId, status: "pending" },
                select: { id: true, sessionIndex: true, fromDate: true, toDate: true },
            }),
        ]);
        if (!schedule) throw new NotFoundException("Assignment not found");
        if (!record) throw new NotFoundException("Service record not found");

        return {
            employee: { id: schedule.primaryEmployee.id, name: schedule.primaryEmployee.name },
            client: { id: schedule.client.id, name: schedule.client.name },
            totalSessions: record.requiredSessionCount ?? 0,
            startDate: record.startDate,
            endDate: record.endDate,
            recordStatus: record.status,
            completedAt: record.completedAt,
            finalizationDueAt: record.finalizationDueAt,
            finalizedAt: record.finalizedAt,
            header: this.headerFromCase(record),
            sessions: record.days.map((day) => ({
                ...day,
                sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            })),
            pendingScheduleChange: pendingScheduleChange
                ? {
                    id: pendingScheduleChange.id,
                    sessionIndex: pendingScheduleChange.sessionIndex,
                    fromDate: toIso(pendingScheduleChange.fromDate),
                    toDate: toIso(pendingScheduleChange.toDate),
                }
                : null,
        };
    }

    /** Upsert the one-time service header. */
    async saveHeader(ctx: ServiceRecordTokenContext, dto: SaveServiceHeaderDto) {
        const record = await this.resolveCase(ctx);
        const lockedCount = await this.prisma.service_record_day.count({
            where: { serviceRecordCaseId: record.id, locked: true },
        });
        if (lockedCount > 0) {
            throw new ConflictException({ code: "SERVICE_RECORD_HEADER_LOCKED" });
        }
        if ([
            SERVICE_RECORD_CASE_STATUS.FINALIZING,
            SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
            SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
            SERVICE_RECORD_CASE_STATUS.COMPLETED,
        ].includes(record.status as never)) {
            throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const aggregate = await tx.service_record_case.update({
                where: { id: record.id },
                data: { ...dto, version: { increment: 1 } },
            });
            await tx.service_record.upsert({
                where: { scheduleId: ctx.scheduleId },
                create: {
                    branchId: ctx.branchId,
                    scheduleId: ctx.scheduleId,
                    serviceRecordCaseId: record.id,
                    ...dto,
                },
                update: { serviceRecordCaseId: record.id, ...dto },
            });
            await this.lifecycleService.recompute(record.id, tx);
            return aggregate;
        });
        return this.headerFromCase(updated);
    }

    /**
     * Create/update one session record. Sessions are filled in order; submitted sessions
     * are immutable after client approval and locking.
     */
    async upsertSession(ctx: ServiceRecordTokenContext, sessionIndex: number, dto: UpsertSessionDto, lock: boolean) {
        const aggregate = await this.resolveCase(ctx);
        const answers = this.validateAnswers(dto.answers ?? {});
        const saved = await this.prisma.$transaction(async (tx) => {
            // Serialize all entry writes for this case before reading a session snapshot.
            // Otherwise a draft can write stale unlocked data after a submission commits.
            const lockedCases = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
                SELECT "id"
                FROM "service_record_case"
                WHERE "id" = ${aggregate.id}::uuid
                  AND "branch_id" = ${ctx.branchId}::uuid
                FOR UPDATE
            `);
            if (lockedCases.length !== 1) {
                throw new NotFoundException("Service record not found");
            }

            const [initialRecord, schedule] = await Promise.all([
                tx.service_record_case.findUnique({ where: { id: aggregate.id } }),
                tx.employee_schedule.findUnique({
                    where: { id: ctx.scheduleId },
                    include: { primaryEmployee: true },
                }),
            ]);
            let record = initialRecord;
            if (!record) throw new NotFoundException("Service record not found");
            if (!schedule) throw new NotFoundException("Assignment not found");
            if ([
                SERVICE_RECORD_CASE_STATUS.FINALIZING,
                SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                SERVICE_RECORD_CASE_STATUS.COMPLETED,
            ].includes(record.status as never)) {
                throw new ConflictException({ code: "SERVICE_RECORD_FINALIZED" });
            }

            const total = record.requiredSessionCount ?? 0;
            if (sessionIndex < 1 || sessionIndex > total) {
                throw new BadRequestException(`Session ${sessionIndex} is outside the contracted range 1..${total}`);
            }
            const serviceDate = new Date(dto.serviceDate);
            if (Number.isNaN(serviceDate.getTime())) {
                throw new BadRequestException("Invalid service date");
            }
            if (record.startDate && serviceDate < record.startDate) {
                throw new BadRequestException("Service date cannot precede the service start date.");
            }

            // A postponed session (a later serviceDate than originally
            // scheduled) can push the remaining sessions past the current
            // end date. requiredSessionCount stays fixed; the end date
            // extends automatically so the case can still fit every
            // session, no admin approval needed.
            const serviceDateIso = toIso(serviceDate);
            const currentEndIso = record.endDate ? toIso(record.endDate) : null;
            let requiredEndIso: string;
            try {
                requiredEndIso = addBusinessDaysKr(serviceDateIso, total - sessionIndex);
            } catch {
                throw new BadRequestException("서비스 제공일자를 계산할 수 없습니다. 날짜를 확인해 주세요.");
            }
            if (currentEndIso && requiredEndIso > currentEndIso) {
                const newEndDate = new Date(`${requiredEndIso}T00:00:00.000Z`);
                await lockClientForScheduleWrite(tx, ctx.branchId, schedule.clientId);
                await lockEmployeesForScheduleWrite(tx, ctx.branchId, [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                ]);
                if (schedule.startDate) {
                    try {
                        await assertNoActiveEmployeeScheduleOverlap(tx, {
                            branchId: ctx.branchId,
                            clientId: schedule.clientId,
                            primaryEmployeeId: schedule.primaryEmployeeId,
                            secondaryEmployeeId: schedule.secondaryEmployeeId,
                            startDate: schedule.startDate,
                            endDate: newEndDate,
                            replaced: schedule.replaced,
                            excludeScheduleId: schedule.id,
                        });
                    } catch (error) {
                        if (error instanceof ConflictException) {
                            const response = error.getResponse();
                            const code = typeof response === "object" && response !== null && "code" in response
                                ? (response as { code?: unknown }).code
                                : undefined;
                            if (code === EMPLOYEE_SCHEDULE_OVERLAP_CODE) {
                                throw new ConflictException({
                                    code: EMPLOYEE_SCHEDULE_OVERLAP_CODE,
                                    message: "다음 배정 일정과 겹쳐 종료일을 연장할 수 없습니다. 관리자에게 문의해 주세요.",
                                });
                            }
                        }
                        throw error;
                    }
                }
                await tx.employee_schedule.update({
                    where: { id: schedule.id },
                    data: { endDate: newEndDate },
                });
                await tx.client.update({
                    where: { id: schedule.clientId },
                    data: { endDate: newEndDate },
                });
                await this.lifecycleService.ensureForClient(schedule.clientId, tx);
                await this.tokenService.extendExpiryForCase(
                    record.id,
                    getServiceRecordTokenExpiresAt(newEndDate),
                    tx,
                );
                this.logger.log(
                    `Service-record session ${sessionIndex} for case ${record.id} extended end date ${currentEndIso} -> ${requiredEndIso}`,
                );
                record = await tx.service_record_case.findUnique({ where: { id: record.id } }) ?? record;
            }

            if (record.endDate && serviceDate > record.endDate) {
                throw new BadRequestException("Service date cannot exceed the service end date.");
            }

            const existing = await tx.service_record_day.findUnique({
                where: {
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                    },
                },
            });
            if (existing?.locked) {
                throw new ConflictException({ code: "SERVICE_RECORD_SESSION_LOCKED" });
            }

            if (sessionIndex > 1) {
                const prev = await tx.service_record_day.findUnique({
                    where: {
                        serviceRecordCaseId_caseSessionIndex: {
                            serviceRecordCaseId: record.id,
                            caseSessionIndex: sessionIndex - 1,
                        },
                    },
                });
                if (!prev?.locked) {
                    throw new ConflictException(`Submit session ${sessionIndex - 1} before session ${sessionIndex}.`);
                }
                if (serviceDate < prev.serviceDate) {
                    throw new BadRequestException("Service date cannot precede the previous session's date.");
                }
            }

            if (lock) {
                if (dto.momApproval !== "approved") {
                    throw new BadRequestException("산모 확인 승인이 필요합니다.");
                }
                if (!this.hasCompleteHeader(record)) {
                    throw new BadRequestException("서비스 기본정보를 모두 입력해 주세요.");
                }
                if (!existing?.locked && !existing?.clientSignature && !dto.clientSignature) {
                    throw new BadRequestException({ code: "CLIENT_SIGNATURE_REQUIRED" });
                }
            }

            const submittedAt = lock ? new Date() : existing?.submittedAt ?? null;
            const data = {
                branchId: ctx.branchId,
                scheduleId: ctx.scheduleId,
                serviceRecordCaseId: record.id,
                caseSessionIndex: sessionIndex,
                employeeId: ctx.employeeId,
                employeeNameSnapshot: schedule.primaryEmployee.name,
                formVersion: record.formVersion,
                sessionIndex,
                serviceDate,
                answers: answers as Prisma.InputJsonValue,
                etcService: this.trimNullable(
                    dto.etcService,
                    SERVICE_RECORD_TEXT_LIMITS.etcService,
                ),
                notes: this.trimNullable(
                    dto.notes,
                    SERVICE_RECORD_TEXT_LIMITS.notes,
                ),
                paymentConfirmed: dto.paymentConfirmed ?? false,
                momApproval: dto.momApproval ?? null,
                locked: Boolean(existing?.locked || lock),
                submittedAt,
            };

            let row = await tx.service_record_day.upsert({
                where: {
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                    },
                },
                create: data,
                update: data,
            });
            if (lock && dto.clientSignature) {
                const clientSignedAt = new Date();
                const signatureWrite = await tx.service_record_day.updateMany({
                    where: {
                        serviceRecordCaseId: record.id,
                        caseSessionIndex: sessionIndex,
                        clientSignature: null,
                    },
                    data: {
                        clientSignature: dto.clientSignature,
                        clientSignedAt,
                    },
                });
                if (signatureWrite.count === 1) {
                    row = { ...row, clientSignature: dto.clientSignature, clientSignedAt };
                }
            }
            await this.lifecycleService.recompute(record.id, tx);
            return row;
        });
        if (lock) {
            this.logger.log(`Service-record session ${sessionIndex} submitted + locked for case ${aggregate.id}`);
        }
        return { ...saved, sessionIndex: saved.caseSessionIndex ?? saved.sessionIndex };
    }

    /** Backward-compatible completion acknowledgement. Snapshot creation is scheduler-owned. */
    async finalize(ctx: ServiceRecordTokenContext) {
        const record = await this.resolveCase(ctx);
        const updated = await this.lifecycleService.recompute(record.id);
        const documentIds = await this.prisma.eformsign_doc.findMany({
            where: { serviceRecordCaseId: record.id, documentKind: "service_record_snapshot" },
            select: { documentId: true },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        return {
            status: updated.status,
            completedAt: updated.completedAt,
            finalizationDueAt: updated.finalizationDueAt,
            finalizedAt: updated.finalizedAt,
            chunkCount: documentIds.length,
            documentIds: documentIds.map((document) => document.documentId),
        };
    }

    private async resolveCase(ctx: ServiceRecordTokenContext) {
        if (ctx.serviceRecordCaseId) {
            const record = await this.prisma.service_record_case.findFirst({
                where: { id: ctx.serviceRecordCaseId, branchId: ctx.branchId },
            });
            if (record) return record;
        }
        const record = await this.lifecycleService.ensureForSchedule(ctx.scheduleId);
        if (!record || record.branchId !== ctx.branchId) {
            throw new NotFoundException("Service record not found");
        }
        return record;
    }

    private headerFromCase(record: {
        momName: string | null;
        momBirth: string | null;
        babyName: string | null;
        babyBirth: string | null;
        deliveryType: string | null;
        babyWeight: string | null;
        createdAt: Date;
        updatedAt: Date;
    }) {
        const hasValue = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].some((value) => Boolean(value));
        if (!hasValue) return null;
        return {
            momName: record.momName,
            momBirth: record.momBirth,
            babyName: record.babyName,
            babyBirth: record.babyBirth,
            deliveryType: record.deliveryType,
            babyWeight: record.babyWeight,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        };
    }

    private hasCompleteHeader(record: {
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

    private validateAnswers(raw: Record<string, unknown>): Record<string, unknown> {
        if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_ANSWERS_BYTES) {
            throw new BadRequestException("제공기록 입력값이 너무 큽니다.");
        }
        const answers: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (["etcService", "notes", "paymentConfirmed"].includes(key)) continue;
            if (!ANSWER_KEYS.has(key)) {
                throw new BadRequestException(`Unknown service-record field: ${key}`);
            }
            if (Array.isArray(value)) {
                if (value.length > 8 || value.some((item) => typeof item !== "string" || item.length > 80)) {
                    throw new BadRequestException(`Invalid service-record field: ${key}`);
                }
                answers[key] = value;
                continue;
            }
            if (!["string", "number", "boolean"].includes(typeof value) || (typeof value === "string" && value.length > 500)) {
                throw new BadRequestException(`Invalid service-record field: ${key}`);
            }
            answers[key] = value;
        }
        return answers;
    }

    private trimNullable(value: string | null | undefined, maxLength: number): string | null {
        if (value !== null && value !== undefined && value.length > maxLength) {
            throw new BadRequestException(`입력값은 ${maxLength}자를 넘을 수 없습니다.`);
        }
        const normalized = value?.trim();
        if (!normalized) return null;
        return normalized;
    }
}
