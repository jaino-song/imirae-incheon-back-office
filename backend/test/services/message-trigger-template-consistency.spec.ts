import { SMS_TEMPLATE_DELIVERY } from "application/services/sms-trigger-delivery.service";
import {
    CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS as BACKEND_CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS } from "domain/constants/message-trigger-variable-sources";
import { SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
// Reaches across the package boundary on purpose: this file's whole job is to
// prove packages/shared's UI label map and the backend digest catalog cannot
// drift apart, which requires importing the real source on both sides rather
// than a copy. Backend's own @babyjamjam/shared dependency is intentionally a
// narrow vendored subset (backend/vendor/shared-agent, agent-only) and does not
// carry message/presentation, so this cannot go through the package name.
import { MESSAGE_TEMPLATE_LABELS } from "../../../packages/shared/src/message/presentation";
import {
    CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS as SHARED_CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
} from "../../../packages/shared/src/types/message";

describe("SMS trigger template consistency", () => {
    it("keeps the frontend and backend configurable SMS template lists identical", () => {
        expect(BACKEND_CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS).toEqual(
            SHARED_CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
        );
    });

    it.each(
        Object.values(MESSAGE_TRIGGER_TEMPLATE_CATALOG)
            .filter((item) => item.providers.sms)
            .map((item) => [item.key, item] as const),
    )("keeps catalog, delivery config, registry, and variables aligned for %s", (templateKey, catalogItem) => {
        const delivery = SMS_TEMPLATE_DELIVERY[templateKey as MessageTriggerTemplateKey];
        expect(delivery).toBeDefined();

        const systemTemplateKey = delivery?.systemTemplateKey;
        expect(systemTemplateKey).toBeDefined();
        expect(catalogItem.providers.sms?.templateKey).toBe(systemTemplateKey);
        const registryEntry = systemTemplateKey ? SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey] : undefined;
        expect(registryEntry).toBeDefined();

        const availableVariables = new Set(
            Array.from(
                registryEntry?.defaultContent.matchAll(/\{\{\s*(\w+)\s*\}\}/g) ?? [],
                (match) => match[1],
            ),
        );
        const missingVariables = catalogItem.requiredVariables
            .map((variable) => variable.key)
            .filter((key) => !availableVariables.has(key));
        expect(missingVariables).toEqual([]);

        const automaticVariables = new Set(MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS[templateKey]);
        const unsupportedRegistryVariables = (registryEntry?.requiredVariables ?? [])
            .filter((variable) => variable.required)
            .map((variable) => variable.key)
            .filter((key) => !automaticVariables.has(key));
        expect(unsupportedRegistryVariables).toEqual([]);
    });
});

describe("MESSAGE_TEMPLATE_LABELS <-> MESSAGE_TRIGGER_TEMPLATE_CATALOG label parity", () => {
    // The UI reads MESSAGE_TEMPLATE_LABELS (packages/shared) and the daily
    // digest email reads MESSAGE_TRIGGER_TEMPLATE_CATALOG[key].name (backend).
    // They must say the same thing for every key, or the same message shows
    // two different Korean names depending on which surface you're looking at.
    it.each(Object.values(MessageTriggerTemplateKey))(
        "labels %s identically in the shared UI map and the backend digest catalog",
        (templateKey) => {
            expect(MESSAGE_TEMPLATE_LABELS[templateKey]).toBe(
                MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].name,
            );
        },
    );
});
