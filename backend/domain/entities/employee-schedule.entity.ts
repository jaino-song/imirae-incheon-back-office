export class EmployeeScheduleEntity {
    constructor(
        public readonly id: number,
        public readonly employeeId: number,
        public readonly workAddress: string,
        public startDate: Date,
        public endDate: Date,
        public replaced: boolean = false,
    ) {}

    static create(
        employeeId: number,
        workAddress: string,
        startDate: Date,
        endDate: Date,
        replaced = false,
    ): EmployeeScheduleEntity {
        return new EmployeeScheduleEntity(0, employeeId, workAddress, startDate, endDate, replaced);
    }
}