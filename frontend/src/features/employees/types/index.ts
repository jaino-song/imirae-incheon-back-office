// Employee entity types

export type EmployeeStatus = 'available' | 'working' | 'unavailable';

export interface Employee {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string | null;
    status: EmployeeStatus;
}

export interface CreateEmployeeDto {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
}

export interface UpdateEmployeeDto {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
}

// Grade options
export const GRADE_OPTIONS = [
    { value: '프리미엄', label: '프리미엄' },
    { value: '베스트', label: '베스트' },
    { value: '스탠다드', label: '스탠다드' },
] as const;

export type Grade = typeof GRADE_OPTIONS[number]['value'];
