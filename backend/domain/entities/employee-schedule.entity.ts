export class EmployeeScheduleEntity {
    constructor(
        public readonly id: number,
        public readonly employeeId: number,
        public readonly workAddress: string,
        public startDate: Date,
        public endDate: Date,
        public replaced: boolean = false,
    ) {}
}