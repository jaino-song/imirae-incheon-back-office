// Single source for automation policy values. A later endpoint exposes these
// values to the 설정 UI, so runtime code must import from here rather than
// inlining numbers.
export {
    SMS_DELIVERY_MAX_ATTEMPTS,
    SMS_DELIVERY_RETRY_DELAY_MS,
} from "domain/entities/message-log.entity";

export const TRIGGER_DISPATCH_CRON = "*/1 * * * *";
export const SEND_HOUR_KST = 9;
export const TRIGGER_JOB_MAX_ATTEMPTS = 3;
export const TRIGGER_JOB_RETRY_DELAY_MS = 5 * 60 * 1000;
export const TRIGGER_JOB_CONFIG_RETRY_DELAY_MS = 30 * 60 * 1000;
export const TRIGGER_JOB_PROCESSING_RECLAIM_MS = 10 * 60 * 1000;
export const PAST_OCCURRENCE_GRACE_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON = "메시지 발송 승인 필요";
