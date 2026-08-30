// Employee status type - active schedules take precedence over availability.
import { isoDateInKorea } from "domain/utils/business-days";
import { assertRequiredPhone, normalizePhone } from "domain/utils/normalize-phone";

export type EmployeeStatus = 'available' | 'working' | 'unavailable';

/**
 * `company_registered_date` is a PostgreSQL DATE. Represent today's Korean
 * calendar day at UTC midnight so Prisma round-trips the same calendar date
 * regardless of the backend process timezone.
 */
function currentRegistrationDate(): Date {
    return new Date(`${isoDateInKorea()}T00:00:00.000Z`);
}

/**
 * Derive current work status from the authoritative inputs. An active
 * assignment describes current work; availability only describes whether a
 * new assignment may be accepted when no work is active.
 */
export function deriveEmployeeStatus(
    hasActiveAssignment: boolean,
    openToNextWork: boolean,
): EmployeeStatus {
    if (hasActiveAssignment) return 'working';
    return openToNextWork ? 'available' : 'unavailable';
}

export class EmployeeEntity {
    // Computed status field (not persisted, set by repository); an active
    // assignment is working even when openToNextWork is false.
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
        /** Canonical identity key; display formatting remains in `phone`. */
        public phoneNormalized: string | null = normalizePhone(phone),
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
        if (phone !== undefined) {
            const phoneNormalized = assertRequiredPhone(phone);
            this.phone = phone;
            this.phoneNormalized = phoneNormalized;
        }
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
        const phoneNormalized = assertRequiredPhone(phone);
        return new EmployeeEntity(
            0,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate === undefined ? currentRegistrationDate() : registeredDate,
            birthday,
            undefined,
            phoneNormalized,
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
        phoneNormalized?: string | null,
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
            phoneNormalized,
        );
    }
}
