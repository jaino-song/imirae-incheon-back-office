import {
    EmployeeScheduleDateRangeError,
    EmployeeScheduleEntity,
    EmployeeScheduleRoleError,
} from "domain/entities/employee-schedule.entity";

const validDates = {
    start: new Date("2026-08-01T00:00:00.000Z"),
    end: new Date("2026-08-31T00:00:00.000Z"),
};

describe("EmployeeScheduleEntity invariants", () => {
    it("rejects an inverted date range", () => {
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            null,
            "서울",
            validDates.end,
            validDates.start,
        )).toThrow(EmployeeScheduleDateRangeError);
    });

    it("allows an equal one-day range", () => {
        const date = new Date("2026-08-01T00:00:00.000Z");
        expect(() => new EmployeeScheduleEntity(1, 10, 20, null, "서울", date, date)).not.toThrow();
    });

    it("rejects assigning one employee to both roles", () => {
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            20,
            "서울",
            validDates.start,
            validDates.end,
        )).toThrow(EmployeeScheduleRoleError);
    });
});
