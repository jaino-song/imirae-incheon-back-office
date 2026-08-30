export const MESSAGE_AUTOMATION_INTENT_RULE_ID = "system:message_automation_intent";
export const MESSAGE_AUTOMATION_INTENT_RETRY_REASON = "메시지 자동화 생성 재시도 대기";
export const MESSAGE_AUTOMATION_INTENT_INVALID_REASON =
    "메시지 자동화 복구 표식 손상 - 수동 확인 필요";
export const EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON = "Employee assignment changed";

export type MessageAutomationIntentKind = "client" | "schedule" | "employee";

export function getClientAutomationIntentDedupeKey(branchId: string, clientId: number): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:client:${clientId}`;
}

export function getScheduleAutomationIntentDedupeKey(
    branchId: string,
    scheduleId: number,
): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:schedule:${scheduleId}`;
}

export function getEmployeeAutomationIntentDedupeKey(
    branchId: string,
    employeeId: number,
): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:employee:${employeeId}`;
}

export const getEmployeeProfileRefreshAutomationIntentDedupeKey = getEmployeeAutomationIntentDedupeKey;
