import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";
import Redis from "ioredis";

import {
    DocumentSnapshotEntry,
    DocumentSnapshotKeyParams,
    EformsignDocumentSnapshotService,
} from "application/services/eformsign-document-snapshot.service";

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

function createParams(overrides: Partial<DocumentSnapshotKeyParams> = {}): DocumentSnapshotKeyParams {
    return {
        branchId: "branch-a",
        scope: "all",
        accessToken: "access-token",
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
    return {
        status: "ready",
        connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
        disconnect: jest.fn<void, []>(),
        get: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
        set: jest.fn<Promise<unknown>, [string, string, string, number]>().mockResolvedValue("OK"),
        incr: jest.fn<Promise<number>, [string]>().mockResolvedValue(1),
        ...overrides,
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
        const expectedKey = `eformsign:doclist:branch-a:all:${tokenHash}:0`;
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
        expect(redis.incr).toHaveBeenCalledWith("eformsign:doclist-version:branch-a");
    });
});
