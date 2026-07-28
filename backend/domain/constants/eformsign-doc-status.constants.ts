const COMPLETED_STATUS_CODES = [
    "003",
    "012",
    "022",
    "032",
    "050",
    "062",
    "072",
    "092",
] as const;

const REJECTED_STATUS_CODES = [
    "011",
    "021",
    "031",
    "040",
    "042",
    "045",
    "047",
    "049",
    "061",
    "071",
    "080",
] as const;

// "090"(철회)·"099"(삭제됨)은 웹훅 상태 매핑이 합성해 영속화하는 종료 코드다.
export const TERMINAL_STATUS_CODES = new Set<string>([
    ...COMPLETED_STATUS_CODES,
    ...REJECTED_STATUS_CODES,
    "090",
    "099",
]);

// 미배정 문서는 이용자 서명 완료(062) 뒤 제공기관 검토(070)로 진행할 수 있다.
export const UNASSIGNED_TERMINAL_STATUS_CODES = new Set<string>(
    [...TERMINAL_STATUS_CODES].filter((statusCode) => statusCode !== "062"),
);
