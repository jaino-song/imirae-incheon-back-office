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

            service.compareInBackground(createQuery(), { documentIds: ["a"], totalRows: 1 });
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
            totalRows: 2,
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
            totalRows: 2,
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
            totalRows: 2,
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
            { documentIds: ["doc-keep"], totalRows: 1 },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
    });

    it("searches the mirror by customer name, recipient name and 초성", async () => {
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-kim", customerName: "김고객" }),
            createMirrorDocument({ documentId: "doc-lee", customerName: "이고객" }),
        ]);
        const service = createService("true");
        const warn = jest.spyOn(
            (service as unknown as { logger: { warn: (message: string) => void } }).logger,
            "warn",
        ).mockImplementation(() => undefined);

        // 초성 검색은 startsWith 규칙이라 "ㄱㄱ"은 김고객만 집는다.
        service.compareInBackground(
            createQuery({ search: "ㄱㄱ" }),
            { documentIds: ["doc-kim"], totalRows: 1 },
        );
        await settle();

        expect(warn).not.toHaveBeenCalled();
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
            { documentIds: ["doc-hq"], totalRows: 1 },
        );
        await settle();

        expect(repository.findAllForHeadquarters).toHaveBeenCalledWith("branch-1");
        expect(repository.findAll).not.toHaveBeenCalled();
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
            totalRows: 0,
        })).not.toThrow();
        await settle();

        expect(warn.mock.calls[0]?.[0]).toContain("comparison failed");
    });
});
