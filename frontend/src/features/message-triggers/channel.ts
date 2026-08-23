import type {
  MessageLogRecord,
  MessageTriggerRule,
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateCatalogItem,
  UpcomingMessageTriggerJob,
} from "./types";
// Single source of truth for a template's channel lives in the shared package so the form,
// channel filters, and the backend delivery drift guard all agree.
import {
  CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
  getTriggerTemplateChannel,
} from "@babyjamjam/shared/types/message";
import {
  isHistoryRecordInChannel as isSharedHistoryRecordInChannel,
  isSmsHistoryProvider as isSharedSmsHistoryProvider,
  isSmsHistoryRecord as isSharedSmsHistoryRecord,
  isSmsTriggerTemplate as isSharedSmsTriggerTemplate,
} from "@babyjamjam/shared";

export {
  CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
  getTriggerTemplateChannel,
};

export type TriggerMessageChannel = "sms";

export const SMS_HISTORY_PROVIDERS = ["aligo_sms"] as const;

export function isSmsTriggerTemplate(templateKey: string | null | undefined) {
  return isSharedSmsTriggerTemplate(templateKey);
}

export function isSmsHistoryProvider(provider: string | null | undefined) {
  return isSharedSmsHistoryProvider(provider);
}

export function isTriggerTemplateInChannel(
  templateKey: string | null | undefined,
  channel: TriggerMessageChannel,
) {
  return channel === "sms" && isSmsTriggerTemplate(templateKey);
}

export function isTriggerRuleInChannel(rule: MessageTriggerRule, channel: TriggerMessageChannel) {
  return isTriggerTemplateInChannel(rule.templateKey, channel);
}

export function isUpcomingJobInChannel(job: UpcomingMessageTriggerJob, channel: TriggerMessageChannel) {
  return isTriggerTemplateInChannel(job.templateKey, channel);
}

export function isSmsHistoryRecord(record: MessageLogRecord) {
  return isSharedSmsHistoryRecord(record);
}

export function isHistoryRecordInChannel(record: MessageLogRecord, channel: TriggerMessageChannel) {
  return isSharedHistoryRecordInChannel(record, channel);
}

export function filterHistoryRecordsByChannel(
  records: MessageLogRecord[],
  channel: TriggerMessageChannel,
) {
  return records.filter((record) => isHistoryRecordInChannel(record, channel));
}

// ---------------------------------------------------------------------------
// Catalog-driven SMS option derivation.
//
// The trigger-rule form derives its 이벤트 기준 / 수신 대상 / 발송 템플릿 dropdowns from the
// template catalog returned by the backend, so a future SMS template appears
// automatically without editing hardcoded frontend lists. These pure helpers are the data
// transforms; the component layers presentation (label/icon/order) on top.
// ---------------------------------------------------------------------------

export function getChannelTemplates(
  templates: TriggerTemplateCatalogItem[],
  channel: TriggerMessageChannel,
): TriggerTemplateCatalogItem[] {
  return templates.filter(
    (template) =>
      getTriggerTemplateChannel(template.key) === channel
      && CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS.includes(template.key),
  );
}

export function deriveEventTypesFromTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
): TriggerEventType[] {
  const eventTypes = new Set<TriggerEventType>();
  for (const template of channelTemplates) {
    for (const eventType of template.allowedEventTypes) {
      eventTypes.add(eventType);
    }
  }
  return Array.from(eventTypes);
}

export function deriveRecipientTypesFromTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
  eventType: TriggerEventType,
): TriggerRecipientType[] {
  const recipientTypes = new Set<TriggerRecipientType>();
  for (const template of channelTemplates) {
    if (!template.allowedEventTypes.includes(eventType)) continue;
    for (const recipientType of template.allowedRecipientTypes) {
      recipientTypes.add(recipientType);
    }
  }
  return Array.from(recipientTypes);
}

export function deriveAvailableTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
  eventType: TriggerEventType,
  recipientType: TriggerRecipientType,
): TriggerTemplateCatalogItem[] {
  return channelTemplates.filter(
    (template) =>
      template.allowedEventTypes.includes(eventType) &&
      template.allowedRecipientTypes.includes(recipientType),
  );
}
