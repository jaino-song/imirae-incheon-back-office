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

type PendingEformsignDocData = {
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
};

type PendingEformsignDocColumn = {
    databaseName: string;
    prismaName: keyof PendingEformsignDocData;
};

// Keep columns from separate migrations in separate ordered groups. When a
// migration is missing, only its columns and columns from later migrations
// may be omitted from compatibility writes.
const PENDING_EFORMSIGN_DOC_COLUMN_GROUPS = [
    {
        // Migration: 20260709100000_link_eformsign_and_message_relations
        columns: [
            { databaseName: "document_kind", prismaName: "documentKind" },
            { databaseName: "employee_schedule_id", prismaName: "employeeScheduleId" },
            { databaseName: "template_id", prismaName: "templateId" },
        ],
    },
    {
        // Migration: 20260728120000_add_eformsign_doc_document_name_and_number
        columns: [
            { databaseName: "document_name", prismaName: "documentName" },
            { databaseName: "document_number", prismaName: "documentNumber" },
        ],
    },
    {
        // Migration: 20260728140000_add_eformsign_doc_list_display_columns
        columns: [
            { databaseName: "template_name", prismaName: "templateName" },
            { databaseName: "customer_name", prismaName: "customerName" },
            { databaseName: "creator_name", prismaName: "creatorName" },
            { databaseName: "last_editor_name", prismaName: "lastEditorName" },
            { databaseName: "step_recipient_types", prismaName: "stepRecipientTypes" },
        ],
    },
] as const satisfies readonly { columns: readonly PendingEformsignDocColumn[] }[];

export const PENDING_EFORMSIGN_DOC_COLUMN_NAMES = PENDING_EFORMSIGN_DOC_COLUMN_GROUPS.flatMap(
    (group) => group.columns.flatMap((column) => [column.databaseName, column.prismaName]),
);

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

const getMissingEformsignDocColumnName = (error: unknown): string | null => {
    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    if (typeof column === "string") {
        const unqualifiedName = column.trim().split(".").at(-1)?.replace(/^[`"']+|[`"']+$/g, "");
        if (unqualifiedName) {
            return unqualifiedName;
        }
    }

    // meta.column is the reliable source, but the detection this replaced also read the
    // message, and an error that reaches here without meta would otherwise lose the
    // fallback entirely. Take the earliest group mentioned, since a missing group implies
    // every later one is missing too.
    const message = error instanceof Error ? error.message : String(error);
    for (const group of PENDING_EFORMSIGN_DOC_COLUMN_GROUPS) {
        for (const groupColumn of group.columns) {
            if (
                message.includes(groupColumn.databaseName)
                || message.includes(groupColumn.prismaName)
            ) {
                return groupColumn.databaseName;
            }
        }
    }

    return null;
};

export const omitPendingEformsignDocColumns = <T extends PendingEformsignDocData>(
    data: T,
    error: unknown,
) => {
    const missingColumnName = getMissingEformsignDocColumnName(error);
    const missingGroupIndex = PENDING_EFORMSIGN_DOC_COLUMN_GROUPS.findIndex(
        (group) => group.columns.some(
            (column) =>
                column.databaseName === missingColumnName
                || column.prismaName === missingColumnName,
        ),
    );

    if (missingGroupIndex < 0) {
        throw error;
    }

    const compatData = { ...data };
    for (const group of PENDING_EFORMSIGN_DOC_COLUMN_GROUPS.slice(missingGroupIndex)) {
        for (const column of group.columns) {
            delete compatData[column.prismaName];
        }
    }
    return compatData;
};
