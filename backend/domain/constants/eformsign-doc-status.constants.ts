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

