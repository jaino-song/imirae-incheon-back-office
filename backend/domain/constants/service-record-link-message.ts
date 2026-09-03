export const SERVICE_RECORD_LINK_RULE_ID = "system:service_record_link";
export const SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY = "service_record_link_sms";
export const SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY = "SERVICE_RECORD_LINK_SMS";
export const SERVICE_RECORD_LINK_SMS_TITLE = "제공기록지 작성 링크";
export const SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE = "service_start_at_15";
export const SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON =
    "제공기록지 링크 발송 작업 생성 재시도 대기";
export const SERVICE_RECORD_LINK_RESCHEDULED_REASON = "Service record link rescheduled";

const KST_OFFSET = "+09:00";

export function atKstHour(date: Date, hour: number): Date {
    const ymd = date.toISOString().slice(0, 10);
    const hh = String(hour).padStart(2, "0");
    return new Date(`${ymd}T${hh}:00:00${KST_OFFSET}`);
}

export function getServiceRecordLinkScheduledFor(startDate: Date): Date {
    return atKstHour(startDate, 15);
}

/** Calendar days the caregiver's 제공기록지 link stays valid past the service end date. */
export const SERVICE_RECORD_LINK_GRACE_DAYS = 7;

/**
 * When the case transitions to AWAITING_COMPLETION / becomes due for finalization.
 * This is the end date itself at 20:00 KST — unaffected by the link's grace period.
 */
export function getServiceRecordFinalizationDueAt(endDate: Date): Date {
    return atKstHour(endDate, 20);
}

/**
 * When the caregiver's 제공기록지 link expires: end date + grace period, 20:00 KST.
 * `endDate` values are UTC-midnight `@db.Date` values and `atKstHour` reads the date
 * portion via `toISOString().slice(0, 10)`, so plain UTC day arithmetic is correct here.
 */
export function getServiceRecordTokenExpiresAt(endDate: Date): Date {
    const graceEndDate = new Date(endDate.getTime() + SERVICE_RECORD_LINK_GRACE_DAYS * 86_400_000);
    return atKstHour(graceEndDate, 20);
}
