import { ConfigService } from "@nestjs/config";

import {
    EformsignListShadowCompareService,
    type ListShadowCompareQuery,
} from "application/services/eformsign-list-shadow-compare.service";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

function createConfigService(enabled: string | undefined): ConfigService {
    return {
        get: jest.fn((key: string) =>
            key === "EFORMSIGN_SHADOW_COMPARE_ENABLED" ? enabled : undefined),
    } as unknown as ConfigService;
}

function createMirrorDocument(overrides: {
    documentId: string;
    createdDate?: string;
    statusType?: string;
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
        customerName: overrides.customerName ?? "김고객",
        creatorName: "생성자",
        lastEditorName: "편집자",
        stepRecipientTypes: ["05"],
        createdDate,
        updatedDate: createdDate,
        statusType: overrides.statusType ?? "060",
        statusDetail: "서명 요청됨",
        stepType: "01",
        stepIndex: "1",
        stepName: "이용자 서명",
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

function createQuery(overrides: Partial<ListShadowCompareQuery> = {}): ListShadowCompareQuery {
    return {
        branchId: "branch-1",
        isHeadquarters: false,
        scope: "all",
        limit: 100,
        skip: 0,
        templateMatch: "include",
        ...overrides,
    };
}

describe("EformsignListShadowCompareService", () => {
    let repository: { findAll: jest.Mock; findAllForHeadquarters: jest.Mock };

    beforeEach(() => {
        repository = {
            findAll: jest.fn().mockResolvedValue([]),
            findAllForHeadquarters: jest.fn().mockResolvedValue([]),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function createService(enabled: string | undefined) {
        return new EformsignListShadowCompareService(
            createConfigService(enabled),
            repository as never,
        );
    }

    /** compareInBackground deliberately does not await; give the microtasks a turn. */
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

    it.each([undefined, "false", "1"])(
        "does nothing with EFORMSIGN_SHADOW_COMPARE_ENABLED=%s",
        async (value) => {
            const service = createService(value);

            service.compareInBackground(createQuery(), { documentIds: ["a"], oldestCreatedAt: undefined });
            await settle();

            expect(repository.findAll).not.toHaveBeenCalled();
        },
    );

    it("reports a match when the mirror produces the same page", async () => {
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-2", createdDate: "2026-07-02T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-1", createdDate: "2026-07-01T00:00:00.000Z" }),
        ]);
        const service = createService("true");
        const log = jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        // Newest first, which is the order the served path sorts into.
        service.compareInBackground(createQuery(), {
            documentIds: ["doc-2", "doc-1"],
            oldestCreatedAt: undefined,
        });
        await settle();

        expect(warn).not.toHaveBeenCalled();
        expect(log.mock.calls[0]?.[0]).toContain("match");
    });

    it("names the documents each side is missing", async () => {
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-1" }),
            createMirrorDocument({ documentId: "doc-3" }),
        ]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(createQuery(), {
            documentIds: ["doc-1", "doc-2"],
            oldestCreatedAt: undefined,
        });
        await settle();

        const message = warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("missing=doc-2");
        expect(message).toContain("extra=doc-3");
    });

    it("reports an order difference only when both sides hold the same documents", async () => {
        // Same two documents, but the mirror's created dates put them the other way round.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-a", createdDate: "2026-07-01T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-b", createdDate: "2026-07-02T00:00:00.000Z" }),
        ]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(createQuery(), {
            documentIds: ["doc-a", "doc-b"],
            oldestCreatedAt: undefined,
        });
        await settle();

        expect(warn.mock.calls[0]?.[0]).toContain("order differs");
    });

    it("applies the same template filter the served page did", async () => {
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-keep", templateId: "template-1" }),
            createMirrorDocument({ documentId: "doc-drop", templateId: "template-9" }),
        ]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(
            createQuery({ templateId: "template-1", templateMatch: "include" }),
            { documentIds: ["doc-keep"], oldestCreatedAt: undefined },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
    });

    it("matches 초성 against the recipient name, the way the served search does", async () => {
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-song", stepRecipientName: "송진호" }),
            createMirrorDocument({ documentId: "doc-park", stepRecipientName: "박수신" }),
        ]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        // 초성 검색은 startsWith 규칙이라 "ㅅㅈㅎ"는 송진호만 집는다.
        service.compareInBackground(
            createQuery({ search: "ㅅㅈㅎ" }),
            { documentIds: ["doc-song"], oldestCreatedAt: undefined },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not search the stored customerName, because the served list cannot", async () => {
        // The vendor list is fetched without include_fields, so the served search never
        // sees a customer name on the document and matches the recipient name instead.
        // Searching the mirror's own column would find documents the served path cannot,
        // and every one of those would be reported as a difference we invented.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-hidden",
                customerName: "최고객",
                documentName: "계약",
                stepRecipientName: "송진호",
            }),
        ]);
        const service = createService("true");
        const log = jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(
            createQuery({ search: "최고객" }),
            { documentIds: [], oldestCreatedAt: undefined },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
        expect(log.mock.calls[0]?.[0]).toContain("match");
    });

    it("runs one comparison at a time and says how many it skipped", async () => {
        // Every list request would otherwise load the whole branch mirror and sort it,
        // competing with the served requests for the same connection pool.
        let release: (() => void) | undefined;
        repository.findAll.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve([]);
        }));
        const service = createService("true");
        const log = jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);

        const served = { documentIds: [], oldestCreatedAt: undefined };
        service.compareInBackground(createQuery(), served);
        service.compareInBackground(createQuery(), served);
        service.compareInBackground(createQuery(), served);
        expect(repository.findAll).toHaveBeenCalledTimes(1);

        release?.();
        await settle();
        await settle();

        // The run that got through reports what it displaced, so the log says how much of
        // the traffic this evidence actually covers.
        expect(log.mock.calls[0]?.[0]).toContain("skippedWhileBusy=2");
    });

    it("reads the headquarters scope from the repository method that includes unclaimed rows", async () => {
        repository.findAllForHeadquarters.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-hq" }),
        ]);
        const service = createService("true");
        jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);

        service.compareInBackground(
            createQuery({ isHeadquarters: true }),
            { documentIds: ["doc-hq"], oldestCreatedAt: undefined },
        );
        await settle();

        expect(repository.findAllForHeadquarters).toHaveBeenCalledWith("branch-1");
        // findAll is still consulted, but only for the recipient-name search corpus the
        // served path builds the same way — not for which documents the list contains.
        expect(repository.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("attributes documents older than the served scan window separately", async () => {
        // The served path scans at most 10 vendor pages of 100 and warns that older
        // contracts fall outside it. Counting those as disagreements would make the
        // zero-diff gate unreachable for any company past a thousand documents, while
        // they are in fact what the switch recovers.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-new", createdDate: "2026-07-05T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-ancient", createdDate: "2024-01-01T00:00:00.000Z" }),
        ]);
        const service = createService("true");
        const log = jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(createQuery(), {
            documentIds: ["doc-new"],
            oldestCreatedAt: Date.parse("2026-07-05T00:00:00.000Z"),
        });
        await settle();

        expect(warn).not.toHaveBeenCalled();
        expect(log.mock.calls[0]?.[0]).toContain("beyondScanWindow=1");
    });

    it("searches headquarters recipient names from branch-owned rows only", async () => {
        // The served path builds its recipient-name corpus from findAll(branchId), so an
        // unassigned document's recipient name is not searchable there. Searching it here
        // would report a difference that is this comparison's, not the mirror's.
        const unassigned = createMirrorDocument({
            documentId: "doc-unassigned",
            customerName: null,
            documentName: null,
            stepRecipientName: "박수신",
        });
        repository.findAllForHeadquarters.mockResolvedValue([unassigned]);
        repository.findAll.mockResolvedValue([]);
        const service = createService("true");
        const log = jest.spyOn(
            (service as unknown as { logger: { log: (message: string) => void } }).logger,
            "log",
        ).mockImplementation(() => undefined);
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(
            createQuery({ isHeadquarters: true, search: "박수신" }),
            { documentIds: [], oldestCreatedAt: undefined },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
        expect(log.mock.calls[0]?.[0]).toContain("match");
    });

    it("keeps the search term itself out of the log", async () => {
        // Searches are customer names often enough that the term does not belong in a
        // centralised log, and a raw value could break the log line apart.
        repository.findAll.mockResolvedValue([]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        service.compareInBackground(
            createQuery({ search: "김민수\n[Shadow] injected" }),
            { documentIds: ["doc-missing"], oldestCreatedAt: undefined },
        );
        await settle();

        const message = warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("search=present");
        expect(message).not.toContain("김민수");
        expect(message).not.toContain("injected");
    });

    it("never lets a comparison failure escape into the request", async () => {
        // The response has already been sent by the time this runs; throwing here would
        // become an unhandled rejection, not an error the caller could do anything with.
        repository.findAll.mockRejectedValue(new Error("mirror unavailable"));
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        expect(() => service.compareInBackground(createQuery(), {
            documentIds: [],
            oldestCreatedAt: undefined,
        })).not.toThrow();
        await settle();

        expect(warn.mock.calls[0]?.[0]).toContain("comparison failed");
    });
});
