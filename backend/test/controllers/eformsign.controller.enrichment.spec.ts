import { Logger } from "@nestjs/common";

import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignController } from "interface/controllers/eformsign.controller";

type TestListDocument = {
    id: string;
    fields?: unknown;
    detail_template_info?: unknown;
    document_name?: string;
};

interface EnrichmentController {
    enrichDocumentsWithDisplayFields(
        branchId: string,
        accessToken: string,
        documents: TestListDocument[],
    ): Promise<TestListDocument[]>;
}

describe("EformsignController display-field enrichment", () => {
    const originalConcurrency = process.env["EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY"];
    const eformsignService = {
        getDocumentById: jest.fn(),
    };
    const eformsignDocService = {
        findDisplayFieldsByDocumentIds: jest.fn(),
    };

    let snapshotService: EformsignDocumentSnapshotService;
    let controller: EnrichmentController;

    beforeEach(() => {
        delete process.env["EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY"];
        snapshotService = new EformsignDocumentSnapshotService();
        controller = new EformsignController(
            eformsignService as never,
            {} as never,
            eformsignDocService as never,
            {} as never,
            {} as never,
            snapshotService,
        ) as unknown as EnrichmentController;
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([]);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        await snapshotService.onModuleDestroy();

        if (originalConcurrency === undefined) {
            delete process.env["EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY"];
        } else {
            process.env["EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY"] = originalConcurrency;
        }
    });

    it("should use the local page lookup and skip the detail API on a local hit", async () => {
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([
            { documentId: "doc-1", customerName: "로컬 고객" },
        ]);

        const result = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "doc-1" }],
        );

        expect(result).toEqual([
            {
                id: "doc-1",
                fields: [{ id: "이용자 성명", value: "로컬 고객" }],
            },
        ]);
        expect(eformsignDocService.findDisplayFieldsByDocumentIds).toHaveBeenCalledWith(
            "branch-1",
            ["doc-1"],
        );
        expect(eformsignService.getDocumentById).not.toHaveBeenCalled();
    });

    it("should fall back to the API when the local name is the document title sentinel", async () => {
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([
            { documentId: "doc-1", customerName: "산모신생아 건강관리 서비스 표준계약서" },
        ]);
        eformsignService.getDocumentById.mockResolvedValue({
            fields: [{ id: "이용자 성명", value: "실제 고객" }],
        });

        const result = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "doc-1", document_name: "산모신생아 건강관리 서비스 표준계약서" }],
        );

        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(1);
        expect(result[0]?.fields).toEqual([{ id: "이용자 성명", value: "실제 고객" }]);
    });

    it("should reuse cached API display fields on the next enrichment", async () => {
        eformsignService.getDocumentById.mockResolvedValue({
            fields: [{ id: "이용자 성명", value: "API 고객" }],
        });

        const first = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "doc-1" }],
        );
        const second = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "doc-1" }],
        );

        expect(second).toEqual(first);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(1);
    });

    it("should isolate cached API display fields by access token", async () => {
        eformsignService.getDocumentById
            .mockResolvedValueOnce({
                fields: [{ id: "이용자 성명", value: "첫 토큰 고객" }],
            })
            .mockResolvedValueOnce({
                fields: [{ id: "이용자 성명", value: "둘째 토큰 고객" }],
            });

        const first = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token-1",
            [{ id: "doc-1" }],
        );
        const second = await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token-2",
            [{ id: "doc-1" }],
        );

        expect(first[0]?.fields).toEqual([{ id: "이용자 성명", value: "첫 토큰 고객" }]);
        expect(second[0]?.fields).toEqual([{ id: "이용자 성명", value: "둘째 토큰 고객" }]);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(2);
    });

    it("should retry the detail API twice with exponential backoff after 429 responses", async () => {
        jest.useFakeTimers();
        eformsignService.getDocumentById
            .mockRejectedValueOnce(new Error("Failed to get document: 429 - rate limited"))
            .mockRejectedValueOnce(new Error("Failed to get document: 429 - rate limited"))
            .mockResolvedValueOnce({
                fields: [{ id: "이용자 성명", value: "재시도 고객" }],
            });

        const enrichment = controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "doc-1" }],
        );
        await jest.advanceTimersByTimeAsync(2_000);

        await expect(enrichment).resolves.toEqual([
            {
                id: "doc-1",
                fields: [{ id: "이용자 성명", value: "재시도 고객" }],
            },
        ]);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(3);
        jest.useRealTimers();
    });

    it("should preserve the list document when the API fallback fails", async () => {
        eformsignService.getDocumentById.mockRejectedValue(new Error("detail failed"));

        await expect(
            controller.enrichDocumentsWithDisplayFields(
                "branch-1",
                "access-token",
                [{ id: "doc-1" }],
            ),
        ).resolves.toEqual([{ id: "doc-1" }]);

        expect(eformsignService.getDocumentById).toHaveBeenCalledWith(
            "access-token",
            "doc-1",
        );
    });

    it("should honor the detail enrichment concurrency environment override", async () => {
        process.env["EFORMSIGN_DETAIL_ENRICHMENT_CONCURRENCY"] = "2";
        let activeCalls = 0;
        let maxActiveCalls = 0;
        let release: () => void = () => undefined;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        eformsignService.getDocumentById.mockImplementation(async () => {
            activeCalls += 1;
            maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
            await barrier;
            activeCalls -= 1;
            return {};
        });

        const enrichmentPromise = controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            Array.from({ length: 5 }, (_, index) => ({ id: `doc-${index + 1}` })),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(2);
        release();
        await enrichmentPromise;
        expect(maxActiveCalls).toBe(2);
    });

    it("should log local, cache, and API fallback counts in one enrichment line", async () => {
        const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([
            { documentId: "local-doc", customerName: "로컬 고객" },
        ]);
        await snapshotService.setDisplayFieldEnrichment("cached-doc", "access-token", {
            fields: [{ id: "이용자 성명", value: "캐시 고객" }],
        });
        eformsignService.getDocumentById.mockResolvedValue({
            fields: [{ id: "이용자 성명", value: "API 고객" }],
        });

        await controller.enrichDocumentsWithDisplayFields(
            "branch-1",
            "access-token",
            [{ id: "local-doc" }, { id: "cached-doc" }, { id: "api-doc" }],
        );

        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(
            /^enrichDocumentsWithDisplayFields docs=3 localHits=1 cacheHits=1 apiFallbacks=1 tookMs=\d+$/,
        ));
    });
});
