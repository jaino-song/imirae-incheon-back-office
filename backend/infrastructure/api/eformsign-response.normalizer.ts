import {
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
} from "domain/repositories/eformsign.client.interface";
import {
    normalizeEformsignStatusCode,
    normalizeEformsignStepType,
} from "domain/utils/eformsign-status-code";

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : {};
}

function normalizeString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    const stringValue = String(value);
    return stringValue.trim() ? stringValue : "";
}

function normalizeEpoch(value: unknown): number {
    if (
        (typeof value !== "number" && typeof value !== "string")
        || (typeof value === "string" && value.trim() === "")
    ) {
        return Number.NaN;
    }

    const numericValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    const normalized = normalizeEpoch(value);
    return Number.isInteger(normalized) && normalized >= 0
        ? normalized
        : undefined;
}

function normalizeTotalRows(value: unknown): number {
    if (
        (typeof value !== "number" && typeof value !== "string")
        || (typeof value === "string" && value.trim() === "")
    ) {
        throw new Error("Invalid eformsign total_rows");
    }

    const normalized = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error("Invalid eformsign total_rows");
    }

    return normalized;
}

function normalizeRecipient(value: unknown): Record<string, unknown> {
    const recipient = asRecord(value);
    return {
        ...recipient,
        recipient_type: normalizeString(recipient["recipient_type"]),
        id: normalizeString(recipient["id"]),
        name: normalizeString(recipient["name"]),
    };
}

export function normalizeEformsignDocumentResponse(
    value: unknown,
): EformsignApiDocumentResponse {
    const document = asRecord(value);
    const template = asRecord(document["template"]);
    const creator = asRecord(document["creator"]);
    const lastEditor = asRecord(document["last_editor"]);
    const currentStatus = asRecord(document["current_status"]);
    const recipients = Array.isArray(currentStatus["step_recipients"])
        ? currentStatus["step_recipients"].map(normalizeRecipient)
        : [];
    const expiredDate = normalizeOptionalNonNegativeInteger(currentStatus["expired_date"]);
    const hasExpired = typeof currentStatus["_expired"] === "boolean";

    const normalizedCurrentStatus = {
        ...currentStatus,
        status_type: normalizeEformsignStatusCode(
            normalizeString(currentStatus["status_type"]),
        ),
        // Absent in the list schema. Manufacturing "" here would read as "the vendor
        // says it has no detail", and callers would then overwrite a stored detail with
        // whatever they fall back to. Keep the absence so they can tell.
        ...(currentStatus["status_doc_type"] === undefined
            ? {}
            : { status_doc_type: normalizeString(currentStatus["status_doc_type"]) }),
        ...(currentStatus["status_doc_detail"] === undefined
            ? {}
            : { status_doc_detail: normalizeString(currentStatus["status_doc_detail"]) }),
        step_type: normalizeEformsignStepType(
            normalizeString(currentStatus["step_type"]),
        ),
        step_index: normalizeString(currentStatus["step_index"]),
        step_name: normalizeString(currentStatus["step_name"]),
        step_recipients: recipients,
        step_group: normalizeEpoch(currentStatus["step_group"]),
        ...(expiredDate === undefined ? {} : { expired_date: expiredDate }),
        ...(hasExpired ? { _expired: currentStatus["_expired"] } : {}),
    };

    return {
        ...document,
        id: normalizeString(document["id"]),
        document_number: normalizeString(document["document_number"]),
        template: {
            ...template,
            id: normalizeString(template["id"]),
            name: normalizeString(template["name"]),
        },
        document_name: normalizeString(document["document_name"]),
        creator: {
            ...creator,
            recipient_type: normalizeString(creator["recipient_type"]),
            id: normalizeString(creator["id"]),
            name: normalizeString(creator["name"]),
        },
        ...(Object.keys(lastEditor).length === 0
            ? {}
            : {
                last_editor: {
                    ...lastEditor,
                    recipient_type: normalizeString(lastEditor["recipient_type"]),
                    id: normalizeString(lastEditor["id"]),
                    name: normalizeString(lastEditor["name"]),
                },
            }),
        created_date: normalizeEpoch(document["created_date"]),
        updated_date: normalizeEpoch(document["updated_date"]),
        current_status: normalizedCurrentStatus,
    } as unknown as EformsignApiDocumentResponse;
}

export function normalizeEformsignListResponse(value: unknown): EformsignApiListResponse {
    const response = asRecord(value);
    const documents = Array.isArray(response["documents"])
        ? response["documents"].map(normalizeEformsignDocumentResponse)
        : [];

    return {
        documents,
        total_rows: normalizeTotalRows(response["total_rows"]),
    };
}
