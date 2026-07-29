import {
    isRecord,
} from "application/utils/eformsign-document-customer-name";

function templateIdFromUnknown(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const templateId = value.trim();
    return templateId.length > 0 ? templateId : null;
}

export function eformsignDocumentTemplateId(document: unknown): string | null {
    if (!isRecord(document)) {
        return null;
    }

    const template = isRecord(document["template"]) ? document["template"] : null;
    const detailTemplate = isRecord(document["detail_template_info"])
        ? document["detail_template_info"]
        : null;

    return templateIdFromUnknown(template?.["id"])
        ?? templateIdFromUnknown(detailTemplate?.["id"])
        ?? templateIdFromUnknown(document["template_id"]);
}
