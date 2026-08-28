export const CLIENT_RETENTION_BLOCKED = "CLIENT_RETENTION_BLOCKED" as const;
export const SCHEDULE_RETENTION_BLOCKED = "SCHEDULE_RETENTION_BLOCKED" as const;

export const CLIENT_RETENTION_BLOCKED_MESSAGE =
    "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.";
export const SCHEDULE_RETENTION_BLOCKED_MESSAGE =
    "시작된 일정이거나 연결된 운영 또는 이력 데이터가 있어 일정을 삭제할 수 없습니다.";

export class RetentionDeleteBlockedError extends Error {
    constructor(
        public readonly code: typeof CLIENT_RETENTION_BLOCKED | typeof SCHEDULE_RETENTION_BLOCKED,
        message: string,
    ) {
        super(message);
        this.name = "RetentionDeleteBlockedError";
    }
}

export class ScopedDeleteNotFoundError extends Error {
    constructor(resource: "client" | "schedule", id: number) {
        super(`${resource} with id ${id} not found for branch`);
        this.name = "ScopedDeleteNotFoundError";
    }
}
