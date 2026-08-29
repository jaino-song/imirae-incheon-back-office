import { Injectable, Logger, Optional } from "@nestjs/common";
import {
    CreateEmployeeScheduleUsecase,
    DeleteEmployeeScheduleUsecase,
    FindEmployeeScheduleByIdUsecase,
    ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
    ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
    ListEmployeeSchedulesUsecase,
    UpdateEmployeeScheduleUsecase,
} from "application/usecases/employee-schedule";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageAutomationIntentService } from "./message-automation-intent.service";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";

@Injectable()
export class EmployeeScheduleService {
    private readonly logger = new Logger(EmployeeScheduleService.name);

    constructor(
        private readonly createEmployeeScheduleUsecase: CreateEmployeeScheduleUsecase,
        private readonly findEmployeeScheduleByIdUsecase: FindEmployeeScheduleByIdUsecase,
        private readonly listEmployeeSchedulesUsecase: ListEmployeeSchedulesUsecase,
        private readonly listEmployeeSchedulesByPrimaryEmployeeIdUsecase: ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
        private readonly listEmployeeSchedulesBySecondaryEmployeeIdUsecase: ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
        private readonly updateEmployeeScheduleUsecase: UpdateEmployeeScheduleUsecase,
        private readonly deleteEmployeeScheduleUsecase: DeleteEmployeeScheduleUsecase,
        private readonly prisma: PrismaService,
        private readonly messageAutomationIntentService: MessageAutomationIntentService,
        @Optional() private readonly serviceRecordLinkService?: ServiceRecordLinkService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
    ) {}

    async create(branchid: string, params: {
        clientId: number;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        const intentAt = new Date();
        const schedule = await this.prisma.$transaction(async (transaction) => {
            const created = await this.createEmployeeScheduleUsecase.execute(branchid, {
                clientId: params.clientId,
                primaryEmployeeId: params.primaryEmployeeId,
                secondaryEmployeeId: params.secondaryEmployeeId ?? null,
                workAddress: params.workAddress,
                startDate: new Date(params.startDate),
                endDate: new Date(params.endDate),
                replaced: params.replaced,
            }, transaction);
            await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                branchId: branchid,
                clientId: created.clientId,
                scheduleId: created.id,
                includePast: true,
                intentAt,
            });
            return created;
        });
        await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        await this.messageAutomationIntentService
            .fulfillScheduleIntent({
                branchId: branchid,
                scheduleId: schedule.id,
                includePast: true,
                intentAt,
            })
            .catch((error) => {
                this.logger.error(
                    `[MESSAGE_AUTOMATION_INTENT_FAILED] scheduleId=${schedule.id} — automatic retry pending`,
                    error instanceof Error ? error.stack : String(error),
                );
            });
        return schedule;
    }

    findAll(branchid: string): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesUsecase.execute(branchid);
    }

    findById(branchid: string, id: number): Promise<EmployeeScheduleEntity | null> {
        return this.findEmployeeScheduleByIdUsecase.execute(branchid, id);
    }

    findByPrimaryEmployeeId(
        branchid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesByPrimaryEmployeeIdUsecase.execute(
            branchid,
            primaryEmployeeId
        );
    }

    findBySecondaryEmployeeId(
        branchid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesBySecondaryEmployeeIdUsecase.execute(
            branchid,
            secondaryEmployeeId
        );
    }

    async update(branchid: string, id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        const intentAt = new Date();
        const schedule = await this.prisma.$transaction(async (transaction) => {
            const updated = await this.updateEmployeeScheduleUsecase.execute(branchid, id, {
                workAddress: params.workAddress,
                startDate: params.startDate ? new Date(params.startDate) : undefined,
                endDate: params.endDate ? new Date(params.endDate) : undefined,
                replaced: params.replaced,
            }, transaction);
            await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                branchId: branchid,
                clientId: updated.clientId,
                scheduleId: updated.id,
                includePast: true,
                intentAt,
                replaceExisting: true,
            });
            return updated;
        });
        await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        await this.messageAutomationIntentService
            .fulfillScheduleIntent({
                branchId: branchid,
                scheduleId: schedule.id,
                includePast: true,
                replaceExisting: true,
                intentAt,
            })
            .catch((error) => {
                this.logger.error(
                    `[MESSAGE_AUTOMATION_INTENT_FAILED] scheduleId=${schedule.id} — automatic retry pending`,
                    error instanceof Error ? error.stack : String(error),
                );
            });
        if (params.endDate) {
            this.serviceRecordLinkService
                ?.extendExpiryForEndDate(schedule.id, schedule.endDate)
                ?.catch((error) => {
                    this.logger.error(
                        `[SERVICE_RECORD_LINK_EXTEND_FAILED] scheduleId=${schedule.id} — 수동 확인 필요`,
                        error instanceof Error ? error.stack : String(error),
                    );
                });
        }
        return schedule;
    }

    async delete(branchid: string, id: number): Promise<void> {
        const schedule = await this.findEmployeeScheduleByIdUsecase.execute(branchid, id);
        await this.deleteEmployeeScheduleUsecase.execute(branchid, id);
        if (schedule) {
            await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        }
    }
}
