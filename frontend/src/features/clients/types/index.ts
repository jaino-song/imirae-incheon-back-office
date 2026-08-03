// Employee summary for client responses
export interface EmployeeSummary {
    id: number;
    name: string;
    phone?: string | null;
}

// Document status type for eformsign documents
export type DocumentStatus = 'created' | 'opened' | 'completed' | 'requested' | 'rejected' | 'revoked' | 'deleted' | null;

export type ClientBadgeKey = "contract_required" | "breast_pump" | "service_status" | "care_center";
export type ClientBadgeTone = "danger" | "success" | "primary" | "warning" | "neutral";
export type ClientBadgeStatus =
    | "active"
    | "preBooking"
    | "pending"
    | "review"
    | "scheduleChange"
    | "terminated"
    | "expired"
    | "completed"
    | "signed"
    | "breastPump"
    | "careCenter";

export interface ClientBadge {
    key: ClientBadgeKey;
    status: ClientBadgeStatus;
    label: string;
    tone: ClientBadgeTone;
    priority: number;
}

export interface PendingScheduleChange {
    id: string;
    sessionIndex: number;
    fromDate: string;
    toDate: string;
    oldEndDate: string;
    newEndDate: string;
}

// Client entity types
import type { ClientActionRequired } from "@babyjamjam/shared/types/client-action-required";

export type {
    ActionRequiredReason,
    ClientActionRequired,
} from "@babyjamjam/shared/types/client-action-required";

export interface Client {
    id: number;
    name: string;
    createdAt?: string | null;
    birthday: string | null;           // YYMMDD format
    dueDate: string | null;
    birthDate: string | null;
    address: string | null;
    phone: string | null;
    primaryEmployee: EmployeeSummary | null;  // Primary employee info from active schedule
    secondaryEmployee: EmployeeSummary | null; // Secondary employee info from active schedule
    type: string | null;               // voucher type
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: string | null;
    endDate: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus: ServiceStatus | null;      // Renamed from contractStatus
    eDocId: string | null;
    areaId?: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatus;    // eformsign document status: created/opened/completed
    badges?: ClientBadge[];
    actionRequired?: ClientActionRequired | null;
    pendingScheduleChange?: PendingScheduleChange | null;
}

// Create client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface CreateClientDto {
    name: string;
    birthday?: string | null;
    dueDate?: string | null;
    birthDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus?: ServiceStatus | null;
    applyMessageAutomation?: boolean;
    areaId?: string | null;
    source?: "contract_auto_registration";
    reuseExistingClient?: boolean;
}

export type ClientFormData = Omit<CreateClientDto, "primaryEmployeeId"> & { primaryEmployeeId: number | null };

// Update client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface UpdateClientDto {
    name?: string;
    birthday?: string | null;
    dueDate?: string | null;
    birthDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId?: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter?: boolean | null;
    areaId?: string | null;
    voucherClient?: boolean;
    breastPump?: boolean;
    serviceStatus?: ServiceStatus | null;
}

// DTO for terminating service
export interface TerminateServiceDto {
    reason?: string;
}

// DTO for requesting replacement
export interface RequestReplacementDto {
    newPrimaryEmployeeId: number;
    newSecondaryEmployeeId?: number | null;
}

// Paginated response
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Service status options (renamed from Contract status)
export const SERVICE_STATUS_OPTIONS = [
    { value: "pre_booking", label: "예약 전", labelEn: "Pre-booking", color: "default" as const },
    { value: "waiting", label: "대기", labelEn: "Waiting", color: "warning" as const },
    { value: "replacement_requested", label: "교체 요청", labelEn: "Replacement Requested", color: "error" as const },
    { value: "active", label: "진행중", labelEn: "Active", color: "info" as const },
    { value: "completed", label: "완료", labelEn: "Completed", color: "success" as const },
    { value: "terminated", label: "중단", labelEn: "Terminated", color: "default" as const },
] as const;

export type ServiceStatus = typeof SERVICE_STATUS_OPTIONS[number]["value"];

// Legacy export for backwards compatibility (deprecated)
/** @deprecated Use SERVICE_STATUS_OPTIONS instead */
export const CONTRACT_STATUS_OPTIONS = SERVICE_STATUS_OPTIONS;
/** @deprecated Use ServiceStatus instead */
export type ContractStatus = ServiceStatus;
