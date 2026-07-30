import {
    EformsignMirrorNotReadyError,
    EformsignMirrorReadinessService,
} from "application/services/eformsign-mirror-readiness.service";

describe("EformsignMirrorReadinessService", () => {
    const version = new Date("2026-07-30T00:00:00.000Z");
    const complete = (overrides: Record<string, unknown> = {}) => ({
        syncStatus: "ready",
        detailSourceUpdatedDate: version,
        files: [
            { fileType: "document", sourceUpdatedDate: version },
            { fileType: "audit_trail", sourceUpdatedDate: version },
        ],
        ...overrides,
    });

    it("passes only when every active detail and completed PDF is local", async () => {
        const count = jest.fn()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0);
        const service = new EformsignMirrorReadinessService({
            eformsign_doc: { count, findMany: jest.fn().mockResolvedValue([complete()]) },
        } as never);

        await expect(service.assertReady()).resolves.toEqual({
            ready: true,
            missingDetails: 0,
            completedWithoutDocumentPdf: 0,
            completedWithoutAuditTrailPdf: 0,
            unfinishedSyncs: 0,
        });
        expect(count).toHaveBeenCalledTimes(2);
    });

    it("fails closed with bounded counts when the initial backfill is incomplete", async () => {
        const count = jest.fn()
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(3);
        const service = new EformsignMirrorReadinessService({
            eformsign_doc: {
                count,
                findMany: jest.fn().mockResolvedValue([
                    complete({ files: [] }),
                ]),
            },
        } as never);

        await expect(service.assertReady()).rejects.toEqual(
            expect.objectContaining({
                name: EformsignMirrorNotReadyError.name,
                readiness: {
                    ready: false,
                    missingDetails: 2,
                    completedWithoutDocumentPdf: 1,
                    completedWithoutAuditTrailPdf: 1,
                    unfinishedSyncs: 3,
                },
            }),
        );
    });

    it("fails closed for stale-version PDFs, partial syncs, and a null detail version", async () => {
        const count = jest.fn().mockResolvedValue(0);
        const service = new EformsignMirrorReadinessService({
            eformsign_doc: {
                count,
                findMany: jest.fn().mockResolvedValue([
                    complete({ files: [
                        { fileType: "document", sourceUpdatedDate: new Date(version.getTime() - 1) },
                        { fileType: "audit_trail", sourceUpdatedDate: version },
                    ] }),
                    complete({ syncStatus: "partial" }),
                    complete({ detailSourceUpdatedDate: null }),
                ]),
            },
        } as never);

        await expect(service.inspect()).resolves.toEqual({
            ready: false,
            missingDetails: 0,
            completedWithoutDocumentPdf: 3,
            completedWithoutAuditTrailPdf: 2,
            unfinishedSyncs: 0,
        });
    });
});
