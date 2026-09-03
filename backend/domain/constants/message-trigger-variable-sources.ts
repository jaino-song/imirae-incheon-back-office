import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerTemplateKey,
} from "./message-trigger-catalog";

export interface RequiredMessageTemplateVariable {
    key: string;
    required?: boolean;
}

/**
 * Variables the scheduler can deliberately derive without operator input.
 * Keep this aligned with the client, employee-assignment, and service-record
 * job builders; incidental fallback aliases in the renderer are not sources.
 */
export const MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS: Readonly<
    Record<MessageTriggerTemplateKey, readonly string[]>
> = {
    [MessageTriggerTemplateKey.CLIENT_WELCOME]: [
        "name",
        "clientName",
        "registrationDate",
        "serviceType",
    ],
    [MessageTriggerTemplateKey.SERVICE_START_REMINDER]: [
        "name",
        "clientName",
        "serviceStartDate",
        "timingText",
    ],
    [MessageTriggerTemplateKey.SERVICE_INFO]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.SERVICE_END_REMINDER]: [
        "name",
        "clientName",
        "serviceEndDate",
        "timingText",
    ],
    [MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED]: [
        "name",
        "employeeName",
        "clientName",
        "serviceStartDate",
    ],
    [MessageTriggerTemplateKey.SERVICE_RECORD_LINK]: [
        "name",
        "employeeName",
        "clientName",
        "serviceStartDate",
        "serviceEndDate",
        "buttonUrl",
        "serviceRecordUrl",
    ],
    [MessageTriggerTemplateKey.CLIENT_GREETING]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.PRICE_INFO]: [
        "name",
        "clientName",
        "phone",
        "weeks",
        "duration",
        "type",
        "fullPrice",
        "grant",
        "actualPrice",
        "bankName",
        "accNum",
    ],
    [MessageTriggerTemplateKey.REMINDER]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.THANKS]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.SURVEY]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.INFO]: ["name", "clientName", "phone"],
    [MessageTriggerTemplateKey.SERVICE_END_NOTICE]: ["name", "clientName", "phone", "receiptUrl"],
};

export function findUnsupportedRequiredMessageTriggerVariables(
    templateKey: MessageTriggerTemplateKey,
    variables: readonly RequiredMessageTemplateVariable[],
): string[] {
    const availableKeys = new Set(MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS[templateKey]);
    return variables
        .filter((variable) => variable.required && !availableKeys.has(variable.key))
        .map((variable) => variable.key);
}

export function getMessageTriggerTemplateKeysForSystemTemplate(
    systemTemplateKey: string,
): MessageTriggerTemplateKey[] {
    return Object.values(MESSAGE_TRIGGER_TEMPLATE_CATALOG)
        .filter((template) => template.providers.sms?.templateKey === systemTemplateKey)
        .map((template) => template.key);
}
