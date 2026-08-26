/**
 * Service status values for client entity
 * Based on service lifecycle and date calculations
 */
export const SERVICE_STATUS = {
    PRE_BOOKING: "pre_booking",       // 예약 전 - 상담만 진행되어 서비스가 아직 없음
    WAITING: "waiting",               // 대기 - start_date not yet reached
    ACTIVE: "active",                 // 진행중 - currently between start_date and end_date
    COMPLETED: "completed",           // 완료 - end_date has passed
    TERMINATED: "terminated",         // 중단 - manually terminated before end_date
    REPLACEMENT_REQUESTED: "replacement_requested", // 교체 요청 - provider change requested
} as const;

export type ServiceStatusType = (typeof SERVICE_STATUS)[keyof typeof SERVICE_STATUS];

export const SERVICE_STATUS_VALUES: ServiceStatusType[] = [
    SERVICE_STATUS.PRE_BOOKING,
    SERVICE_STATUS.WAITING,
    SERVICE_STATUS.REPLACEMENT_REQUESTED,
    SERVICE_STATUS.ACTIVE,
    SERVICE_STATUS.COMPLETED,
    SERVICE_STATUS.TERMINATED,
];

export function isServiceStatus(value: string | null | undefined): value is ServiceStatusType {
    return typeof value === "string" && SERVICE_STATUS_VALUES.includes(value as ServiceStatusType);
}

// Manual statuses that should NOT be auto-updated based on dates
const MANUAL_STATUSES: ServiceStatusType[] = [
    SERVICE_STATUS.PRE_BOOKING,
    SERVICE_STATUS.TERMINATED,
    SERVICE_STATUS.REPLACEMENT_REQUESTED,
];

// Only these statuses may be produced by date-based recomputation. Manual
// statuses are deliberately excluded so a stale background snapshot cannot
// move an authoritative transition backwards.
const AUTOMATIC_STATUSES: ServiceStatusType[] = [
    SERVICE_STATUS.PRE_BOOKING,
    SERVICE_STATUS.WAITING,
    SERVICE_STATUS.ACTIVE,
    SERVICE_STATUS.COMPLETED,
];

/**
 * Compute service status based on start_date and end_date
 * Manual statuses (terminated, replacement_requested) are preserved
 *
 * @param currentStatus - Current stored status
 * @param startDate - Service start date
 * @param endDate - Service end date
 * @returns Computed status or current status if manual
 */
export function computeServiceStatus(
    currentStatus: string | null,
    startDate: Date | null,
    endDate: Date | null,
): ServiceStatusType {
    // Preserve manual statuses
    if (currentStatus && MANUAL_STATUSES.includes(currentStatus as ServiceStatusType)) {
        return currentStatus as ServiceStatusType;
    }

    // 서비스 일정이 없으면 아직 예약이 확정되지 않은 고객이다.
    if (!startDate || !endDate) {
        return SERVICE_STATUS.PRE_BOOKING;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    // Before start date → waiting
    if (today < start) {
        return SERVICE_STATUS.WAITING;
    }

    // After end date → completed
    if (today > end) {
        return SERVICE_STATUS.COMPLETED;
    }

    // Between start and end date → active
    return SERVICE_STATUS.ACTIVE;
}

/**
 * Check if status needs to be updated based on dates
 */
export function shouldUpdateStatus(
    currentStatus: string | null,
    computedStatus: ServiceStatusType,
): boolean {
    return isAutomaticServiceStatusTransitionAllowed(currentStatus, computedStatus);
}

/**
 * Check whether a date-derived status may be applied to the observed state.
 * The repository repeats this guard immediately before its atomic write.
 */
export function isAutomaticServiceStatusTransitionAllowed(
    currentStatus: string | null,
    computedStatus: ServiceStatusType,
): boolean {
    if (currentStatus && MANUAL_STATUSES.includes(currentStatus as ServiceStatusType)) {
        return false;
    }

    return AUTOMATIC_STATUSES.includes(computedStatus) && currentStatus !== computedStatus;
}

/**
 * Check if a status is a manual status (not auto-computed)
 */
export function isManualStatus(status: string | null): boolean {
    return !!status && MANUAL_STATUSES.includes(status as ServiceStatusType);
}
