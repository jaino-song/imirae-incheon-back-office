import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";

describe("SbEmployeeScheduleRepository.delete", () => {
    const branchId = "00000000-0000-0000-0000-000000000001";
    const scheduleId = 41;

    function createHarness({
        locked = [{ id: scheduleId }],
        dependencies = [{ count: 0 }],
        deleted = { count: 1 },
    } = {}) {
        const scheduleModel = { deleteMany: jest.fn().mockResolvedValue(deleted) };
        const queryRaw = jest.fn()
            .mockResolvedValueOnce(locked)
            .mockResolvedValueOnce(dependencies);
        const transaction = { employee_schedule: scheduleModel, $queryRaw: queryRaw };
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
        };
        return { repository: new SbEmployeeScheduleRepository(prisma as never), scheduleModel, queryRaw };
    }

    it("locks the branch-owned schedule, checks dependencies, then deletes", async () => {
        const harness = createHarness();

        await harness.repository.delete(branchId, scheduleId);

        expect(harness.queryRaw).toHaveBeenCalledTimes(2);
        expect(harness.scheduleModel.deleteMany).toHaveBeenCalledWith({
            where: { id: scheduleId, branchId },
        });
    });

    it("does not delete when a retained dependency is present", async () => {
        const harness = createHarness({ dependencies: [{ count: 1 }] });

        const error = await harness.repository.delete(branchId, scheduleId).catch((caught) => caught);

        expect(error).toMatchObject({
            code: SCHEDULE_RETENTION_BLOCKED,
        });
        expect(error).toBeInstanceOf(RetentionDeleteBlockedError);
        expect(harness.scheduleModel.deleteMany).not.toHaveBeenCalled();
    });

    it("does not delete a schedule outside the requested branch", async () => {
        const harness = createHarness({ locked: [] });

        await expect(harness.repository.delete(branchId, scheduleId)).rejects.toBeInstanceOf(ScopedDeleteNotFoundError);
        expect(harness.scheduleModel.deleteMany).not.toHaveBeenCalled();
    });

    it("treats a concurrent delete result as a missing scoped row", async () => {
        const harness = createHarness({ deleted: { count: 0 } });

        await expect(harness.repository.delete(branchId, scheduleId)).rejects.toBeInstanceOf(ScopedDeleteNotFoundError);
    });
});
