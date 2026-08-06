import { getScheduleChangeErrorMessage } from "./schedule-change-error";

describe("getScheduleChangeErrorMessage", () => {
    it.each([
        ["REQUEST_ALREADY_PENDING", "이미 처리 중인 일정 변경 요청이 있어요"],
        ["SCHEDULE_DATE_NOT_POSTPONED", "현재 예정일보다 늦은 날짜를 선택해 주세요"],
        ["INVALID_SCHEDULE_DATE", "올바른 서비스 날짜를 선택해 주세요"],
        ["ALL_SESSIONS_SUBMITTED", "모든 서비스 회차가 끝나 일정을 변경할 수 없어요"],
    ])("maps %s to a short Korean sentence", (code, expected) => {
        expect(getScheduleChangeErrorMessage({ response: { data: { code } } })).toBe(expected);
    });

    it("uses a safe short fallback without exposing the server response", () => {
        expect(getScheduleChangeErrorMessage({
            response: { data: { message: "internal stack detail" } },
        })).toBe("서비스 일정을 변경하지 못했어요. 잠시 후 다시 시도해 주세요");
    });
});
