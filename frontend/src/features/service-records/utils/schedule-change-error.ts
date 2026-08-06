const SCHEDULE_CHANGE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
    REQUEST_ALREADY_PENDING: "이미 처리 중인 일정 변경 요청이 있어요",
    SCHEDULE_DATE_NOT_POSTPONED: "현재 예정일보다 늦은 날짜를 선택해 주세요",
    INVALID_SCHEDULE_DATE: "올바른 서비스 날짜를 선택해 주세요",
    ALL_SESSIONS_SUBMITTED: "모든 서비스 회차가 끝나 일정을 변경할 수 없어요",
    REQUEST_STALE: "서비스 일정이 이미 달라졌어요. 다시 확인해 주세요",
};

function getResponse(error: unknown): { status?: number; data?: unknown } | undefined {
    if (!error || typeof error !== "object" || !("response" in error)) return undefined;
    return (error as { response?: { status?: number; data?: unknown } }).response;
}

export function getScheduleChangeErrorMessage(error: unknown): string {
    const response = getResponse(error);
    const data = response?.data;
    if (data && typeof data === "object" && "code" in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === "string" && SCHEDULE_CHANGE_ERROR_MESSAGES[code]) {
            return SCHEDULE_CHANGE_ERROR_MESSAGES[code];
        }
    }

    if (response?.status === 401) return "로그인이 만료됐어요. 다시 로그인해 주세요";
    if (response?.status === 403) return "서비스 일정을 변경할 권한이 없어요";
    if (response?.status === 404) return "변경할 서비스 일정을 찾지 못했어요";

    return "서비스 일정을 변경하지 못했어요. 잠시 후 다시 시도해 주세요";
}
