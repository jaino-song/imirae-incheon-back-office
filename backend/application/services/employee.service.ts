import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListActiveClientsByEmployeeUsecase,
    ListWorkHistoryByEmployeeUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";
import { EmployeeEntity } from "domain/entities/employee.entity";
import {
    ActiveClientByEmployee,
    EMPLOYEE_REPOSITORY,
    IEmployeeRepository,
    PaginatedEmployeeWorkHistory,
} from "domain/repositories/employee.repository.interface";
import { assertRequiredPhone, INVALID_PHONE_MESSAGE, InvalidPhoneError, normalizePhone } from "application/utils/normalize-phone";
import { MessageAutomationIntentService } from "./message-automation-intent.service";
import { MessageTriggerService } from "./message-trigger.service";

const EMPLOYEE_BRANCH_PHONE_UNIQUE_CONSTRAINT = "employee_branch_id_phone_normalized_key";

function assertEmployeePhoneInput(phone: string | null | undefined): string {
    try {
        return assertRequiredPhone(phone);
    } catch (error) {
        if (error instanceof InvalidPhoneError) {
            throw new BadRequestException(INVALID_PHONE_MESSAGE);
        }
        throw error;
    }
}

export type EmployeeUpdateParams = {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
    birthday?: string;
};

@Injectable()
export class EmployeeService {
    private readonly logger = new Logger(EmployeeService.name);

    constructor(
        private readonly createEmployeeUsecase: CreateEmployeeUsecase,
        private readonly findEmployeeByIdUsecase: FindEmployeeByIdUsecase,
        private readonly listActiveClientsByEmployeeUsecase: ListActiveClientsByEmployeeUsecase,
        private readonly listWorkHistoryByEmployeeUsecase: ListWorkHistoryByEmployeeUsecase,
        private readonly updateEmployeeUsecase: UpdateEmployeeUsecase,
        private readonly deleteEmployeeUsecase: DeleteEmployeeUsecase,
        private readonly listEmployeesUsecase: ListEmployeesUsecase,
        private readonly listEmployeesByWorkAreaUsecase: ListEmployeesByWorkAreaUsecase,
        private readonly listEmployeesByGradeUsecase: ListEmployeesByGradeUsecase,
        private readonly listEmployeesByOpenStatusUsecase: ListEmployeesByOpenStatusUsecase,
        private readonly listEmployeesByRegisteredDateUsecase: ListEmployeesByRegisteredDateUsecase,
        private readonly listEmployeesByRegisteredDateRangeUsecase: ListEmployeesByRegisteredDateRangeUsecase,
        private readonly changeEmployeeOpenStatusUsecase: ChangeEmployeeOpenStatusUsecase,
        private readonly listEmployeesOpenToNextWorkUsecase: ListEmployeesOpenToNextWorkUsecase,
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly messageAutomationIntentService?: MessageAutomationIntentService,
    ) {}

    async create(
        branchid: string,
        params: { name: string; workArea: string[]; phone: string; grade: string; openToNextWork: boolean; registeredDate?: string; birthday?: string }
    ): Promise<EmployeeEntity> {
        assertEmployeePhoneInput(params.phone);
        try {
            return await this.createEmployeeUsecase.execute(
                branchid,
                params.name,
                params.workArea,
                params.phone,
                normalizeEmployeeGrade(params.grade),
                params.openToNextWork,
                params.registeredDate ? new Date(params.registeredDate) : undefined,
                params.birthday,
            );
        } catch (error) {
            this.rethrowPhoneConflict(error);
        }
    }

    findById(branchid: string, id: number): Promise<EmployeeEntity | null> {
        return this.findEmployeeByIdUsecase.execute(branchid, id);
    }

    listActiveClients(branchid: string, id: number): Promise<ActiveClientByEmployee[]> {
        return this.listActiveClientsByEmployeeUsecase.execute(branchid, id);
    }

    listWorkHistory(
        branchid: string,
        id: number,
        page: number,
        limit: number,
    ): Promise<PaginatedEmployeeWorkHistory> {
        return this.listWorkHistoryByEmployeeUsecase.execute(branchid, id, page, limit);
    }

    async update(branchid: string, id: number, params: EmployeeUpdateParams): Promise<EmployeeEntity> {
        if (params.phone !== undefined) assertEmployeePhoneInput(params.phone);
        const profileSupplied = params.name !== undefined || params.phone !== undefined;

        let updatedEmployee: EmployeeEntity;
        try {
            updatedEmployee = await this.updateEmployeeUsecase.execute(branchid, id, {
                ...params,
                grade: params.grade === undefined ? undefined : normalizeEmployeeGrade(params.grade),
            });
        } catch (error) {
            this.rethrowPhoneConflict(error);
        }

        if (profileSupplied) await this.refreshEmployeeAssignmentJobs(branchid, id);

        return updatedEmployee;
    }

    delete(branchid: string, id: number): Promise<void> {
        return this.deleteEmployeeUsecase.execute(branchid, id);
    }

    findAll(branchid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesUsecase.execute(branchid);
    }

    findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByWorkAreaUsecase.execute(branchid, workArea);
    }

    findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByGradeUsecase.execute(branchid, normalizeEmployeeGrade(grade));
    }

    findByOpenStatus(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        return this.listEmployeesByOpenStatusUsecase.execute(branchid, openToNextWork);
    }

    findByRegisteredDate(branchid: string, date: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateUsecase.execute(branchid, date);
    }

    findByRegisteredDateRange(branchid: string, start: Date, end: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateRangeUsecase.execute(branchid, start, end);
    }

    changeOpenStatus(branchid: string, id: number, open: boolean): Promise<EmployeeEntity> {
        return this.changeEmployeeOpenStatusUsecase.execute(branchid, id, open);
    }

    findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesOpenToNextWorkUsecase.execute(branchid);
    }

    async checkPhoneExists(branchid: string, phone: string | null | undefined): Promise<boolean> {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) return false;

        // 소프트 삭제된 직원도 DB 유니크 제약 대상이므로 삭제 여부와 무관하게 조회한다.
        const existing = await this.employeeRepository.findByPhone(branchid, normalizedPhone);
        return existing !== null;
    }

    private rethrowPhoneConflict(error: unknown): never {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const metaTarget = error.meta?.["target"];
            if (metaTarget === EMPLOYEE_BRANCH_PHONE_UNIQUE_CONSTRAINT) {
                throw new ConflictException({ statusCode: 409, code: "P2002", error: "Conflict", field: "phone" });
            }
            const target = Array.isArray(metaTarget) ? metaTarget.map(String) : [];
            const hasPhone = target.includes("phone")
                || target.includes("phoneNormalized")
                || target.includes("phone_normalized");
            const hasBranch = target.includes("branch_id") || target.includes("branchId");
            if (hasPhone && hasBranch) {
                throw new ConflictException({ statusCode: 409, code: "P2002", error: "Conflict", field: "phone" });
            }
        }
        throw error;
    }

    private async refreshEmployeeAssignmentJobs(branchId: string, employeeId: number): Promise<void> {
        try {
            const refreshed = this.triggerService
                ? await this.triggerService.syncEmployeeAssignmentRulesForEmployee(branchId, employeeId)
                : false;
            if (refreshed !== false) return;
            await this.enqueueEmployeeRefresh(branchId, employeeId);
        } catch (error) {
            this.logger.error(
                `Failed to sync employee assignment triggers for employee ${employeeId}: ${error instanceof Error ? error.message : String(error)}`,
            );
            await this.enqueueEmployeeRefresh(branchId, employeeId);
        }
    }

    private async enqueueEmployeeRefresh(branchId: string, employeeId: number): Promise<void> {
        if (!this.messageAutomationIntentService) {
            this.logger.error(
                `Employee assignment refresh retry unavailable for employee ${employeeId}`,
            );
            return;
        }
        try {
            await this.messageAutomationIntentService.enqueueEmployeeProfileRefreshIntent({
                branchId,
                employeeId,
            });
        } catch (error) {
            this.logger.error(
                `Failed to persist employee assignment refresh retry for employee ${employeeId}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
