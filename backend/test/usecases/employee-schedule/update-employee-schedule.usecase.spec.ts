import { UpdateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/update-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("UpdateEmployeeScheduleUsecase", () => {
    it("reads and persists the update through the supplied transaction", async () => {
        const transaction = {};
        const existing = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "서울",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-31T00:00:00.000Z"),
            false,
        );
        const updated = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "부산",
            new Date("2026-08-02T00:00:00.000Z"),
            new Date("2026-09-01T00:00:00.000Z"),
            true,
        );
        const repository = {
            findById: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(updated),
        };
        const usecase = new UpdateEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute("branch-1", 72, {
            workAddress: "부산",
            startDate: new Date("2026-08-02T00:00:00.000Z"),
            endDate: new Date("2026-09-01T00:00:00.000Z"),
            replaced: true,
        }, transaction as never)).resolves.toBe(updated);

        expect(repository.findById).toHaveBeenCalledWith("branch-1", 72, transaction);
        expect(repository.update).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                id: 72,
                clientId: 31,
                workAddress: "부산",
                startDate: new Date("2026-08-02T00:00:00.000Z"),
                endDate: new Date("2026-09-01T00:00:00.000Z"),
                replaced: true,
            }),
            transaction,
        );
    });
});
