import {
    EFORMSIGN_DOC_COMPAT_READ_SELECT,
    eformsignDocCompatReadSelect,
    omitPendingEformsignDocColumns,
    readWithEformsignDocCompat,
    stripPendingEformsignDocPredicates,
    toCompatDomainRow,
} from "infrastructure/database/eformsign-doc-compat";

/** What Prisma raises when a column the client knows about is not in the database. */
function missingColumnError(column: string): unknown {
    return Object.assign(
        new Error(`The column \`${column}\` does not exist in the current database.`),
        { code: "P2022", meta: { column } },
    );
}

describe("eformsignDocCompatReadSelect", () => {
    it("keeps the columns from migrations that did ship", () => {
        // The defect this exists for: a deploy that runs ahead of the newest patch used to
        // drop every pending column, templateId included — and templateId shipped three
        // migrations earlier. The ten-minute duplicate-send guard decides by comparing it,
        // so a null read there means no duplicate is ever detected and a branch can be sent
        // a second contract for the whole window.
        const select = eformsignDocCompatReadSelect(missingColumnError("customer_name"));

        expect(select).toMatchObject({
            templateId: true,
            documentKind: true,
            employeeScheduleId: true,
            documentName: true,
            documentNumber: true,
        });
    });

    it("omits the missing migration's columns and every later one", () => {
        const select = eformsignDocCompatReadSelect(missingColumnError("document_name"));

        expect(select).toMatchObject({ templateId: true });
        for (const column of [
            "documentName",
            "documentNumber",
            "templateName",
            "customerName",
            "creatorName",
            "lastEditorName",
            "stepRecipientTypes",
        ]) {
            expect(select[column as keyof typeof select]).toBeUndefined();
        }
    });

    it("keeps everything up to the newest migration when only it is missing", () => {
        // The purge-intent migration is the newest group; a database missing only it must
        // still return every column the four earlier migrations added.
        const select = eformsignDocCompatReadSelect(
            missingColumnError("permanent_purge_requested_at"),
        );

        expect(select).toMatchObject({
            templateId: true,
            documentName: true,
            customerName: true,
        });
        expect(select["permanentPurgeRequestedAt" as keyof typeof select]).toBeUndefined();
    });

    it("never widens past the projection the caller asked for", () => {
        // The list select deliberately leaves detailPayload out — it is unbounded JSON and
        // a page view would read one per row. A retry that selected every surviving pending
        // column would have quietly reintroduced it for the whole deployment window.
        const select = eformsignDocCompatReadSelect(
            missingColumnError("permanent_purge_requested_at"),
        );

        expect(select["detailPayload" as keyof typeof select]).toBeUndefined();
        expect(select["syncStatus" as keyof typeof select]).toBeUndefined();
    });

    it("still returns a pending column when the caller does want it", () => {
        const select = eformsignDocCompatReadSelect(
            missingColumnError("permanent_purge_requested_at"),
            { documentId: true, detailPayload: true },
        );

        expect(select).toMatchObject({ detailPayload: true });
    });

    it("falls back to the floor when the oldest migration is the missing one", () => {
        const select = eformsignDocCompatReadSelect(missingColumnError("template_id"));

        expect(select).toEqual(EFORMSIGN_DOC_COMPAT_READ_SELECT);
    });

    it("drops to the floor when Prisma does not say which column is missing", () => {
        // Prisma raises P2022 with no meta.column and nothing nameable in the message. The
        // read knows a pending column is gone but not which, so it assumes the worst —
        // the one assumption that cannot be wrong. Throwing here would take down reads
        // that used to work.
        const select = eformsignDocCompatReadSelect(
            Object.assign(new Error("[PrismaException] Code: P2022, Field: N/A"), {
                code: "P2022",
            }),
        );

        expect(select).toEqual(EFORMSIGN_DOC_COMPAT_READ_SELECT);
    });
});

describe("readWithEformsignDocCompat", () => {
    it("drops to the floor when the narrowed read still hits a missing column", async () => {
        // A P2022 names *a* missing column, not the earliest one, and eformsign_doc lists
        // document_name ahead of template_id in the schema. So a database missing three
        // migrations can report the second group's column, and keeping the first group
        // would select columns that are equally absent. Without this second attempt the
        // narrowed read fails outright — a regression against always using the floor.
        const read = jest.fn()
            .mockRejectedValueOnce(missingColumnError("template_id"))
            .mockResolvedValueOnce({ documentId: "doc-1" });

        const result = await readWithEformsignDocCompat(
            missingColumnError("document_name"),
            read,
        );

        expect(result).toEqual({ documentId: "doc-1" });
        expect(read).toHaveBeenCalledTimes(2);
        expect(read.mock.calls[0]![0]).toMatchObject({ templateId: true });
        expect(read.mock.calls[1]![0]).toEqual(EFORMSIGN_DOC_COMPAT_READ_SELECT);
    });

    it("does not retry an error that is not about a missing column", async () => {
        const other = new Error("connection reset");
        const read = jest.fn().mockRejectedValue(other);

        await expect(readWithEformsignDocCompat(missingColumnError("customer_name"), read))
            .rejects.toThrow(other);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("does not read twice when the narrowed select works", async () => {
        const read = jest.fn().mockResolvedValue({ documentId: "doc-1" });

        await readWithEformsignDocCompat(missingColumnError("customer_name"), read);

        expect(read).toHaveBeenCalledTimes(1);
    });
});

describe("stripPendingEformsignDocPredicates", () => {
    it("drops an is-null test for a column the database may not have", () => {
        // Narrowing the select is only half a compatibility read: nearly every document
        // filter carries `permanentPurgeRequestedAt: null`, and a predicate naming a
        // missing column fails whatever is selected. Dropping it is a semantic identity —
        // with no column, no row can carry a value, so "is null" is true of every row.
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            branchId: "branch-1",
            permanentPurgeRequestedAt: null,
        })).toEqual({ branchId: "branch-1" });
    });

    it("removes true leaves from AND without leaving an empty predicate", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            AND: [
                { branchId: "branch-1" },
                { permanentPurgeRequestedAt: null },
            ],
        })).toEqual({
            AND: [
                { branchId: "branch-1" },
            ],
        });
    });

    it("collapses an OR containing a missing-column is-null predicate to true", () => {
        // `templateId: null` is true for every row when the first migration is absent.
        // Therefore its OR is true, while its top-level sibling still constrains the read.
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            branchId: "branch-1",
            OR: [{ templateId: null }, { documentId: "doc-1" }],
        })).toEqual({ branchId: "branch-1" });
    });

    it("ignores undefined Prisma filters when classifying a stripped OR branch", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [
                { templateId: null, documentId: undefined },
                { documentId: "doc-1" },
            ],
        })).toEqual({});
    });

    it("preserves an undefined-only authored branch inside OR", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [
                { documentId: undefined },
                { documentId: "doc-1" },
            ],
        })).toEqual({
            OR: [
                {},
                { documentId: "doc-1" },
            ],
        });
    });

    it("collapses NOT of a missing-column is-null predicate to false", () => {
        // `NOT true` is false, so the top-level sibling cannot turn this retry into an
        // unconstrained query. Prisma represents false as an empty OR.
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            branchId: "branch-1",
            NOT: { templateId: null },
        })).toEqual({ OR: [] });
    });

    it("ignores undefined Prisma filters when classifying a stripped NOT branch", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            NOT: { templateId: null, documentId: undefined },
        })).toEqual({ OR: [] });
    });

    it("preserves an undefined-only authored branch inside NOT", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            NOT: { documentId: undefined },
        })).toEqual({ NOT: {} });
    });

    it("drops false NOT branches inside OR instead of leaving an empty object", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [
                { NOT: { templateId: null } },
                { documentId: "doc-1" },
            ],
        })).toEqual({ OR: [{ documentId: "doc-1" }] });
    });

    it("preserves a pre-existing empty branch inside OR", () => {
        // `{}` is not this helper's true sentinel. Prisma gives it contextual semantics,
        // so an authored empty OR branch must remain opaque rather than collapse to true.
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [{}],
        })).toEqual({ OR: [{}] });
    });

    it("preserves an authored empty AND array nested inside OR", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [
                { AND: [] },
                { branchId: "branch-1" },
            ],
        })).toEqual({
            OR: [
                { AND: [] },
                { branchId: "branch-1" },
            ],
        });
    });

    it("preserves an authored empty NOT array nested inside OR", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            OR: [
                { NOT: [] },
                { branchId: "branch-1" },
            ],
        })).toEqual({
            OR: [
                { NOT: [] },
                { branchId: "branch-1" },
            ],
        });
    });

    it("preserves a pre-existing empty branch inside NOT", () => {
        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), {
            NOT: {},
        })).toEqual({ NOT: {} });
    });

    it("keeps a predicate whose column an earlier migration already added", () => {
        // Only the missing group and later ones are vacuous. `templateId` shipped with the
        // first group, so when a later migration is the missing one it is still there —
        // dropping its predicate would widen the retry past what the caller asked for.
        expect(stripPendingEformsignDocPredicates(
            missingColumnError("permanent_purge_requested_at"),
            { templateId: null, permanentPurgeRequestedAt: null },
        )).toEqual({ templateId: null });
    });

    it("leaves any comparison other than is-null alone", () => {
        // `{ not: null }` means the opposite, and without the column it would flip from
        // matching nothing to matching everything. Better to fail loudly than to answer
        // a different question than the caller asked.
        const where = { permanentPurgeRequestedAt: { not: null } };

        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), where)).toEqual(where);
    });

    it("leaves a filter with no pending columns untouched", () => {
        const where = { branchId: "branch-1", documentId: "doc-1" };

        expect(stripPendingEformsignDocPredicates(missingColumnError("document_kind"), where)).toEqual(where);
    });
});

describe("toCompatDomainRow", () => {
    const baseRow = {
        id: 1,
        documentId: "doc-1",
        createdDate: new Date("2026-07-01T00:00:00.000Z"),
        updatedDate: new Date("2026-07-02T00:00:00.000Z"),
        statusType: "060",
        statusDetail: "서명 요청됨",
        stepType: "01",
        stepIndex: "1",
        stepName: "이용자 서명",
        stepRecipientType: "05",
        stepRecipientName: "송진호",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-08-01T00:00:00.000Z"),
        expired: false,
        clientId: null,
    };

    it("keeps a column the select managed to read", () => {
        // Nulls are placeholders for what could not be read, not overrides. Filling them in
        // after the row is what made the narrowed select above pointless.
        const row = toCompatDomainRow({ ...baseRow, templateId: "template-1" });

        expect(row.templateId).toBe("template-1");
    });

    it("supplies null only for the columns that were left out", () => {
        const row = toCompatDomainRow({ ...baseRow, templateId: "template-1" });

        expect(row).toMatchObject({
            templateId: "template-1",
            customerName: null,
            documentName: null,
            stepRecipientTypes: null,
            customerPhone: null,
            detailPayload: null,
            detailSourceUpdatedDate: null,
            detailSyncedAt: null,
            syncStatus: null,
            syncError: null,
            syncErrorAt: null,
        });
    });
});

describe("omitPendingEformsignDocColumns", () => {
    it("still narrows writes to the missing migration and later ones", () => {
        // Unchanged behaviour, asserted here because reads now share its group logic.
        const data = {
            templateId: "template-1",
            documentName: "계약서",
            customerName: "김고객",
        };

        expect(omitPendingEformsignDocColumns(data, missingColumnError("customer_name")))
            .toEqual({ templateId: "template-1", documentName: "계약서" });
    });

    it("still throws where a read would drop to the floor", () => {
        // The asymmetry is deliberate: a read that loses columns it could have kept is
        // recoverable, a write that silently drops values the caller supplied is not.
        const error = Object.assign(
            new Error("[PrismaException] Code: P2022, Field: N/A"),
            { code: "P2022" },
        );

        expect(() => omitPendingEformsignDocColumns({ templateId: "t-1" }, error))
            .toThrow(error);
    });
});
