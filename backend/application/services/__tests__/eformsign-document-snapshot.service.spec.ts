import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";
import Redis from "ioredis";

import {
    DocumentSnapshotEntry,
    DocumentSnapshotKeyParams,
    DocumentSnapshotScope,
    EformsignDocumentSnapshotService,
} from "application/services/eformsign-document-snapshot.service";

interface SnapshotExclusionLookup {
    findListExcludedDocumentIds: jest.Mock<Promise<string[]>, []>;
    findUnreadyCompletedDocumentIds: jest.Mock<Promise<string[]>, []>;
    findPermanentPurgeRequestedDocumentIds: jest.Mock<Promise<string[]>, []>;
}

jest.mock("ioredis", () => ({
    __esModule: true,
    default: jest.fn(),
}));

interface TestDocument {
    id: string;
}

interface MemoryEntryView {
    expiresAt: number;
    payload: string;
}

interface SnapshotServiceInternals {
    memoryStore: Map<string, MemoryEntryView>;
    snapshotKey(params: DocumentSnapshotKeyParams, version: number): string;
}

interface RedisStub {
    status: string;
    on: jest.Mock<RedisStub, [string, (...args: unknown[]) => void]>;
    connect: jest.Mock<Promise<void>, []>;
    disconnect: jest.Mock<void, []>;
    get: jest.Mock<Promise<string | null>, [string]>;
    set: jest.Mock<Promise<unknown>, [string, string, string, number]>;
    incr: jest.Mock<Promise<number>, [string]>;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

const MockedRedis = Redis as unknown as jest.MockedClass<typeof Redis>;
const originalValkeyUrl = process.env["VALKEY_URL"];

function createEntry(id: string): DocumentSnapshotEntry<TestDocument> {
    return {
        document: { id },
        searchIndex: [id],
    };
}

interface TenantOverrides {
    scope?: DocumentSnapshotScope;
    branchId?: string;
    isHeadquarters?: boolean;
}

function createParams(
    overrides: TenantOverrides & { accessToken?: string } = {},
): DocumentSnapshotKeyParams {
    return {
        branchId: "branch-a",
        scope: "all",
        accessToken: "access-token",
        ...overrides,
    };
}

/** The mirror variant takes no credential at all — that is the point of the union. */
function createMirrorParams(overrides: TenantOverrides = {}): DocumentSnapshotKeyParams {
    return {
        branchId: "branch-a",
        scope: "all",
        source: "mirror",
        ...overrides,
    };
}

function createDeferred<T>(): Deferred<T> {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
        throw new Error("Deferred promise resolve was not initialized");
    };
    let rejectPromise: (reason?: unknown) => void = () => {
        throw new Error("Deferred promise reject was not initialized");
    };
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    return {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
    };
}

function createRedisStub(overrides: Partial<RedisStub> = {}): RedisStub {
    const stub: RedisStub = {
        status: "ready",
        on: jest.fn<RedisStub, [string, (...args: unknown[]) => void]>(),
        connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
        disconnect: jest.fn<void, []>(),
        get: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
        set: jest.fn<Promise<unknown>, [string, string, string, number]>().mockResolvedValue("OK"),
        incr: jest.fn<Promise<number>, [string]>().mockResolvedValue(1),
        ...overrides,
    };
    stub.on.mockReturnValue(stub);
    return stub;
}

function createSnapshotExclusionLookup(
    excludedDocumentIds: string[] = [],
): SnapshotExclusionLookup {
    return {
        findListExcludedDocumentIds: jest.fn().mockResolvedValue(
            excludedDocumentIds,
        ),
        findUnreadyCompletedDocumentIds: jest.fn().mockResolvedValue([]),
        findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
    };
}

function useRedisStub(redis: RedisStub): void {
    process.env["VALKEY_URL"] = "redis://valkey.test:6379";
    MockedRedis.mockImplementationOnce(() => redis as unknown as Redis);
}

describe("EformsignDocumentSnapshotService", () => {
    beforeEach(() => {
        delete process.env["VALKEY_URL"];
        MockedRedis.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();

        if (originalValkeyUrl === undefined) {
            delete process.env["VALKEY_URL"];
        } else {
            process.env["VALKEY_URL"] = originalValkeyUrl;
        }
    });

    it("should build once, store the snapshot, and return a cache hit for the same key", async () => {
        const service = new EformsignDocumentSnapshotService();
        const entries = [createEntry("document-1")];
        const build = jest.fn().mockResolvedValue(entries);

        const first = await service.getOrBuild(createParams(), build);
        const second = await service.getOrBuild(createParams(), build);

        expect(first).toEqual({
            entries,
            snapshotVersion: expect.stringMatching(/^0:\d+$/),
            cached: false,
        });
        expect(second).toEqual({
            entries,
            snapshotVersion: first.snapshotVersion,
            cached: true,
        });
        expect(build).toHaveBeenCalledTimes(1);
    });

    it("should retain tombstones for default all reads while fencing permanent purge intent", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const redis = createRedisStub();
        let snapshotPayload: string | null = null;
        redis.get.mockImplementation(async (key) => {
            if (key === "eformsign:doclist-version:branch-a") {
                return "0";
            }
            return snapshotPayload;
        });
        redis.set.mockImplementation(async (key, value) => {
            if (key.startsWith("eformsign:doclist:")) {
                snapshotPayload = value;
            }
            return "OK";
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const staleEntries = [
            createEntry("safe-document"),
            createEntry("purge-pending-document"),
            createEntry("tombstoned-document"),
        ];
        const build = jest.fn().mockResolvedValue(staleEntries);

        const initialResult = await service.getOrBuild(createMirrorParams(), build);
        redis.incr.mockRejectedValueOnce(new Error("Valkey unavailable during purge invalidation"));
        await expect(service.bumpVersion("branch-a")).resolves.toBeNull();
        exclusionLookup.findPermanentPurgeRequestedDocumentIds.mockResolvedValue([
            "purge-pending-document",
        ]);
        exclusionLookup.findListExcludedDocumentIds.mockResolvedValue([
            "purge-pending-document",
            "tombstoned-document",
        ]);

        const defaultResult = await service.getOrBuild(createMirrorParams(), build);
        const deletionFilteredResult = await service.getOrBuild(
            createMirrorParams(),
            build,
            { excludeTombstones: true },
        );

        expect(build).toHaveBeenCalledTimes(1);
        expect(defaultResult).toEqual({
            entries: [
                createEntry("safe-document"),
                createEntry("tombstoned-document"),
            ],
            snapshotVersion: expect.stringMatching(/^0:\d+:f[0-9a-f]{12}$/),
            cached: true,
        });
        expect(deletionFilteredResult).toEqual({
            entries: [createEntry("safe-document")],
            snapshotVersion: expect.stringMatching(/^0:\d+:f[0-9a-f]{12}$/),
            cached: true,
        });
        expect(defaultResult.snapshotVersion).not.toBe(initialResult.snapshotVersion);
        expect(deletionFilteredResult.snapshotVersion).not.toBe(defaultResult.snapshotVersion);
    });

    it("should fence an unready completed row from a stale mirror snapshot after a version bump fails", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const redis = createRedisStub();
        let snapshotPayload: string | null = null;
        redis.get.mockImplementation(async (key) => {
            if (key === "eformsign:doclist-version:branch-a") {
                return "0";
            }
            return snapshotPayload;
        });
        redis.set.mockImplementation(async (key, value) => {
            if (key.startsWith("eformsign:doclist:")) {
                snapshotPayload = value;
            }
            return "OK";
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const build = jest.fn().mockResolvedValue([
            createEntry("safe-document"),
            createEntry("completed-syncing-document"),
        ]);

        const initialResult = await service.getOrBuild(createMirrorParams(), build);
        redis.incr.mockRejectedValueOnce(
            new Error("Valkey unavailable during completed mirror invalidation"),
        );
        await expect(service.bumpVersion("branch-a")).resolves.toBeNull();
        exclusionLookup.findUnreadyCompletedDocumentIds.mockResolvedValue([
            "completed-syncing-document",
        ]);

        const result = await service.getOrBuild(createMirrorParams(), build);

        expect(build).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            entries: [createEntry("safe-document")],
            snapshotVersion: expect.stringMatching(/^0:\d+:f[0-9a-f]{12}$/),
            cached: true,
        });
        expect(result.snapshotVersion).not.toBe(initialResult.snapshotVersion);

        const sameFence = await service.getOrBuild(createMirrorParams(), build);
        expect(sameFence.snapshotVersion).toBe(result.snapshotVersion);

        exclusionLookup.findUnreadyCompletedDocumentIds.mockResolvedValue([]);
        const restored = await service.getOrBuild(createMirrorParams(), build);
        expect(restored.entries).toEqual([
            createEntry("safe-document"),
            createEntry("completed-syncing-document"),
        ]);
        expect(restored.snapshotVersion).toBe(initialResult.snapshotVersion);
    });

    it("should preserve a cached pagination generation when a ready-row bump fails", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const redis = createRedisStub();
        let snapshotPayload: string | null = null;
        redis.get.mockImplementation(async (key) => {
            if (key === "eformsign:doclist-version:branch-a") {
                return "0";
            }
            return snapshotPayload;
        });
        redis.set.mockImplementation(async (key, value) => {
            if (key.startsWith("eformsign:doclist:")) {
                snapshotPayload = value;
            }
            return "OK";
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        let liveEntries = [createEntry("safe-document")];
        const build = jest.fn(async () => liveEntries);

        const initial = await service.getOrBuild(createMirrorParams(), build);
        redis.incr.mockRejectedValueOnce(
            new Error("Valkey unavailable during ready publication"),
        );
        await expect(service.bumpVersion("branch-a")).resolves.toBeNull();
        liveEntries = [
            createEntry("safe-document"),
            createEntry("newly-ready-document"),
        ];

        const cached = await service.getOrBuild(createMirrorParams(), build);

        expect(build).toHaveBeenCalledTimes(1);
        expect(cached.entries).toEqual([createEntry("safe-document")]);
        expect(cached.snapshotVersion).toBe(initial.snapshotVersion);

        snapshotPayload = null;
        const rebuilt = await service.getOrBuild(createMirrorParams(), build);
        expect(build).toHaveBeenCalledTimes(2);
        expect(rebuilt.entries).toEqual(liveEntries);
        expect(rebuilt.cached).toBe(false);
    });

    it("should apply the readiness fence only to mirror snapshots", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        exclusionLookup.findUnreadyCompletedDocumentIds.mockResolvedValue(["document-1"]);
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const entry = createEntry("document-1");

        const result = await service.getOrBuild(
            createParams(),
            jest.fn().mockResolvedValue([entry]),
        );

        expect(result.entries).toEqual([entry]);
        expect(exclusionLookup.findUnreadyCompletedDocumentIds).not.toHaveBeenCalled();
    });

    it("should keep the base generation when live exclusions do not affect membership", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const build = jest.fn().mockResolvedValue([createEntry("document-1")]);

        const initial = await service.getOrBuild(createMirrorParams(), build);
        exclusionLookup.findUnreadyCompletedDocumentIds.mockResolvedValue([
            "not-in-this-snapshot",
        ]);
        const cached = await service.getOrBuild(createMirrorParams(), build);

        expect(cached.entries).toEqual(initial.entries);
        expect(cached.snapshotVersion).toBe(initial.snapshotVersion);
    });

    it("should fail closed when the mirror readiness fence is unavailable", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const fenceError = new Error("mirror readiness lookup unavailable");
        exclusionLookup.findUnreadyCompletedDocumentIds.mockRejectedValue(fenceError);

        await expect(service.getOrBuild(
            createMirrorParams(),
            jest.fn().mockResolvedValue([createEntry("document-1")]),
        )).rejects.toBe(fenceError);
    });

    it("should exclude a tombstoned unassigned document from a stale headquarters snapshot after its epoch bump fails", async () => {
        const exclusionLookup = createSnapshotExclusionLookup();
        const redis = createRedisStub();
        let snapshotPayload: string | null = null;
        redis.get.mockImplementation(async (key) => {
            if (
                key === "eformsign:doclist-version:branch-a"
                || key === "eformsign:doclist-epoch"
            ) {
                return "0";
            }
            return snapshotPayload;
        });
        redis.set.mockImplementation(async (key, value) => {
            if (key.startsWith("eformsign:doclist:")) {
                snapshotPayload = value;
            }
            return "OK";
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService(exclusionLookup);
        const build = jest.fn().mockResolvedValue([
            createEntry("hq-safe-document"),
            createEntry("unassigned-tombstoned-document"),
        ]);
        const headquartersParams = createMirrorParams({ isHeadquarters: true });

        await service.getOrBuild(headquartersParams, build);
        redis.incr.mockRejectedValueOnce(
            new Error("Valkey unavailable during tombstone epoch invalidation"),
        );
        await expect(service.bumpCompanyEpoch()).resolves.toBeUndefined();
        exclusionLookup.findListExcludedDocumentIds.mockResolvedValue([
            "unassigned-tombstoned-document",
        ]);

        const result = await service.getOrBuild(
            headquartersParams,
            build,
            { excludeTombstones: true },
        );

        expect(build).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            entries: [createEntry("hq-safe-document")],
            snapshotVersion: expect.stringMatching(/^0:\d+:f[0-9a-f]{12}$/),
            cached: true,
        });
    });

    it("should fence both a cache-miss owner and in-flight waiter immediately before returning", async () => {
        const purgeLookup = createSnapshotExclusionLookup();
        const service = new EformsignDocumentSnapshotService(purgeLookup);
        const entries = [createEntry("safe-document"), createEntry("purge-pending-document")];
        const deferred = createDeferred<DocumentSnapshotEntry<TestDocument>[]>();
        const build = jest.fn(() => deferred.promise);

        // One lookup per return (owner, waiter). Snapshots are no longer filtered a third time
        // at storage; return-time filtering is the single place visibility is decided.
        purgeLookup.findPermanentPurgeRequestedDocumentIds
            .mockResolvedValueOnce(["purge-pending-document"])
            .mockResolvedValueOnce(["purge-pending-document"]);
        const owner = service.getOrBuild(createMirrorParams(), build);
        const waiter = service.getOrBuild(createMirrorParams(), build);
        await Promise.resolve();
        await Promise.resolve();

        deferred.resolve(entries);
        const [ownerResult, waiterResult] = await Promise.all([owner, waiter]);

        expect(build).toHaveBeenCalledTimes(1);
        expect(ownerResult.entries).toEqual([createEntry("safe-document")]);
        expect(waiterResult.entries).toEqual([createEntry("safe-document")]);
        expect(purgeLookup.findPermanentPurgeRequestedDocumentIds).toHaveBeenCalledTimes(2);
    });

    it("should fail closed when the cache-miss return fence is unavailable", async () => {
        const purgeLookup = createSnapshotExclusionLookup();
        const service = new EformsignDocumentSnapshotService(purgeLookup);
        const fenceError = new Error("purge lookup unavailable at return");
        const build = jest.fn().mockResolvedValue([createEntry("document-1")]);

        // The first lookup is now the return fence itself — the storage-time pass is gone.
        purgeLookup.findPermanentPurgeRequestedDocumentIds
            .mockRejectedValueOnce(fenceError);

        await expect(service.getOrBuild(createMirrorParams(), build)).rejects.toBe(fenceError);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it("should fail closed instead of returning a cached snapshot when the purge fence is unavailable", async () => {
        const purgeLookup = createSnapshotExclusionLookup();
        const service = new EformsignDocumentSnapshotService(purgeLookup);
        const entries = [createEntry("document-1")];
        const build = jest.fn().mockResolvedValue(entries);

        await service.getOrBuild(createMirrorParams(), build);
        const purgeLookupError = new Error("purge lookup unavailable");
        purgeLookup.findPermanentPurgeRequestedDocumentIds.mockRejectedValue(purgeLookupError);

        await expect(service.getOrBuild(createMirrorParams(), build)).rejects.toBe(
            purgeLookupError,
        );
        expect(build).toHaveBeenCalledTimes(1);
    });

    it("should share one build between two concurrent misses for the same key", async () => {
        const service = new EformsignDocumentSnapshotService();
        const entries = [createEntry("shared-document")];
        const deferred = createDeferred<DocumentSnapshotEntry<TestDocument>[]>();
        const build = jest.fn(() => deferred.promise);

        const firstPromise = service.getOrBuild(createParams(), build);
        const secondPromise = service.getOrBuild(createParams(), build);
        await Promise.resolve();
        await Promise.resolve();

        deferred.resolve(entries);
        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        expect(build).toHaveBeenCalledTimes(1);
        expect(first.entries).toEqual(entries);
        expect(second.entries).toEqual(entries);
        expect(second.snapshotVersion).toBe(first.snapshotVersion);
        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
    });

    it("should reject all waiters and clear the single-flight slot when the builder rejects", async () => {
        const service = new EformsignDocumentSnapshotService();
        const buildError = new Error("eformsign scan failed");
        const deferred = createDeferred<DocumentSnapshotEntry<TestDocument>[]>();
        const failedBuild = jest.fn(() => deferred.promise);

        const firstPromise = service.getOrBuild(createParams(), failedBuild);
        const secondPromise = service.getOrBuild(createParams(), failedBuild);
        const settlementsPromise = Promise.allSettled([firstPromise, secondPromise]);
        await Promise.resolve();
        await Promise.resolve();

        deferred.reject(buildError);
        const settlements = await settlementsPromise;

        expect(failedBuild).toHaveBeenCalledTimes(1);
        expect(settlements).toEqual([
            { status: "rejected", reason: buildError },
            { status: "rejected", reason: buildError },
        ]);

        await Promise.resolve();
        const retryEntries = [createEntry("retry-document")];
        const retryBuild = jest.fn().mockResolvedValue(retryEntries);
        const retry = await service.getOrBuild(createParams(), retryBuild);

        expect(retryBuild).toHaveBeenCalledTimes(1);
        expect(retry.entries).toEqual(retryEntries);
        expect(retry.cached).toBe(false);
    });

    it("should isolate snapshots by branch id", async () => {
        const service = new EformsignDocumentSnapshotService();
        const branchABuild = jest.fn().mockResolvedValue([createEntry("branch-a-document")]);
        const branchBBuild = jest.fn().mockResolvedValue([createEntry("branch-b-document")]);
        const branchAParams = createParams({ branchId: "branch-a" });
        const branchBParams = createParams({ branchId: "branch-b" });

        const branchAFirst = await service.getOrBuild(branchAParams, branchABuild);
        const branchBFirst = await service.getOrBuild(branchBParams, branchBBuild);
        const branchAHit = await service.getOrBuild(branchAParams, branchABuild);
        const branchBHit = await service.getOrBuild(branchBParams, branchBBuild);

        expect(branchAFirst.entries).toEqual([createEntry("branch-a-document")]);
        expect(branchBFirst.entries).toEqual([createEntry("branch-b-document")]);
        expect(branchAHit.entries).toEqual(branchAFirst.entries);
        expect(branchBHit.entries).toEqual(branchBFirst.entries);
        expect(branchABuild).toHaveBeenCalledTimes(1);
        expect(branchBBuild).toHaveBeenCalledTimes(1);
    });

    it("should isolate snapshots by document scope", async () => {
        const service = new EformsignDocumentSnapshotService();
        const allBuild = jest.fn().mockResolvedValue([createEntry("all-document")]);
        const inProgressBuild = jest.fn().mockResolvedValue([createEntry("in-progress-document")]);
        const allParams = createParams({ scope: "all" });
        const inProgressParams = createParams({ scope: "in-progress" });

        const allFirst = await service.getOrBuild(allParams, allBuild);
        const inProgressFirst = await service.getOrBuild(inProgressParams, inProgressBuild);
        const allHit = await service.getOrBuild(allParams, allBuild);
        const inProgressHit = await service.getOrBuild(inProgressParams, inProgressBuild);

        expect(allFirst.entries).toEqual([createEntry("all-document")]);
        expect(inProgressFirst.entries).toEqual([createEntry("in-progress-document")]);
        expect(allHit.entries).toEqual(allFirst.entries);
        expect(inProgressHit.entries).toEqual(inProgressFirst.entries);
        expect(allBuild).toHaveBeenCalledTimes(1);
        expect(inProgressBuild).toHaveBeenCalledTimes(1);
    });

    it("should rebuild an in-memory snapshot after the 300 second TTL expires", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-25T00:00:00.000Z"));
        const service = new EformsignDocumentSnapshotService();
        const build = jest.fn()
            .mockResolvedValueOnce([createEntry("before-expiry")])
            .mockResolvedValueOnce([createEntry("after-expiry")]);

        const first = await service.getOrBuild(createParams(), build);
        jest.advanceTimersByTime(299_999);
        const beforeExpiry = await service.getOrBuild(createParams(), build);
        jest.advanceTimersByTime(1);
        const afterExpiry = await service.getOrBuild(createParams(), build);

        expect(first.entries).toEqual([createEntry("before-expiry")]);
        expect(beforeExpiry.entries).toEqual(first.entries);
        expect(beforeExpiry.cached).toBe(true);
        expect(afterExpiry.entries).toEqual([createEntry("after-expiry")]);
        expect(afterExpiry.cached).toBe(false);
        expect(build).toHaveBeenCalledTimes(2);
    });

    it("should cache document display fields for exactly one hour", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
        const service = new EformsignDocumentSnapshotService();
        const enrichment = {
            fields: [{ id: "이용자 성명", value: "김고객" }],
            detail_template_info: [{ field_values: { "이용자 성명": "김고객" } }],
        };

        await service.setDisplayFieldEnrichment("document-1", "access-token", enrichment);

        await expect(
            service.getDisplayFieldEnrichment("document-1", "access-token"),
        ).resolves.toEqual(enrichment);
        jest.advanceTimersByTime(3_599_999);
        await expect(
            service.getDisplayFieldEnrichment("document-1", "access-token"),
        ).resolves.toEqual(enrichment);
        jest.advanceTimersByTime(1);
        await expect(
            service.getDisplayFieldEnrichment("document-1", "access-token"),
        ).resolves.toBeNull();
    });

    it("should store document display fields in Valkey with a one hour TTL", async () => {
        const redis = createRedisStub();
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService();
        const enrichment = {
            fields: [{ id: "이용자 성명", value: "김고객" }],
        };

        await service.setDisplayFieldEnrichment("document-1", "access-token", enrichment);
        redis.get.mockResolvedValue(JSON.stringify(enrichment));

        await expect(
            service.getDisplayFieldEnrichment("document-1", "access-token"),
        ).resolves.toEqual(enrichment);
        const tokenHash = createHash("sha256").update("access-token").digest("hex");
        expect(redis.set).toHaveBeenCalledWith(
            `eformsign:doc-display-fields:v1:document-1:${tokenHash}`,
            JSON.stringify(enrichment),
            "EX",
            3_600,
        );
    });

    it("should rebuild with a different snapshot version after bumpVersion", async () => {
        const service = new EformsignDocumentSnapshotService();
        const firstPageBuild = jest.fn().mockResolvedValue([createEntry("page-1-document")]);
        const secondPageBuild = jest.fn().mockResolvedValue([createEntry("page-2-document")]);
        const params = createParams();

        const firstPage = await service.getOrBuild(params, firstPageBuild);
        const bumpedVersion = await service.bumpVersion(params.branchId);
        const secondPage = await service.getOrBuild(params, secondPageBuild);

        expect(firstPage.snapshotVersion).toMatch(/^0:\d+$/);
        expect(bumpedVersion).toBe(1);
        expect(secondPage.snapshotVersion).toMatch(/^1:\d+$/);
        expect(secondPage.snapshotVersion).not.toBe(firstPage.snapshotVersion);
        expect(secondPage.entries).toEqual([createEntry("page-2-document")]);
        expect(secondPage.cached).toBe(false);
        expect(firstPageBuild).toHaveBeenCalledTimes(1);
        expect(secondPageBuild).toHaveBeenCalledTimes(1);
    });

    it("should use only the access token sha256 in cache keys and never store or log the raw token", async () => {
        const accessToken = "raw-secret-access-token";
        const params = createParams({ accessToken });
        const tokenHash = createHash("sha256").update(accessToken).digest("hex");
        // The data source is part of the key: a vendor snapshot and a mirror snapshot of
        // the same scope must never be served for one another, or flipping the switch back
        // would keep serving the source it was flipped away from.
        const expectedKey = `eformsign:doclist:v1:api:branch-a:all:${tokenHash}:0`;
        const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const service = new EformsignDocumentSnapshotService();
        const internals = service as unknown as SnapshotServiceInternals;
        const build = jest.fn().mockResolvedValue([createEntry("document-1")]);

        const directKey = internals.snapshotKey(params, 0);
        await service.getOrBuild(params, build);
        await service.getOrBuild(params, build);

        const storedEntries = Array.from(internals.memoryStore.entries());
        expect(storedEntries).toHaveLength(1);
        const storedEntry = storedEntries[0];
        if (!storedEntry) {
            throw new Error("Expected one stored snapshot");
        }
        const [storedKey, storedValue] = storedEntry;
        const loggedOutput = JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls]);

        expect(directKey).toBe(expectedKey);
        expect(storedKey).toBe(expectedKey);
        expect(storedKey).toContain(tokenHash);
        expect(storedKey).not.toContain(accessToken);
        expect(storedValue.payload).not.toContain(accessToken);
        expect(loggedOutput).not.toContain(accessToken);
    });

    it("should key a mirror snapshot by tenant alone, with no credential in it", async () => {
        // The mirror never calls the vendor, so nothing validates the token and nothing in
        // the result depends on it. Keying by it would only let one authenticated caller
        // store a fresh copy of the whole branch corpus per token string they invent.
        const service = new EformsignDocumentSnapshotService();
        const internals = service as unknown as SnapshotServiceInternals;
        const build = jest.fn().mockResolvedValue([createEntry("document-1")]);

        await service.getOrBuild(createMirrorParams(), build);
        await service.getOrBuild(createMirrorParams(), build);

        const storedKeys = Array.from(internals.memoryStore.keys());

        expect(storedKeys).toEqual(["eformsign:doclist:v1:mirror:branch-a:all:0"]);
        expect(build).toHaveBeenCalledTimes(1);
        // And still distinct from the vendor snapshot of the same scope, so flipping the
        // switch back does not keep serving the source it was flipped away from.
        expect(internals.snapshotKey(createParams(), 0)).not.toBe(storedKeys[0]);
    });

    it("should bypass the cache and omit snapshotVersion when Valkey lookup fails", async () => {
        const redis = createRedisStub({
            get: jest.fn<Promise<string | null>, [string]>()
                .mockRejectedValue(new Error("Valkey unavailable")),
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService();
        const entries = [createEntry("fresh-document")];
        const build = jest.fn().mockResolvedValue(entries);

        const result = await service.getOrBuild(createParams(), build);

        expect(result).toEqual({ entries, cached: false });
        expect("snapshotVersion" in result).toBe(false);
        expect(build).toHaveBeenCalledTimes(1);
        expect(redis.get).toHaveBeenCalledWith("eformsign:doclist-version:branch-a");
        expect(redis.set).not.toHaveBeenCalled();
    });

    it("should quietly return null when bumpVersion fails in Valkey", async () => {
        const redis = createRedisStub({
            incr: jest.fn<Promise<number>, [string]>()
                .mockRejectedValue(new Error("Valkey unavailable")),
        });
        useRedisStub(redis);
        const service = new EformsignDocumentSnapshotService();

        await expect(service.bumpVersion("branch-a")).resolves.toBeNull();
        // 회사 epoch를 먼저 올린다(본사 뷰 무효화) — 이 첫 INCR에서 실패하면 조용히 null.
        expect(redis.incr).toHaveBeenCalledWith("eformsign:doclist-epoch");
    });
});
