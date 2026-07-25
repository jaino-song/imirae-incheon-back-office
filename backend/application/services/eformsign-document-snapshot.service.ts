import { createHash } from "node:crypto";

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

/**
 * 계약 목록 읽기 경로별 스냅샷 스코프. 외부 eformsign 목록 엔드포인트가 서로 다른
 * 문서 집합을 돌려주므로(전체 / 진행중 / 완료 / 반려) 캐시 키를 반드시 분리해야 한다.
 */
export type DocumentSnapshotScope = "all" | "in-progress" | "completed" | "rejected";

/**
 * 스냅샷에 담기는 문서 1건. 문서 본문/파일은 넣지 않고, 외부 "목록" API가 준
 * 목록용 필드와 검색 인덱스(문서에서 파생된 정규화 문자열)만 보관한다.
 */
export interface DocumentSnapshotEntry<TDoc> {
    document: TDoc;
    searchIndex: string[];
}

export interface DocumentSnapshotResult<TDoc> {
    entries: DocumentSnapshotEntry<TDoc>[];
    /**
     * `{version}:{builtAt}` 형식. 캐시가 우회(bypass)된 요청에서는 undefined이며,
     * 이때 응답에서 snapshot_version 키 자체를 생략한다.
     */
    snapshotVersion?: string;
    /** 저장된 스냅샷을 재사용했는지(true) 새로 스캔했는지(false). */
    cached: boolean;
}

export interface DocumentSnapshotKeyParams {
    scope: DocumentSnapshotScope;
    branchId: string;
    accessToken: string;
}

interface StoredSnapshot<TDoc> {
    version: number;
    builtAt: number;
    entries: DocumentSnapshotEntry<TDoc>[];
}

interface MemoryEntry {
    expiresAt: number;
    payload: string;
}

const SNAPSHOT_KEY_PREFIX = "eformsign:doclist";
const VERSION_KEY_PREFIX = "eformsign:doclist-version";
const SNAPSHOT_TTL_SECONDS = 5 * 60;
/** 목록 스냅샷 하나가 이보다 커지면 저장을 건너뛴다(Valkey 메모리 보호). */
const SNAPSHOT_MAX_BYTES = 4_000_000;

/**
 * 지점 단위 eformsign 문서 목록 스냅샷 캐시.
 *
 * 목적: 계약 목록 페이지를 넘길 때마다 외부 eformsign 회사 목록을 전수 스캔
 * (최대 10페이지 × 100건)하지 않도록, 정렬까지 끝난 목록을 지점별로 5분간 보관한다.
 *
 * 저장 위치 결정과 실패 정책:
 * - `VALKEY_URL` 미설정 → 프로세스 로컬 in-memory Map (로컬 개발/테스트, 단일 인스턴스 전제).
 * - `VALKEY_URL` 설정 + 런타임 오류 → 캐시를 통째로 우회한다. 호출부는 그대로 새로 스캔하고
 *   응답에서 snapshot_version을 생략한다. 이 경우 in-memory로 대체하지 않는다(인스턴스별로
 *   서로 다른 스냅샷이 남아 지점 간 일관성이 깨지므로). 요청 경로로 예외를 던지지 않는다.
 *
 * 액세스 토큰은 원문을 저장하거나 로그로 남기지 않는다. 키에는 sha256 해시만 쓴다.
 */
@Injectable()
export class EformsignDocumentSnapshotService implements OnModuleDestroy {
    private readonly logger = new Logger(EformsignDocumentSnapshotService.name);
    private readonly redis: Redis | null;
    private readonly memoryStore = new Map<string, MemoryEntry>();
    private readonly memoryVersions = new Map<string, number>();
    /** 같은 키에 대한 동시 미스는 스캔 promise 하나를 공유한다(프로세스 단위 single-flight). */
    private readonly inFlight = new Map<string, Promise<StoredSnapshot<unknown>>>();

    constructor() {
        const valkeyUrl = process.env["VALKEY_URL"]?.trim();
        this.redis = valkeyUrl
            ? new Redis(valkeyUrl, {
                lazyConnect: true,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: 2_000,
            })
            : null;
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis) {
            this.redis.disconnect();
        }
    }

    /**
     * 지점별 캐시 세대(version). 이 값이 올라가면 이전 세대 키는 더 이상 조회되지 않는다.
     * 캐시를 우회해야 하는 상태(Valkey 오류)면 null을 돌려준다.
     */
    async getVersion(branchId: string): Promise<number | null> {
        if (!this.redis) {
            return this.memoryVersions.get(branchId) ?? 0;
        }

        try {
            await this.ensureRedisConnected();
            const raw = await this.redis.get(this.versionKey(branchId));
            if (raw === null) {
                return 0;
            }
            const parsed = Number.parseInt(raw, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (error) {
            this.logger.warn(
                `Snapshot version lookup failed for branch ${branchId}; bypassing snapshot cache: ${describeError(error)}`,
            );
            return null;
        }
    }

    /**
     * 지점 캐시 세대를 1 올려 해당 지점의 모든 스냅샷을 즉시 무효화한다.
     * (문서 생성/삭제 등 변경 흐름에서 호출할 용도 — 현재는 호출부 없음.)
     * 캐시를 우회해야 하는 상태면 null을 돌려준다.
     */
    async bumpVersion(branchId: string): Promise<number | null> {
        if (!this.redis) {
            const next = (this.memoryVersions.get(branchId) ?? 0) + 1;
            this.memoryVersions.set(branchId, next);
            this.dropMemoryEntriesForBranch(branchId);
            return next;
        }

        try {
            await this.ensureRedisConnected();
            return await this.redis.incr(this.versionKey(branchId));
        } catch (error) {
            this.logger.warn(
                `Snapshot version bump failed for branch ${branchId}: ${describeError(error)}`,
            );
            return null;
        }
    }

    /**
     * 스냅샷이 있으면 그대로, 없으면 `build()`로 만들어 저장한 뒤 돌려준다.
     * 같은 키에 대한 동시 미스는 하나의 `build()`만 실행한다.
     */
    async getOrBuild<TDoc>(
        params: DocumentSnapshotKeyParams,
        build: () => Promise<DocumentSnapshotEntry<TDoc>[]>,
    ): Promise<DocumentSnapshotResult<TDoc>> {
        const version = await this.getVersion(params.branchId);
        if (version === null) {
            return { entries: await build(), cached: false };
        }

        const key = this.snapshotKey(params, version);
        const read = await this.readSnapshot<TDoc>(key);
        if (read.status === "error") {
            return { entries: await build(), cached: false };
        }
        if (read.status === "hit") {
            this.logger.log(
                `documentSnapshot hit branch=${params.branchId} scope=${params.scope} docs=${read.snapshot.entries.length}`,
            );
            return {
                entries: read.snapshot.entries,
                snapshotVersion: formatSnapshotVersion(read.snapshot),
                cached: true,
            };
        }

        const inFlight = this.inFlight.get(key);
        if (inFlight) {
            const shared = (await inFlight) as StoredSnapshot<TDoc>;
            return {
                entries: shared.entries,
                snapshotVersion: formatSnapshotVersion(shared),
                cached: true,
            };
        }

        const pending = this.buildAndStore(key, version, params, build);
        this.inFlight.set(key, pending as Promise<StoredSnapshot<unknown>>);
        // 성공/실패와 무관하게 in-flight 슬롯을 비운다. 실패 자체는 호출부가 await 하며 처리한다.
        void pending.catch(() => undefined).finally(() => this.inFlight.delete(key));

        const snapshot = await pending;
        return {
            entries: snapshot.entries,
            snapshotVersion: formatSnapshotVersion(snapshot),
            cached: false,
        };
    }

    private async buildAndStore<TDoc>(
        key: string,
        version: number,
        params: DocumentSnapshotKeyParams,
        build: () => Promise<DocumentSnapshotEntry<TDoc>[]>,
    ): Promise<StoredSnapshot<TDoc>> {
        const entries = await build();
        const snapshot: StoredSnapshot<TDoc> = { version, builtAt: Date.now(), entries };
        await this.writeSnapshot(key, snapshot, params);
        return snapshot;
    }

    private async readSnapshot<TDoc>(key: string): Promise<
        | { status: "hit"; snapshot: StoredSnapshot<TDoc> }
        | { status: "miss" }
        | { status: "error" }
    > {
        let payload: string | null;

        if (!this.redis) {
            const entry = this.memoryStore.get(key);
            if (!entry) {
                return { status: "miss" };
            }
            if (entry.expiresAt <= Date.now()) {
                this.memoryStore.delete(key);
                return { status: "miss" };
            }
            payload = entry.payload;
        } else {
            try {
                await this.ensureRedisConnected();
                payload = await this.redis.get(key);
            } catch (error) {
                this.logger.warn(`Snapshot read failed; bypassing snapshot cache: ${describeError(error)}`);
                return { status: "error" };
            }
        }

        if (payload === null) {
            return { status: "miss" };
        }

        try {
            const parsed = JSON.parse(payload) as StoredSnapshot<TDoc>;
            if (!parsed || !Array.isArray(parsed.entries)) {
                return { status: "miss" };
            }
            return { status: "hit", snapshot: parsed };
        } catch {
            return { status: "miss" };
        }
    }

    private async writeSnapshot<TDoc>(
        key: string,
        snapshot: StoredSnapshot<TDoc>,
        params: DocumentSnapshotKeyParams,
    ): Promise<void> {
        const payload = JSON.stringify(snapshot);
        if (Buffer.byteLength(payload, "utf8") > SNAPSHOT_MAX_BYTES) {
            this.logger.warn(
                `documentSnapshot too large to cache branch=${params.branchId} scope=${params.scope} docs=${snapshot.entries.length}`,
            );
            return;
        }

        if (!this.redis) {
            this.pruneMemoryStore();
            this.memoryStore.set(key, {
                expiresAt: Date.now() + SNAPSHOT_TTL_SECONDS * 1_000,
                payload,
            });
            return;
        }

        try {
            await this.ensureRedisConnected();
            await this.redis.set(key, payload, "EX", SNAPSHOT_TTL_SECONDS);
        } catch (error) {
            this.logger.warn(`Snapshot write failed; snapshot not cached: ${describeError(error)}`);
        }
    }

    private snapshotKey(params: DocumentSnapshotKeyParams, version: number): string {
        const tokenHash = createHash("sha256").update(params.accessToken).digest("hex");
        return `${SNAPSHOT_KEY_PREFIX}:${params.branchId}:${params.scope}:${tokenHash}:${version}`;
    }

    private versionKey(branchId: string): string {
        return `${VERSION_KEY_PREFIX}:${branchId}`;
    }

    private dropMemoryEntriesForBranch(branchId: string): void {
        const prefix = `${SNAPSHOT_KEY_PREFIX}:${branchId}:`;
        for (const key of this.memoryStore.keys()) {
            if (key.startsWith(prefix)) {
                this.memoryStore.delete(key);
            }
        }
    }

    private pruneMemoryStore(): void {
        const now = Date.now();
        for (const [key, entry] of this.memoryStore) {
            if (entry.expiresAt <= now) {
                this.memoryStore.delete(key);
            }
        }
    }

    private async ensureRedisConnected(): Promise<void> {
        if (this.redis?.status === "wait") {
            await this.redis.connect();
        }
        if (this.redis?.status !== "ready") {
            throw new Error(`Valkey connection is ${this.redis?.status ?? "missing"}`);
        }
    }
}

function formatSnapshotVersion(snapshot: { version: number; builtAt: number }): string {
    return `${snapshot.version}:${snapshot.builtAt}`;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}
