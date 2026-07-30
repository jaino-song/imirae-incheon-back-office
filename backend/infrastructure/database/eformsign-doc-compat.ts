import { Prisma } from "@prisma/client";

/**
 * The columns that predate every pending migration. Always present, whatever the database
 * is missing — the floor a compatibility read can never fall below.
 */
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

/**
 * Domain/list reads deliberately exclude the large detail JSON and PDF relation.
 * Detail and files have dedicated mirror repository methods; loading them while
 * building every contracts list would turn one page view into an unbounded JSON read.
 */
export const EFORMSIGN_DOC_DOMAIN_READ_SELECT = {
    ...EFORMSIGN_DOC_COMPAT_READ_SELECT,
    documentName: true,
    documentNumber: true,
    templateName: true,
    customerName: true,
    creatorName: true,
    lastEditorName: true,
    stepRecipientTypes: true,
    documentKind: true,
    employeeScheduleId: true,
    templateId: true,
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
    customerPhone?: unknown;
    creatorName?: unknown;
    lastEditorName?: unknown;
    stepRecipientTypes?: unknown;
    detailPayload?: unknown;
    detailSourceUpdatedDate?: unknown;
    detailSyncedAt?: unknown;
    syncStatus?: unknown;
    syncError?: unknown;
    syncErrorAt?: unknown;
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
    {
        // Migration: 20260729120000_add_eformsign_local_source_of_truth
        columns: [
            { databaseName: "customer_phone", prismaName: "customerPhone" },
            { databaseName: "detail_payload", prismaName: "detailPayload" },
            {
                databaseName: "detail_source_updated_date",
                prismaName: "detailSourceUpdatedDate",
            },
            { databaseName: "detail_synced_at", prismaName: "detailSyncedAt" },
            { databaseName: "sync_status", prismaName: "syncStatus" },
            { databaseName: "sync_error", prismaName: "syncError" },
            { databaseName: "sync_error_at", prismaName: "syncErrorAt" },
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

/** The pending columns as the database actually types them, not as `unknown`. */
type EformsignDocPendingReadRow = Prisma.eformsign_docGetPayload<{
    select: { [K in keyof PendingEformsignDocData]: true };
}>;

const PENDING_EFORMSIGN_DOC_NULLS = {
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
    customerPhone: null,
    detailPayload: null,
    detailSourceUpdatedDate: null,
    detailSyncedAt: null,
    syncStatus: null,
    syncError: null,
    syncErrorAt: null,
} as const satisfies Record<keyof PendingEformsignDocData, null>;

/**
 * The columns to read once a missing-column error says which migration the database has
 * not had yet: the floor, plus every pending group that shipped *before* the missing one.
 *
 * Reads used to drop all pending columns at the first sign of any missing one. That threw
 * away `templateId`, which shipped three migrations earlier and was still there — and the
 * ten-minute duplicate-send guard decides by comparing it, so with every stored document
 * reading null it stopped matching and stopped suppressing anything. A branch could be sent
 * a second contract for the duration of a deploy window. Writes already narrowed to the
 * missing group; reads now do the same.
 */
/**
 * Runs a compatibility read, narrowed by what the error named, and drops to the floor if
 * that narrowed read still hits a missing column.
 *
 * The second attempt is not belt-and-braces. A P2022 names *a* missing column, not the
 * earliest one — Postgres reports whichever it resolved first, and `eformsign_doc` lists
 * `document_name` ahead of `template_id` in the schema. So a database missing three
 * migrations can report the second group's column, and keeping the first group would then
 * select columns that are equally absent. The floor predates every pending migration and
 * cannot fail, which is what makes one retry enough for any number of missing groups.
 */
export const readWithEformsignDocCompat = async <TRow>(
    error: unknown,
    read: (select: Prisma.eformsign_docSelect) => Promise<TRow>,
): Promise<TRow> => {
    try {
        return await read(eformsignDocCompatReadSelect(error));
    } catch (narrowedError) {
        if (!isPendingEformsignDocColumnError(narrowedError)) {
            throw narrowedError;
        }
        return read({ ...EFORMSIGN_DOC_COMPAT_READ_SELECT });
    }
};

export const eformsignDocCompatReadSelect = (
    error: unknown,
): Prisma.eformsign_docSelect => {
    // Prisma sometimes raises P2022 with no column metadata and nothing nameable in the
    // message. That says a pending column is missing without saying which, so a read drops
    // to the floor — the assumption that cannot be wrong. Writes throw in the same
    // situation instead, because silently dropping data a caller asked to store is worse
    // than failing; a read losing columns it could have kept is recoverable.
    const keptGroupCount = Math.max(findEformsignDocGroupIndex(error), 0);
    const select: Prisma.eformsign_docSelect = { ...EFORMSIGN_DOC_COMPAT_READ_SELECT };
    for (const group of PENDING_EFORMSIGN_DOC_COLUMN_GROUPS.slice(0, keptGroupCount)) {
        for (const column of group.columns) {
            select[column.prismaName] = true;
        }
    }
    return select;
};

/**
 * Nulls first, row second: a column the select managed to keep wins over its placeholder.
 * The previous order spread the row first and then overwrote every pending column with
 * null, which made the narrowed select above pointless.
 */
export const toCompatDomainRow = (
    row: EformsignDocCompatReadRow & Partial<EformsignDocPendingReadRow>,
) => ({
    ...PENDING_EFORMSIGN_DOC_NULLS,
    ...row,
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

/** Which migration group the error names, or -1 when it names none. */
const findEformsignDocGroupIndex = (error: unknown): number => {
    const missingColumnName = getMissingEformsignDocColumnName(error);
    return PENDING_EFORMSIGN_DOC_COLUMN_GROUPS.findIndex(
        (group) => group.columns.some(
            (column) =>
                column.databaseName === missingColumnName
                || column.prismaName === missingColumnName,
        ),
    );
};

export const omitPendingEformsignDocColumns = <T extends PendingEformsignDocData>(
    data: T,
    error: unknown,
) => {
    const missingGroupIndex = findEformsignDocGroupIndex(error);
    // Unlike a read, a write cannot guess. Dropping the wrong columns here stores a row
    // that is silently missing values the caller supplied.
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
