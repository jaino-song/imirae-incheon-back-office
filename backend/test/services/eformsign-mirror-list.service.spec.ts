import {
    EformsignMirrorListService,
    enrichMirrorPage,
    type MirrorListQuery,
} from "application/services/eformsign-mirror-list.service";
import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

function createMirrorDocument(overrides: {
    documentId: string;
    createdDate?: string;
    statusType?: string;
    stepType?: string;
    stepName?: string;
    templateId?: string | null;
    customerName?: string | null;
    documentName?: string | null;
    stepRecipientName?: string;
}): EformsignDocEntity {
    const createdDate = new Date(overrides.createdDate ?? "2026-07-01T00:00:00.000Z");
    return EformsignDocEntity.reconstitute({
        id: 1,
        documentId: overrides.documentId,
        documentName: overrides.documentName ?? `문서 ${overrides.documentId}`,
        documentNumber: `NO-${overrides.documentId}`,
        templateName: "표준 계약서",
        customerName: overrides.customerName === undefined ? "김고객" : overrides.customerName,
        creatorName: "생성자",
        lastEditorName: "편집자",
        stepRecipientTypes: ["05"],
        createdDate,
        updatedDate: createdDate,
        statusType: overrides.statusType ?? "060",
        statusDetail: "서명 요청됨",
        stepType: overrides.stepType ?? "01",
        stepIndex: "1",
        stepName: overrides.stepName ?? "이용자 서명",
        stepRecipientType: "05",
        stepRecipientName: overrides.stepRecipientName ?? "송진호",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-08-01T00:00:00.000Z"),
        expired: false,
        clientId: null,
        documentKind: null,
        employeeScheduleId: null,
        templateId: overrides.templateId === undefined ? "template-1" : overrides.templateId,
    });
}

function createQuery(overrides: Partial<MirrorListQuery> = {}): MirrorListQuery {
    return {
        branchId: "branch-1",
        isHeadquarters: false,
        scope: "all",
        templateMatch: "include",
        ...overrides,
    };
}

describe("EformsignMirrorListService", () => {
    let repository: {
        findAllVisibleInMirror: jest.Mock;
        findAllVisibleInMirrorForHeadquarters: jest.Mock;
        findContractEndDatesByDocumentIds: jest.Mock;
    };
    let service: EformsignMirrorListService;

    beforeEach(() => {
        repository = {
            findAllVisibleInMirror: jest.fn().mockResolvedValue([]),
            findAllVisibleInMirrorForHeadquarters: jest.fn().mockResolvedValue([]),
            findContractEndDatesByDocumentIds: jest.fn().mockResolvedValue(new Map()),
        };
        service = new EformsignMirrorListService(repository as never);
    });

    it("returns documents newest first, tie-broken by id", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-b", createdDate: "2026-07-01T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-c", createdDate: "2026-07-02T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-a", createdDate: "2026-07-01T00:00:00.000Z" }),
        ]);

        const { documents } = await service.buildList(createQuery());

        expect(documents.map((document) => document.id)).toEqual(["doc-c", "doc-a", "doc-b"]);
    });

    it("reads the headquarters scope from the method that includes unclaimed rows", async () => {
        repository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-hq" }),
        ]);

        const { documents } = await service.buildList(createQuery({ isHeadquarters: true }));

        expect(repository.findAllVisibleInMirrorForHeadquarters)
            .toHaveBeenCalledWith("branch-1");
        expect(documents.map((document) => document.id)).toEqual(["doc-hq"]);
    });

    it("selects a tab by status rather than by vendor inbox", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-open", statusType: "060" }),
            createMirrorDocument({ documentId: "doc-done", statusType: "050" }),
            createMirrorDocument({ documentId: "doc-gone", statusType: "080" }),
        ]);

        const inProgress = await service.buildList(createQuery({ scope: "in-progress" }));
        const completed = await service.buildList(createQuery({ scope: "completed" }));
        const rejected = await service.buildList(createQuery({ scope: "rejected" }));

        expect(inProgress.documents.map((d) => d.id)).toEqual(["doc-open"]);
        expect(completed.documents.map((d) => d.id)).toEqual(["doc-done"]);
        expect(rejected.documents.map((d) => d.id)).toEqual(["doc-gone"]);
    });

    it("puts a deleted document in the rejected tab, where the desktop shows it", async () => {
        // 047/049 land in the "unknown" category, which also holds every unrecognised
        // status — those belong in 진행 중, and only the deleted ones in 기간 만료.
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-deleted", statusType: "049" }),
            createMirrorDocument({ documentId: "doc-strange", statusType: "999" }),
        ]);

        const rejected = await service.buildList(createQuery({ scope: "rejected" }));
        const inProgress = await service.buildList(createQuery({ scope: "in-progress" }));

        expect(rejected.documents.map((d) => d.id)).toEqual(["doc-deleted"]);
        expect(inProgress.documents.map((d) => d.id)).toEqual(["doc-strange"]);
    });

    it("applies template include and exclude across a comma-separated list", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-1", templateId: "t-1" }),
            createMirrorDocument({ documentId: "doc-2", templateId: "t-2" }),
            createMirrorDocument({ documentId: "doc-3", templateId: "t-9" }),
        ]);

        const included = await service.buildList(
            createQuery({ templateId: "t-1, t-2", templateMatch: "include" }),
        );
        const excluded = await service.buildList(
            createQuery({ templateId: "t-1, t-2", templateMatch: "exclude" }),
        );

        expect(included.documents.map((d) => d.id).sort()).toEqual(["doc-1", "doc-2"]);
        expect(excluded.documents.map((d) => d.id)).toEqual(["doc-3"]);
    });

    it("excludes deleted documents only when asked", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-live", statusType: "060" }),
            createMirrorDocument({ documentId: "doc-deleted", statusType: "047" }),
            createMirrorDocument({ documentId: "doc-deleted-legacy", statusType: "099" }),
        ]);

        const kept = await service.buildList(createQuery());
        const dropped = await service.buildList(createQuery({ excludeDeleted: true }));

        expect(kept.documents).toHaveLength(3);
        expect(dropped.documents.map((d) => d.id)).toEqual(["doc-live"]);
    });

    it("searches the recipient name, including by 초성", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-song", stepRecipientName: "송진호" }),
            createMirrorDocument({ documentId: "doc-park", stepRecipientName: "박수신" }),
        ]);

        const exact = await service.buildList(createQuery({ search: "송진" }));
        const chosung = await service.buildList(createQuery({ search: "ㅅㅈㅎ" }));

        expect(exact.documents.map((d) => d.id)).toEqual(["doc-song"]);
        expect(chosung.documents.map((d) => d.id)).toEqual(["doc-song"]);
    });

    it("does not let the stored customerName widen the search", async () => {
        // The API path's search index is built before enrichment, so a customer name never
        // reaches it. Matching one here would change what the search finds the moment the
        // source switches — a feature change smuggled in as a migration.
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-1",
                customerName: "최고객",
                documentName: "계약",
                stepRecipientName: "송진호",
            }),
        ]);

        const { documents } = await service.buildList(createQuery({ search: "최고객" }));

        expect(documents).toHaveLength(0);
    });

    it("only searches recipient names the branch owns", async () => {
        // Headquarters sees unclaimed documents, but the API path builds its recipient-name
        // corpus from findAll(branchId), so their names are not searchable there.
        repository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-unassigned",
                documentName: "무관한 제목",
                stepRecipientName: "박수신",
            }),
        ]);
        repository.findAllVisibleInMirror.mockResolvedValue([]);

        const { documents } = await service.buildList(
            createQuery({ isHeadquarters: true, search: "박수신" }),
        );

        expect(documents).toHaveLength(0);
    });

    it("attaches the contract end date to in-progress provider-review documents", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-review",
                statusType: "070",
                stepType: "06",
                stepName: "제공기관 확인",
            }),
            createMirrorDocument({ documentId: "doc-waiting" }),
        ]);
        repository.findContractEndDatesByDocumentIds.mockResolvedValue(
            new Map([["doc-review", "2026-08-07"]]),
        );

        const { documents } = await service.buildList(createQuery());
        const byId = new Map(documents.map((document) => [document.id, document] as const));

        // Only the provider-review row is asked about, and only it carries the date.
        expect(repository.findContractEndDatesByDocumentIds).toHaveBeenCalledWith(["doc-review"]);
        expect(byId.get("doc-review")).toMatchObject({ contract_end_date: "2026-08-07" });
        expect(byId.get("doc-waiting")).not.toHaveProperty("contract_end_date");
    });

    it("leaves provider-review documents bare when no end date is recoverable", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-review",
                statusType: "070",
                stepType: "06",
                stepName: "제공기관 확인",
            }),
        ]);
        repository.findContractEndDatesByDocumentIds.mockResolvedValue(new Map());

        const { documents } = await service.buildList(createQuery());

        expect(documents[0]).not.toHaveProperty("contract_end_date");
    });

    it("does not read detail payloads when nothing sits in the provider-review step", async () => {
        repository.findAllVisibleInMirror.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-waiting" }),
        ]);

        await service.buildList(createQuery());

        expect(repository.findContractEndDatesByDocumentIds).not.toHaveBeenCalled();
    });
});

describe("enrichMirrorPage", () => {
    const entity = createMirrorDocument({ documentId: "doc-1", customerName: "최고객" });

    it("fills in the customer name the list renders", async () => {
        const service = new EformsignMirrorListService({
            findAllVisibleInMirror: jest.fn().mockResolvedValue([entity]),
            findAllVisibleInMirrorForHeadquarters: jest.fn(),
        } as never);
        const { documents } = await service.buildList(createQuery());

        const [enriched] = enrichMirrorPage(documents);

        expect(documentCustomerNameValue(enriched!)).toBe("최고객");
    });

    it("falls back to the recipient name, but not when it is just the document title", async () => {
        // Adoption can put the document title in stepRecipientName; a title is not a
        // customer name, and the API path skips those for the same reason.
        const titled = createMirrorDocument({
            documentId: "doc-titled",
            customerName: null,
            documentName: "산모 계약서",
            stepRecipientName: "산모 계약서",
        });
        const named = createMirrorDocument({
            documentId: "doc-named",
            customerName: null,
            stepRecipientName: "송진호",
        });
        const service = new EformsignMirrorListService({
            findAllVisibleInMirror: jest.fn().mockResolvedValue([titled, named]),
            findAllVisibleInMirrorForHeadquarters: jest.fn(),
        } as never);
        const { documents } = await service.buildList(createQuery());

        const enriched = enrichMirrorPage(documents);
        const byId = new Map(enriched.map((document) => [document.id, document] as const));

        expect(documentCustomerNameValue(byId.get("doc-named")!)).toBe("송진호");
        expect(documentCustomerNameValue(byId.get("doc-titled")!)).toBeNull();
    });

    it("does not pass off the adoption sentinel as a customer name", async () => {
        // Adoption stores the literal word 수신자 when it had neither a recipient name nor
        // a document title. The API path's own lookup nulls it out before enrichment sees
        // it; emitting it here would put it on screen and stop the UI falling back to
        // 고객 미지정, which is the only signal that the name is still unknown.
        const sentinel = createMirrorDocument({
            documentId: "doc-sentinel",
            customerName: null,
            stepRecipientName: "수신자",
        });
        const service = new EformsignMirrorListService({
            findAllVisibleInMirror: jest.fn().mockResolvedValue([sentinel]),
            findAllVisibleInMirrorForHeadquarters: jest.fn(),
        } as never);
        const { documents } = await service.buildList(createQuery());

        expect(documentCustomerNameValue(enrichMirrorPage(documents)[0]!)).toBeNull();
    });
});
