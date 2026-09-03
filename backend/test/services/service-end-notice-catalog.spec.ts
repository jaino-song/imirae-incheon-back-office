import { MESSAGE_TRIGGER_TEMPLATE_CATALOG, MessageTriggerEventType, MessageTriggerRecipientType, MessageTriggerTemplateKey, CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS } from "domain/constants/message-trigger-catalog";
import { MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS } from "domain/constants/message-trigger-variable-sources";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { SERVICE_END_NOTICE_DEFAULT_CONTENT, SERVICE_END_NOTICE_SMS_TITLE } from "domain/constants/service-end-notice-message";
import { SMS_TEMPLATE_DELIVERY } from "application/services/sms-trigger-delivery.service";

describe("SERVICE_END_NOTICE template catalog", () => {
    it("is a client-only SERVICE_END sms template rendered from the system template", () => {
        const entry = MESSAGE_TRIGGER_TEMPLATE_CATALOG[MessageTriggerTemplateKey.SERVICE_END_NOTICE];
        expect(entry.name).toBe(SERVICE_END_NOTICE_SMS_TITLE);
        expect(entry.allowedEventTypes).toEqual([MessageTriggerEventType.SERVICE_END]);
        expect(entry.allowedRecipientTypes).toEqual([MessageTriggerRecipientType.CLIENT]);
        expect(entry.requiredVariables.map((v) => v.key)).toEqual(["name", "receiptUrl"]);
        expect(entry.providers.sms?.templateKey).toBe("SERVICE_END_NOTICE");
        expect(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS).toContain(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
    });

    it("ships the approved default body with name and receiptUrl placeholders", () => {
        const registry = SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.SERVICE_END_NOTICE];
        expect(registry.defaultContent).toBe(SERVICE_END_NOTICE_DEFAULT_CONTENT);
        expect(registry.defaultContent).toContain("{{name}}산모님~♡");
        expect(registry.defaultContent).toContain("{{receiptUrl}}");
        expect(registry.requiredVariables.map((v) => v.key)).toEqual(["name", "receiptUrl"]);
    });

    it("derives every required variable automatically and has a delivery config", () => {
        expect(MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS[MessageTriggerTemplateKey.SERVICE_END_NOTICE]).toEqual(["name", "clientName", "phone", "receiptUrl"]);
        const delivery = SMS_TEMPLATE_DELIVERY[MessageTriggerTemplateKey.SERVICE_END_NOTICE];
        expect(delivery).toMatchObject({
            smsLogTemplateKey: "service_end_notice_sms",
            automationKey: "SERVICE_END_NOTICE_SMS",
            triggerType: "service_end_notice",
            title: "서비스 종료 안내",
            systemTemplateKey: SystemTemplateKey.SERVICE_END_NOTICE,
        });
    });
});
