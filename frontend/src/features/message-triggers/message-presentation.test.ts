import {
  MESSAGE_HISTORY_STATUS_LABELS,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_RECORD_STATUS_FILTER_LABELS,
  MESSAGE_SECTION_DEFINITIONS,
  formatMessageFailureReason,
  getMessageChannelLabel,
  getMessageHistoryTitle,
  getMessageHistoryTimestamp,
  getMessageTemplateLabel,
  isHistoryRecordInChannel,
  normalizeMessageHistoryPresentation,
} from "@babyjamjam/shared";
import type { MessageLogRecord } from "@babyjamjam/shared/types/message";

function historyRecord(overrides: Partial<MessageLogRecord> = {}): MessageLogRecord {
  return {
    id: 1,
    provider: "aligo_sms",
    templateKey: "service_record_link_sms",
    triggerJobId: null,
    receiver: "01012345678",
    clientId: 10,
    recipientPhone: "01012345678",
    messageBody: "제공기록지 링크",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-07-16T12:19:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:10:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: "CLIENT",
    recipientName: "김고객",
    clientName: "김고객",
    employeeName: null,
    ...overrides,
  };
}

describe("shared message presentation contract", () => {
  it("uses the same Korean labels for trigger, system, and delivery-log keys", () => {
    expect(getMessageTemplateLabel("SERVICE_RECORD_LINK")).toBe("제공기록지 작성 링크");
    expect(getMessageTemplateLabel("service_record_link_sms")).toBe("제공기록지 작성 링크");
    expect(getMessageTemplateLabel("PRICE_INFO")).toBe("비용 안내");
    expect(getMessageTemplateLabel("client_greeting_sms")).toBe("인사 메시지");
    expect(getMessageTemplateLabel("unknown_internal_key")).toBe("메시지");
  });

  it("resolves variable metadata before falling back to a generic label", () => {
    expect(getMessageTemplateLabel("unknown", { systemTemplateKey: "SURVEY" })).toBe("모니터링 설문");
    expect(getMessageTemplateLabel("unknown", { title: "인사(소개)" })).toBe("인사 메시지");
    expect(getMessageHistoryTitle({
      templateKey: "CLIENT_WELCOME",
      ruleName: "인사(소개)",
    })).toBe("인사 메시지");
  });

  it("normalizes history display fields identically for frontend and mobile", () => {
    expect(normalizeMessageHistoryPresentation(historyRecord({
      errorMessage: "Aligo SMS API error (403): 등록인증되지 않은 발신번호입니다.",
    }))).toEqual({
      id: 1,
      title: "제공기록지 작성 링크",
      templateLabel: "제공기록지 작성 링크",
      recipientName: "김고객",
      recipientPhone: "01012345678",
      recipientListLabel: "김고객",
      channelLabel: "메시지",
      sentAt: "2026-07-16T12:19:00.000Z",
      status: "sent",
      messagePreview: "제공기록지 링크",
      failureReason: undefined,
    });
  });

  it("keeps a failure reason for failed history records", () => {
    expect(normalizeMessageHistoryPresentation(historyRecord({
      status: "failed",
      errorMessage: "Aligo SMS API error (403): 등록인증되지 않은 발신번호입니다.",
    })).failureReason).toBe("등록인증되지 않은 발신번호입니다.");
  });

  it("keeps the employee as recipient when an employee message also carries client context", () => {
    expect(normalizeMessageHistoryPresentation(historyRecord({
      recipientType: "PRIMARY_EMPLOYEE",
      recipientName: "고원경",
      clientName: "이보배",
      employeeName: "고원경",
    }))).toMatchObject({
      recipientName: "고원경",
      recipientListLabel: "고원경",
    });
  });

  it("shares channel, timestamp, failure, status, and navigation copy", () => {
    const record = historyRecord({ provider: "aligo_alimtalk", templateKey: "SERVICE_INFO" });

    expect(isHistoryRecordInChannel(record, "sms")).toBe(true);
    expect(getMessageChannelLabel("aligo_sms")).toBe("메시지");
    expect(getMessageChannelLabel("aligo_alimtalk")).toBe("메시지");
    expect(getMessageHistoryTimestamp(record)).toBe("2026-07-16T12:19:00.000Z");
    expect(formatMessageFailureReason("provider timeout (code: 500) 재시도 필요")).toBe("재시도 필요");
    expect(MESSAGE_HISTORY_STATUS_LABELS).toEqual({
      sent: "발송 성공",
      failed: "발송 실패",
      pending: "재시도 대기",
      canceled: "발송 취소",
    });
    // The past-status filter tabs must read exactly like the past-row badges.
    expect(MESSAGE_RECORD_STATUS_FILTER_LABELS).toEqual({
      all: "전체",
      upcoming: "예정",
      sent: "발송 성공",
      failed: "발송 실패",
      canceled: "발송 취소",
    });
    expect(MESSAGE_JOB_STATUS_LABELS).toEqual({
      pending: "발송 대기",
      processing: "발송 중",
      sent: "발송 완료",
      failed: "발송 실패",
      canceled: "발송 취소",
    });
    expect(MESSAGE_LOG_STATUS_BADGE_VARIANT).toEqual({
      sent: "success",
      failed: "danger",
      pending: "warning",
      canceled: "neutral",
    });
    expect(MESSAGE_JOB_STATUS_BADGE_VARIANT).toEqual({
      pending: "warning",
      processing: "info",
      sent: "success",
      failed: "danger",
      canceled: "neutral",
    });
    // "scheduled" (발송 예정) is intentionally absent: its content is folding
    // into 발송 기록 via a follow-up task, so it's dropped from navigation in
    // both apps while the MessageSectionId union still carries the member.
    expect(MESSAGE_SECTION_DEFINITIONS.map(({ id, label, mobilePath }) => [id, label, mobilePath]))
      .toEqual([
        ["send", "전송하기", "/messages/new"],
        ["history", "발송 기록", "/messages/history"],
        ["templates", "템플릿", "/messages/templates"],
        ["triggers", "자동 전송", "/messages/automation"],
        ["settings", "설정", "/messages/settings"],
      ]);
  });
});
