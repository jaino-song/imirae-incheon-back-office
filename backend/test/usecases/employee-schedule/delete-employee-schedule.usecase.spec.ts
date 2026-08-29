import { ConflictException, NotFoundException } from "@nestjs/common";

import { DeleteEmployeeScheduleUsecase } from "application/usecases/employee-schedule/delete-employee-schedule.usecase";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("DeleteEmployeeScheduleUsecase", () => {
    const branchId = "branch-a";
    const schedule = new EmployeeScheduleEntity(
        7,
        21,
        3,
        null,
        "Seoul",
        new Date("2099-01-02T00:00:00.000Z"),
        new Date("2099-01-08T00:00:00.000Z"),
    );

    it("deletes an existing schedule through the repository", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await usecase.execute(branchId, schedule.id);

        expect(repository.findById).toHaveBeenCalledWith(branchId, schedule.id);
        expect(repository.delete).toHaveBeenCalledWith(branchId, schedule.id);
    });

    it("returns a stable 409 when the repository reports retained data", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockRejectedValue(
                new RetentionDeleteBlockedError(SCHEDULE_RETENTION_BLOCKED, SCHEDULE_RETENTION_BLOCKED_MESSAGE),
            ),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        const error = await usecase.execute(branchId, schedule.id).catch((caught) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({
            code: SCHEDULE_RETENTION_BLOCKED,
            message: SCHEDULE_RETENTION_BLOCKED_MESSAGE,
        });
    });

    it("maps a race where the locked row disappears to 404", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockRejectedValue(new ScopedDeleteNotFoundError("schedule", schedule.id)),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        const error = await usecase.execute(branchId, schedule.id).catch((caught) => caught);

        expect(error).toMatchObject({
            status: 404,
            message: `Employee schedule with id ${schedule.id} not found`,
        });
        expect(error).toBeInstanceOf(NotFoundException);
    });

    it("does not call delete when the schedule is absent in the requested branch", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute(branchId, schedule.id)).rejects.toBeInstanceOf(NotFoundException);
        expect(repository.delete).not.toHaveBeenCalled();
    });
});
