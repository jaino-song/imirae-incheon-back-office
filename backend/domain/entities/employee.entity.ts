// Employee status type - computed from openToNextWork and active schedules
export type EmployeeStatus = 'available' | 'working' | 'unavailable';

export class EmployeeEntity {
    // Computed status field (not persisted, set by repository)
    public status?: EmployeeStatus;

    constructor(
        public readonly id: number,
        public name: string,
        public workArea: string[],
        public phone: string,
        public grade: string,
        public openToNextWork: boolean,
        public registeredDate: Date | null,
        public birthday?: string,
        public readonly deletedAt?: Date,
    ) {}

    get isDeleted(): boolean {
        return this.deletedAt !== undefined;
    }

    isOpenToNextWork(): boolean {
        return this.openToNextWork;
    }

    updateOpenToNextWork(openToNextWork: boolean): void {
        this.openToNextWork = openToNextWork;
    }

    updateProfile(
        name?: string,
        workArea?: string[],
        phone?: string,
        grade?: string,
        openToNextWork?: boolean,
        birthday?: string,
    ): void {
        this.name = name ?? this.name;
        this.workArea = workArea ?? this.workArea;
        this.phone = phone ?? this.phone;
        this.grade = grade ?? this.grade;
        this.openToNextWork = openToNextWork ?? this.openToNextWork;
        this.birthday = birthday ?? this.birthday;
    }

    static create(
        name: string,
        workArea: string[],
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate?: Date | null,
        birthday?: string,
    ): EmployeeEntity {
        return new EmployeeEntity(
            0,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate ?? null,
            birthday,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        name: string,
        workArea: string[],
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate: Date | null,
        birthday?: string,
        deletedAt?: Date,
    ): EmployeeEntity {
        return new EmployeeEntity(
            id,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate,
            birthday,
            deletedAt,
        );
    }
}
