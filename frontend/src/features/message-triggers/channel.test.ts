import {
  CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TEMPLATE_KEYS,
  deriveAvailableTemplates,
  deriveEventTypesFromTemplates,
  deriveRecipientTypesFromTemplates,
  filterHistoryRecordsByChannel,
  getChannelTemplates,
  getTriggerTemplateChannel,
  isTriggerTemplateInChannel,
} from "./channel";
import type { MessageLogRecord, TriggerTemplateCatalogItem } from "./types";

const template = (
  key: TriggerTemplateCatalogItem["key"],
  eventType: TriggerTemplateCatalogItem["allowedEventTypes"][number],
): TriggerTemplateCatalogItem => ({
  key,
  name: key,
  description: "",
  allowedEventTypes: [eventType],
  allowedRecipientTypes: ["CLIENT"],
  requiredVariables: [],
  providers: { sms: { templateKey: key } },
});

const historyRecord = (overrides: Partial<MessageLogRecord> = {}): MessageLogRecord => ({
  id: 1,
  provider: "aligo_sms",
  templateKey: "SERVICE_INFO",
  triggerJobId: null,
  receiver: "01000000000",
  clientId: null,
  recipientPhone: "01000000000",
  messageBody: "message",
  variables: {},
  status: "sent",
  aligoMid: null,
  errorMessage: null,
  attempts: 1,
  lastAttemptAt: null,
  nextRetryAt: null,
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
  ruleId: null,
  ruleName: null,
  eventType: null,
  offsetType: null,
  offsetDays: 0,
  scheduledFor: null,
  recipientType: null,
  recipientName: null,
  clientName: null,
  employeeName: null,
  ...overrides,
});

describe("SMS trigger channel routing", () => {
  it("uses the shared SMS template list as the single channel source", () => {
    expect(isTriggerTemplateInChannel("SERVICE_INFO", "sms")).toBe(true);
    expect(isTriggerTemplateInChannel("CLIENT_WELCOME", "sms")).toBe(false);
    expect(getTriggerTemplateChannel("CLIENT_WELCOME")).toBe("unsupported");
    expect(SMS_TRIGGER_TEMPLATE_KEYS).toContain("SERVICE_RECORD_LINK");
    expect(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS).not.toContain("SERVICE_RECORD_LINK");
  });

  it("derives form options from the SMS catalog", () => {
    const templates = [
      template("SERVICE_INFO", "SERVICE_START"),
      template("CLIENT_GREETING", "CLIENT_CREATED"),
      {
        ...template("SERVICE_RECORD_LINK", "SERVICE_START"),
        allowedRecipientTypes: ["PRIMARY_EMPLOYEE" as const],
      },
    ];
    const smsTemplates = getChannelTemplates(templates, "sms");

    expect(deriveEventTypesFromTemplates(smsTemplates)).toEqual([
      "SERVICE_START",
      "CLIENT_CREATED",
    ]);
    expect(deriveRecipientTypesFromTemplates(smsTemplates, "SERVICE_START")).toEqual(["CLIENT"]);
    expect(deriveAvailableTemplates(smsTemplates, "CLIENT_CREATED", "CLIENT")).toEqual([
      templates[1],
    ]);
    expect(smsTemplates.map((item) => item.key)).not.toContain("SERVICE_RECORD_LINK");
  });

  it("keeps only SMS records in message history", () => {
    const smsRecord = historyRecord();
    const legacyRecord = historyRecord({
      id: "job:legacy",
      provider: "message_job",
      templateKey: "CLIENT_WELCOME",
    });

    expect(filterHistoryRecordsByChannel([smsRecord, legacyRecord], "sms")).toEqual([smsRecord]);
  });
});
