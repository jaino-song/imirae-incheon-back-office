import { Prisma } from "@prisma/client";

export const EFORMSIGN_DOC_COMPAT_READ_SELECT = {
    id: true,
    documentId: true,
    createdDate: true,
    updatedDate: true,
    statusType: true,
    statusDetail: true,
    stepType: true,
    stepIndex: true,
    stepName: true,
    stepRecipientType: true,
    stepRecipientName: true,
    stepRecipientSms: true,
    expiredDate: true,
    expired: true,
    clientId: true,
} satisfies Prisma.eformsign_docSelect;

type EformsignDocCompatReadRow = Prisma.eformsign_docGetPayload<{
    select: typeof EFORMSIGN_DOC_COMPAT_READ_SELECT;
}>;

export const PENDING_EFORMSIGN_DOC_COLUMN_NAMES = [
    "document_kind",
    "employee_schedule_id",
    "template_id",
    "document_name",
    "document_number",
    "template_name",
    "customer_name",
    "creator_name",
    "last_editor_name",
    "step_recipient_types",
    "documentKind",
    "employeeScheduleId",
    "templateId",
    "documentName",
    "documentNumber",
    "templateName",
    "customerName",
    "creatorName",
    "lastEditorName",
    "stepRecipientTypes",
];

export const isPendingEformsignDocColumnError = (error: unknown): boolean => {
    const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${message} ${typeof column === "string" ? column : ""}`;

    if (code === "P2022") {
        return true;
    }

    if (!/column|does not exist/i.test(haystack)) {
        return false;
    }

    return PENDING_EFORMSIGN_DOC_COLUMN_NAMES.some((columnName) => haystack.includes(columnName));
};

export const toCompatDomainRow = (row: EformsignDocCompatReadRow) => ({
    ...row,
    documentKind: null,
    employeeScheduleId: null,
    templateId: null,
    documentName: null,
    documentNumber: null,
    templateName: null,
    customerName: null,
    creatorName: null,
    lastEditorName: null,
    stepRecipientTypes: null,
});

export const omitPendingEformsignDocColumns = <T extends {
    documentKind?: unknown;
    employeeScheduleId?: unknown;
    templateId?: unknown;
    documentName?: unknown;
    documentNumber?: unknown;
    templateName?: unknown;
    customerName?: unknown;
    creatorName?: unknown;
    lastEditorName?: unknown;
    stepRecipientTypes?: unknown;
}>(data: T) => {
    const legacyData = { ...data };
    delete legacyData.documentKind;
    delete legacyData.employeeScheduleId;
    delete legacyData.templateId;
    delete legacyData.documentName;
    delete legacyData.documentNumber;
    delete legacyData.templateName;
    delete legacyData.customerName;
    delete legacyData.creatorName;
    delete legacyData.lastEditorName;
    delete legacyData.stepRecipientTypes;
    return legacyData;
};
