import { Prisma } from "@prisma/client";

import { EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES } from "domain/constants/eformsign-doc-status.constants";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";

describe("SbEformsignDocumentMirrorRepository", () => {
    const detailVersion = new Date("2026-07-30T00:00:00.000Z");
    const syncedAt = new Date("2026-07-30T00:01:00.000Z");

    function transactionMock(prisma: object): jest.Mock {
        return jest.fn().mockImplementation(async (operation: unknown) => {
            if (typeof operation === "function") {
                return operation(prisma);
            }
            return Promise.all(operation as Promise<unknown>[]);
        });
    }

    it("finds unready completed rows and hides every completed row before sync_status exists", async () => {
        const missingSyncStatus = Object.assign(
            new Error("The column `eformsign_doc.sync_status` does not exist"),
            {
                code: "P2022",
                meta: { column: "eformsign_doc.sync_status" },
            },
        );
        const findMany = jest.fn()
            .mockResolvedValueOnce([{ documentId: "syncing-document" }])
            .mockRejectedValueOnce(missingSyncStatus)
            .mockResolvedValueOnce([{ documentId: "legacy-completed-document" }]);
        const repository = new SbEformsignDocumentMirrorRepository({
            eformsign_doc: { findMany },
        } as never);

        await expect(repository.findUnreadyCompletedDocumentIds())
            .resolves.toEqual(["syncing-document"]);
        await expect(repository.findUnreadyCompletedDocumentIds())
            .resolves.toEqual(["legacy-completed-document"]);

        const completedValues = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES];
        expect(findMany).toHaveBeenNthCalledWith(1, {
            where: {
                statusType: { in: completedValues },
                syncStatus: { not: "ready" },
            },
            select: { documentId: true },
        });
        expect(findMany).toHaveBeenNthCalledWith(3, {
            where: {
                statusType: { in: completedValues },
            },
            select: { documentId: true },
        });
    });

    it("returns a file only when it belongs to the current non-purged detail", async () => {
        const file = {
            fileType: "document",
            content: Buffer.from("pdf"),
            contentType: "application/pdf",
            contentDisposition: null,
            byteSize: 3,
            sha256: "a".repeat(64),
            sourceUpdatedDate: detailVersion,
            syncedAt,
        };
        const prisma = {
            eformsign_doc: {
                findUnique: jest.fn()
                    .mockResolvedValueOnce({
                        detailPayload: { id: "doc-1" },
                        detailSourceUpdatedDate: detailVersion,
                        syncStatus: "ready",
                        permanentPurgeRequestedAt: null,
                        files: [file],
                    })
                    .mockResolvedValueOnce({
                        detailPayload: { id: "doc-1" },
                        detailSourceUpdatedDate: detailVersion,
                        syncStatus: "ready",
                        permanentPurgeRequestedAt: null,
                        files: [{ ...file, sourceUpdatedDate: syncedAt }],
                    })
                    .mockResolvedValueOnce({
                        detailPayload: null,
                        detailSourceUpdatedDate: detailVersion,
                        syncStatus: "ready",
                        permanentPurgeRequestedAt: null,
                        files: [file],
                    })
                    .mockResolvedValueOnce({
                        detailPayload: { id: "doc-1" },
                        detailSourceUpdatedDate: detailVersion,
                        syncStatus: "partial",
                        permanentPurgeRequestedAt: null,
                        files: [file],
                    })
                    .mockResolvedValueOnce({
                        detailPayload: { id: "doc-1" },
                        detailSourceUpdatedDate: detailVersion,
                        syncStatus: "ready",
                        permanentPurgeRequestedAt: syncedAt,
                        files: [file],
                    }),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.findFile("doc-1", "document")).resolves.toMatchObject({
            content: Buffer.from("pdf"),
        });
        await expect(repository.findFile("doc-1", "document")).resolves.toBeNull();
        await expect(repository.findFile("doc-1", "document")).resolves.toBeNull();
        await expect(repository.findFile("doc-1", "document")).resolves.toBeNull();
        await expect(repository.findFile("doc-1", "document")).resolves.toBeNull();
    });

    it("acquires a same-version retry only from its observed non-ready attempt", async () => {
        const prisma = {
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 1 }),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.saveDetail({
            documentId: "doc-1",
            detailPayload: { id: "doc-1" } as never,
            customerPhone: null,
            sourceUpdatedDate: detailVersion,
            expectedDetailSyncedAt: new Date("2026-07-29T23:59:00.000Z"),
            allowReadySameVersionRepair: false,
            syncedAt,
        })).resolves.toBe(false);

        expect(prisma.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["047", "049", "099"] },
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        AND: [
                            { detailSourceUpdatedDate: detailVersion },
                            {
                                detailSyncedAt:
                                    new Date("2026-07-29T23:59:00.000Z"),
                            },
                            { syncStatus: { not: "ready" } },
                        ],
                    }),
                ]),
            }),
        }));
    });

    it("acquires a fresh fenced attempt for an explicit same-version ready repair", async () => {
        const expectedAttempt = new Date("2026-07-29T23:59:00.000Z");
        const prisma = {
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUniqueOrThrow: jest.fn(),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.saveDetail({
            documentId: "doc-1",
            detailPayload: { id: "doc-1" } as never,
            customerPhone: null,
            sourceUpdatedDate: detailVersion,
            expectedDetailSyncedAt: expectedAttempt,
            allowReadySameVersionRepair: true,
            syncedAt,
        })).resolves.toBe(true);

        const update = prisma.eformsign_doc.updateMany.mock.calls[0]?.[0];
        const sameVersionAttempt = update.where.OR.find((condition: {
            AND?: unknown[];
        }) => condition.AND);
        expect(sameVersionAttempt.AND).toEqual([
            { detailSourceUpdatedDate: detailVersion },
            { detailSyncedAt: expectedAttempt },
        ]);
        expect(update.where.permanentPurgeRequestedAt).toBeNull();
        expect(update.where.statusType).toEqual({
            notIn: ["047", "049", "099"],
        });
    });

    it("fences integrity failure reports to the exact ready file that was read", async () => {
        const prisma = {
            eformsign_doc: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await repository.markFileIntegrityFailure({
            documentId: "doc-1",
            fileType: "document",
            sourceUpdatedDate: detailVersion,
            syncedAt,
            sha256: "a".repeat(64),
            message: "integrity mismatch",
        });

        expect(prisma.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                detailSourceUpdatedDate: detailVersion,
                syncStatus: "ready",
                permanentPurgeRequestedAt: null,
                files: {
                    some: {
                        fileType: "document",
                        sourceUpdatedDate: detailVersion,
                        syncedAt,
                        sha256: "a".repeat(64),
                    },
                },
            }),
            data: expect.objectContaining({ syncStatus: "failed" }),
        }));
    });

    it("fences a file write when a purge or newer detail owns the document", async () => {
        const prisma = {
            eformsign_doc: {
                findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 1 }),
            },
            eformsign_doc_file: {
                updateMany: jest.fn(),
                create: jest.fn(),
            },
            $queryRaw: jest.fn().mockResolvedValue([]),
        };
        (prisma as { $transaction?: jest.Mock }).$transaction = transactionMock(prisma);
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.saveFile({
            documentId: "doc-1",
            fileType: "document",
            content: Buffer.from("pdf"),
            contentType: "application/pdf",
            contentDisposition: null,
            byteSize: 3,
            sha256: "a".repeat(64),
            sourceUpdatedDate: detailVersion,
            syncedAt,
        })).resolves.toBe(false);
        const [fenceQuery] = prisma.$queryRaw.mock.calls[0] ?? [];
        expect(fenceQuery.strings.join(" "))
            .toContain("permanent_purge_requested_at IS NULL");
        expect(fenceQuery.strings.join(" "))
            .toContain("status_type NOT IN ('047', '049', '099')");

        expect(prisma.eformsign_doc_file.updateMany).not.toHaveBeenCalled();
        expect(prisma.eformsign_doc_file.create).not.toHaveBeenCalled();
    });

    it("returns false instead of downgrading ready state when a competing sync owns the generation", async () => {
        const prisma = {
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.markSyncFinished(
            "doc-1",
            detailVersion,
            syncedAt,
            "partial",
            "audit unavailable",
        )).resolves.toBe(false);
        await repository.markSyncFailed("doc-1", detailVersion, syncedAt, "download failed");

        expect(prisma.eformsign_doc.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({
                detailSyncedAt: syncedAt,
                syncStatus: "syncing",
                permanentPurgeRequestedAt: null,
            }),
        }));
        expect(prisma.eformsign_doc.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({
                detailSyncedAt: syncedAt,
                syncStatus: "syncing",
                permanentPurgeRequestedAt: null,
            }),
        }));
    });

    it("returns true when the current generation becomes ready", async () => {
        const prisma = {
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.markSyncFinished(
            "doc-1",
            detailVersion,
            syncedAt,
            "ready",
        )).resolves.toBe(true);
    });

    it("purges files, mirrored PII, and client/service-record associations while retaining an authorization tombstone", async () => {
        const prisma = {
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            eformsign_doc_file: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            client: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $queryRaw: jest.fn().mockResolvedValue([{ id: 11, documentId: "doc-1" }]),
        };
        (prisma as { $transaction?: jest.Mock }).$transaction = transactionMock(prisma);
        const repository = new SbEformsignDocumentMirrorRepository(
            prisma as never,
        );
        const deletedAt = new Date("2026-07-30T00:00:00.000Z");

        await repository.purgeContent(["doc-1"], deletedAt);

        expect(prisma.client.updateMany).toHaveBeenCalledWith({
            where: { eDocId: { in: ["doc-1"] } },
            data: { eDocId: null },
        });
        expect(prisma.eformsign_doc_file.deleteMany).toHaveBeenCalledWith({
            where: { eformsignDocId: { in: [11] } },
        });
        expect(prisma.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: { id: { in: [11] } },
            data: expect.objectContaining({
                statusType: "049",
                statusDetail: "영구 삭제",
                customerName: null,
                customerPhone: null,
                creatorName: null,
                lastEditorName: null,
                clientId: null,
                documentKind: null,
                employeeScheduleId: null,
                serviceRecordCaseId: null,
                snapshotVersion: null,
                snapshotChunkIndex: null,
                detailPayload: Prisma.DbNull,
                detailSourceUpdatedDate: deletedAt,
                detailSyncedAt: deletedAt,
                syncStatus: "ready",
                permanentPurgeRequestedAt: null,
            }),
        });
        expect((prisma as { $transaction?: jest.Mock }).$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("serializes a concurrent tombstone after purge without restoring stale PII or purge intent", async () => {
        function deferred(): { promise: Promise<void>; resolve: () => void } {
            let resolve!: () => void;
            return {
                promise: new Promise<void>((done) => {
                    resolve = done;
                }),
                resolve,
            };
        }

        const stalePayload = {
            id: "doc-1",
            fields: [{ id: "이용자 연락처", value: "01012345678" }],
            current_status: { status_type: "050" },
        };
        const state: {
            detailPayload: object | null;
            customerPhone: string | null;
            permanentPurgeRequestedAt: Date | null;
        } = {
            detailPayload: stalePayload,
            customerPhone: "01012345678",
            permanentPurgeRequestedAt: new Date("2026-07-30T00:00:00.000Z"),
        };
        const markStarted = deferred();
        const purgeReleased = deferred();
        const lockAcquisitionOrder: string[] = [];
        const lockQueries: string[] = [];
        const transactionModes: string[] = [];

        const rootUpdate = jest.fn(async (args: {
            data: { detailPayload?: object | null };
        }) => {
            // The old implementation builds this stale write from findMany
            // before it starts any transaction. Let purge win, then expose the
            // write-back if the implementation still has that race.
            await purgeReleased.promise;
            if (Object.prototype.hasOwnProperty.call(args.data, "detailPayload")) {
                state.detailPayload = args.data.detailPayload ?? null;
            }
        });
        const purgeUpdate = jest.fn(async (args: {
            data: {
                detailPayload?: object | null;
                customerPhone?: string | null;
                permanentPurgeRequestedAt?: Date | null;
            };
        }) => {
            state.detailPayload = args.data.detailPayload === Prisma.DbNull
                ? null
                : args.data.detailPayload ?? null;
            state.customerPhone = args.data.customerPhone ?? null;
            state.permanentPurgeRequestedAt = args.data.permanentPurgeRequestedAt ?? null;
            return { count: 1 };
        });
        const deleteFiles = jest.fn().mockResolvedValue({ count: 2 });
        const clearClientDocument = jest.fn().mockResolvedValue({ count: 1 });
        const prisma = {
            eformsign_doc: {
                // Deliberately expose stale PII for the pre-transaction read in
                // the old implementation. The current implementation must not
                // call this at all.
                findMany: jest.fn(async () => {
                    markStarted.resolve();
                    return [{ id: 11, detailPayload: stalePayload }];
                }),
                update: rootUpdate,
                updateMany: purgeUpdate,
            },
            eformsign_doc_file: {
                deleteMany: deleteFiles,
            },
            client: {
                updateMany: clearClientDocument,
            },
            $transaction: jest.fn(async (operation: unknown) => {
                if (typeof operation !== "function") {
                    transactionModes.push("array");
                    return Promise.all(operation as Promise<unknown>[]);
                }
                transactionModes.push("callback");
                let lockOwner: "purge" | "mark" | null = null;
                const transaction = {
                    eformsign_doc: {
                        update: rootUpdate,
                        updateMany: purgeUpdate,
                    },
                    eformsign_doc_file: {
                        deleteMany: deleteFiles,
                    },
                    client: {
                        updateMany: clearClientDocument,
                    },
                    $queryRaw: async (query: unknown) => {
                        const text = (query as { strings?: readonly string[] })
                            .strings?.join("?") ?? "";
                        lockQueries.push(text);
                        if (text.includes('detail_payload AS "detailPayload"')) {
                            markStarted.resolve();
                            // The purge transaction obtains the shared parent
                            // lock first; this read must occur only afterward.
                            await purgeReleased.promise;
                            lockOwner = "mark";
                            lockAcquisitionOrder.push(lockOwner);
                            return [{ id: 11, detailPayload: state.detailPayload }];
                        }
                        lockOwner = "purge";
                        lockAcquisitionOrder.push(lockOwner);
                        return [{ id: 11, documentId: "doc-1" }];
                    },
                };
                const result = await (operation as (tx: typeof transaction) => Promise<unknown>)(transaction);
                if (lockOwner === "purge") {
                    purgeReleased.resolve();
                }
                return result;
            }),
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        const markPromise = repository.markDeleted(
            ["doc-1"],
            new Date("2026-07-30T00:01:00.000Z"),
        );
        await markStarted.promise;
        const purgePromise = repository.purgeContent(
            ["doc-1"],
            new Date("2026-07-30T00:00:00.000Z"),
        );
        await Promise.all([purgePromise, markPromise]);

        expect(transactionModes).toEqual(["callback", "callback"]);
        expect(lockAcquisitionOrder).toEqual(["purge", "mark"]);
        expect(lockQueries).toHaveLength(2);
        expect(lockQueries.every((query) => query.includes("ORDER BY id"))).toBe(true);
        expect(lockQueries.every((query) => query.includes("FOR UPDATE"))).toBe(true);
        expect(prisma.eformsign_doc.findMany).not.toHaveBeenCalled();
        expect(state.detailPayload).toBeNull();
        expect(state.customerPhone).toBeNull();
        expect(state.permanentPurgeRequestedAt).toBeNull();
        const tombstoneUpdate = rootUpdate.mock.calls.at(-1)?.[0];
        if (!tombstoneUpdate) {
            throw new Error("expected the locked tombstone update");
        }
        expect(tombstoneUpdate.data).not.toHaveProperty("detailPayload");
        expect(tombstoneUpdate.data).not.toHaveProperty("customerPhone");
        expect(tombstoneUpdate.data).not.toHaveProperty("permanentPurgeRequestedAt");
    });

    it("keeps a newer permanent-purge request when an older generation clears", async () => {
        let pendingGeneration: Date | null = null;
        const transaction = {
            $queryRaw: jest.fn().mockImplementation(async () => [{
                documentId: "doc-1",
                permanentPurgeRequestedAt: pendingGeneration,
            }]),
            eformsign_doc: {
                update: jest.fn().mockImplementation(async ({ data }) => {
                    pendingGeneration = data.permanentPurgeRequestedAt;
                    return {};
                }),
                updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
                    const matches = pendingGeneration?.getTime()
                        === where.permanentPurgeRequestedAt.getTime();
                    if (matches) {
                        pendingGeneration = data.permanentPurgeRequestedAt;
                    }
                    return { count: matches ? 1 : 0 };
                }),
            },
        };
        const prisma = {
            $transaction: transactionMock(transaction),
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        const [older] = await repository.requestPermanentPurge(["doc-1"]);
        const [newer] = await repository.requestPermanentPurge(["doc-1"]);
        if (!older || !newer) {
            throw new Error("expected a generation for doc-1");
        }
        await expect(repository.clearPermanentPurgeRequest([older])).resolves.toEqual([]);

        expect(newer.generation.getTime()).toBeGreaterThan(older.generation.getTime());
        expect(pendingGeneration).toEqual(newer.generation);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                documentId: "doc-1",
                permanentPurgeRequestedAt: older.generation,
            },
            data: { permanentPurgeRequestedAt: null },
        });
    });

    it("excludes pending permanent purges from active synchronization", async () => {
        const prisma = {
            eformsign_doc: {
                findMany: jest.fn().mockResolvedValue([{ documentId: "doc-1" }]),
            },
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.findActiveDocumentIds()).resolves.toEqual(["doc-1"]);

        expect(prisma.eformsign_doc.findMany).toHaveBeenCalledWith({
            where: {
                statusType: { not: "049" },
                permanentPurgeRequestedAt: null,
            },
            select: { documentId: true },
        });
    });

    it("refuses the vendor delete precondition when any purge intent was not persisted", async () => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ documentId: "doc-1" }]),
        };
        const prisma = {
            $transaction: transactionMock(transaction),
        };
        const repository = new SbEformsignDocumentMirrorRepository(prisma as never);

        await expect(repository.requestPermanentPurge(
            ["doc-1", "doc-2", "doc-1"],
        )).rejects.toThrow(/every document/i);

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    });
});
