import {
    EFORMSIGN_DOC_COMPAT_READ_SELECT,
    eformsignDocCompatReadSelect,
    omitPendingEformsignDocColumns,
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
