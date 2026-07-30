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
    permanentPurgeRequestedAt?: unknown;
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
    {
        // Migration: 20260730040000_add_eformsign_doc_permanent_purge_intent
        columns: [
            {
                databaseName: "permanent_purge_requested_at",
                prismaName: "permanentPurgeRequestedAt",
            },
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
    permanentPurgeRequestedAt: null,
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

/**
 * Drops `pendingColumn: null` predicates from a filter so it can run against a database
 * that does not have the column yet.
 *
 * Narrowing the select is only half of a compatibility read. Callers also filter on these
 * columns — `permanentPurgeRequestedAt: null` appears in nearly every document read — and
 * a predicate naming a missing column fails no matter what is selected, so the retry used
 * to fail exactly like the first attempt.
 *
 * Only the `: null` form is dropped, and that is a semantic identity: if the column does
 * not exist, no row can carry a value, so "is null" is true of every row. Any other
 * comparison is left in place to fail loudly rather than be silently reinterpreted —
 * `{ not: null }` would flip from matching nothing to matching everything.
 */
export const stripPendingEformsignDocPredicates = (
    error: unknown,
    where: Prisma.eformsign_docWhereInput,
): Prisma.eformsign_docWhereInput => {
    // Only the columns the database is actually missing. A predicate on a column an
    // earlier migration already added still means what it says, and dropping it would
    // widen the retry — a filter excluding purge-pending rows would start including them.
    const kept = keptPendingEformsignDocColumns(error);
    const missingNames = PENDING_EFORMSIGN_DOC_COLUMN_GROUPS
        .flatMap((group) => group.columns.map((column) => column.prismaName as string))
        .filter((name) => !kept.has(name));
    if (missingNames.length === 0) {
        return where;
    }
    const missing = new Set(missingNames);

    type SimplifiedWhere =
        | { kind: "true" }
        | { kind: "false" }
        | { kind: "where"; where: Prisma.eformsign_docWhereInput };

    const isTrue = (
        value: SimplifiedWhere,
    ): value is Extract<SimplifiedWhere, { kind: "true" }> => value.kind === "true";
    const isFalse = (
        value: SimplifiedWhere,
    ): value is Extract<SimplifiedWhere, { kind: "false" }> => value.kind === "false";

    const stripLogical = (
        operator: "AND" | "OR" | "NOT",
        value: Prisma.eformsign_docWhereInput | Prisma.eformsign_docWhereInput[],
    ): SimplifiedWhere => {
        const entries = Array.isArray(value) ? value : [value];
        const simplifiedEntries = entries.map((entry) => strip(entry));

        if (operator === "AND") {
            if (simplifiedEntries.some(isFalse)) {
                return { kind: "false" };
            }
            const remaining = simplifiedEntries.filter(
                (entry): entry is Extract<SimplifiedWhere, { kind: "where" }> => !isTrue(entry),
            );
            if (remaining.length === 0) {
                return { kind: "true" };
            }
            return {
                kind: "where",
                where: {
                    AND: Array.isArray(value)
                        ? remaining.map((entry) => entry.where)
                        : remaining[0]!.where,
                },
            };
        }

        if (operator === "OR") {
            if (simplifiedEntries.some(isTrue)) {
                return { kind: "true" };
            }
            const remaining = simplifiedEntries.filter(
                (entry): entry is Extract<SimplifiedWhere, { kind: "where" }> => !isFalse(entry),
            );
            if (remaining.length === 0) {
                return { kind: "false" };
            }
            return {
                kind: "where",
                where: {
                    OR: remaining.map((entry) => entry.where),
                },
            };
        }

        if (Array.isArray(value)) {
            // Prisma treats NOT arrays as an implicit AND of negated entries.
            if (simplifiedEntries.some(isTrue)) {
                return { kind: "false" };
            }
            const remaining = simplifiedEntries.filter(
                (entry): entry is Extract<SimplifiedWhere, { kind: "where" }> => !isFalse(entry),
            );
            if (remaining.length === 0) {
                return { kind: "true" };
            }
            return { kind: "where", where: { NOT: remaining.map((entry) => entry.where) } };
        }

        const [simplified] = simplifiedEntries;
        if (isTrue(simplified!)) {
            return { kind: "false" };
        }
        if (isFalse(simplified!)) {
            return { kind: "true" };
        }
        return { kind: "where", where: { NOT: simplified!.where } };
    };

    const strip = (node: Prisma.eformsign_docWhereInput): SimplifiedWhere => {
        const stripped: Record<string, unknown> = {};
        let removedTrue = false;
        for (const [key, value] of Object.entries(node)) {
            if (value === undefined) {
                // Prisma omits undefined filters. If they are all that remain after a
                // missing-column predicate is removed, this node is the true identity
                // rather than an authored empty predicate with contextual semantics.
                removedTrue = true;
                continue;
            }
            if (missing.has(key) && value === null) {
                removedTrue = true;
                continue;
            }
            if (
                (key === "AND" || key === "OR" || key === "NOT")
                && value !== undefined
                && value !== null
            ) {
                const simplified = stripLogical(
                    key,
                    value as Prisma.eformsign_docWhereInput | Prisma.eformsign_docWhereInput[],
                );
                if (isTrue(simplified)) {
                    removedTrue = true;
                    continue;
                }
                if (isFalse(simplified)) {
                    return { kind: "false" };
                }
                Object.assign(stripped, simplified.where);
                continue;
            }
            stripped[key] = value;
        }
        if (Object.keys(stripped).length === 0) {
            // `{}` is context-sensitive in Prisma (`OR: [{}]` and `NOT: {}` are not
            // interchangeable with our boolean identities). Only an empty node caused by
            // removing a known-true predicate is the true identity this helper may erase.
            return removedTrue
                ? { kind: "true" }
                : { kind: "where", where: {} };
        }
        return { kind: "where", where: stripped as Prisma.eformsign_docWhereInput };
    };

    const simplified = strip(where);
    if (isTrue(simplified)) {
        return {};
    }
    if (isFalse(simplified)) {
        return { OR: [] };
    }
    return simplified.where;
};

export const eformsignDocCompatReadSelect = (
    error: unknown,
    // The caller's own projection, so a compatibility retry reads no more than the query
    // it is standing in for. Widening to every surviving pending column would have pulled
    // detailPayload into list reads — the one column EFORMSIGN_DOC_DOMAIN_READ_SELECT
    // exists to keep out of them.
    desiredSelect: Prisma.eformsign_docSelect = EFORMSIGN_DOC_DOMAIN_READ_SELECT,
): Prisma.eformsign_docSelect => {
    // Prisma sometimes raises P2022 with no column metadata and nothing nameable in the
    // message. That says a pending column is missing without saying which, so a read drops
    // to the floor — the assumption that cannot be wrong. Writes throw in the same
    // situation instead, because silently dropping data a caller asked to store is worse
    // than failing; a read losing columns it could have kept is recoverable.
    const kept = keptPendingEformsignDocColumns(error);
    const select: Prisma.eformsign_docSelect = { ...EFORMSIGN_DOC_COMPAT_READ_SELECT };
    for (const [column, wanted] of Object.entries(desiredSelect)) {
        if (wanted && kept.has(column)) {
            select[column as keyof Prisma.eformsign_docSelect] = true;
        }
    }
    return select;
};

/** Pending columns from migrations that ran before the one the error names. */
const keptPendingEformsignDocColumns = (error: unknown): Set<string> => {
    const keptGroupCount = Math.max(findEformsignDocGroupIndex(error), 0);
    return new Set(
        PENDING_EFORMSIGN_DOC_COLUMN_GROUPS
            .slice(0, keptGroupCount)
            .flatMap((group) => group.columns.map((column) => column.prismaName as string)),
    );
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
