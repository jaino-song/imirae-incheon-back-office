export class EmployeeEntity {
    constructor(
        public readonly id: number,
        public name: string,
        public workArea: string,
        public phone: string,
        public grade: string,
        public openToNextWork: boolean,
        public registeredDate: Date,
    ) {}

    isOpenToNextWork(): boolean {
        return this.openToNextWork;
    }

    updateOpenToNextWork(openToNextWork: boolean): void {
        this.openToNextWork = openToNextWork;
    }

    updateProfile(
        name?: string,
        workArea?: string,
        phone?: string,
        grade?: string,
        openToNextWork?: boolean,
    ): void {
        this.name = name ?? this.name;
        this.workArea = workArea ?? this.workArea;
        this.phone = phone ?? this.phone;
        this.grade = grade ?? this.grade;
        this.openToNextWork = openToNextWork ?? this.openToNextWork;
    }

    static create(
        name: string,
        workArea: string,
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate?: Date,
    ): EmployeeEntity {
        return new EmployeeEntity(
            0,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate ?? new Date(),
        );
    }

    static fromPrisma(prismaData: { id: number, name: string, workArea: string, phone: string, grade: string, openToNextWork: boolean, registeredDate: Date }): EmployeeEntity {
        return new EmployeeEntity(
            prismaData.id,
            prismaData.name,
            prismaData.workArea,
            prismaData.phone,
            prismaData.grade,
            prismaData.openToNextWork,
            prismaData.registeredDate,
        );
    }

    // Prepare this entity into this shape to be saved to the database
    toPersistence(): { id: number, name: string, workArea: string, phone: string, grade: string, openToNextWork: boolean, registeredDate: Date } {
        return {
            id: this.id,
            name: this.name,
            workArea: this.workArea,
            phone: this.phone,
            grade: this.grade,
            openToNextWork: this.openToNextWork,
            registeredDate: this.registeredDate,
        };
    }
}