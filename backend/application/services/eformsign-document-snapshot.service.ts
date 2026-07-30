import { createHash } from "node:crypto";

import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

import {
    EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";

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

interface DocumentSnapshotTenantParams {
    scope: DocumentSnapshotScope;
    branchId: string;
    /** 본사(HQ) 뷰 여부 — true면 키에 회사 epoch가 포함돼 타 지점 변이로도 무효화된다. */
    isHeadquarters?: boolean;
}

/**
 * 스냅샷 키를 결정하는 값들. `source`로 갈라진 이유는 두 가지다.
 *
 * 첫째, 벤더 스캔 결과와 로컬 미러 결과가 같은 키를 쓰면 전환 스위치를 되돌려도 최대
 * 5분간 이전 출처의 스냅샷이 계속 나간다 — 긴급 롤백이 즉시 듣지 않는다는 뜻이라
 * 스위치를 두는 이유 자체가 사라진다.
 *
 * 둘째, 미러 경로는 자격증명을 아예 받지 않는다. 스캔 결과는 accessToken에 따라 달라지고
 * 잘못된 토큰은 벤더에서 먼저 거부돼 스냅샷이 만들어지지 않지만, 미러는 토큰을 검증하지도
 * 사용하지도 않는다. 그런 값을 키에 넣으면 구분되는 것은 없고, 인증된 호출자 한 명이
 * 서로 다른 토큰 문자열을 계속 보내는 것만으로 지점 전체 목록을 5분짜리로 무한히 쌓을 수
 * 있다. 타입으로 막아 실수로도 넘기지 못하게 한다.
 */
export type DocumentSnapshotKeyParams =
    | (DocumentSnapshotTenantParams & {
        source?: "api";
        /** 스캔이 사용한 자격증명. 결과가 이 값에 따라 달라지므로 키에 들어간다. */
        accessToken: string;
    })
    | (DocumentSnapshotTenantParams & {
        source: "mirror";
        accessToken?: never;
    });

export interface DocumentDisplayFieldEnrichment {
    fields?: unknown;
    detail_template_info?: unknown;
}

interface StoredSnapshot<TDoc> {
    version: number;
    builtAt: number;
    entries: DocumentSnapshotEntry<TDoc>[];
}

interface BuildOutcome<TDoc> {
    snapshot: StoredSnapshot<TDoc>;
    /** false면 캐시에 저장되지 못했다(크기 초과·Valkey 오류) — snapshotVersion을 내보내지 않는다. */
    stored: boolean;
}

interface MemoryEntry {
    expiresAt: number;
    payload: string;
}

const SNAPSHOT_KEY_PREFIX = "eformsign:doclist";
const VERSION_KEY_PREFIX = "eformsign:doclist-version";
const DISPLAY_FIELD_KEY_PREFIX = "eformsign:doc-display-fields:v1";
/**
 * 회사 전체 세대(epoch). 본사(HQ) 뷰는 "다른 지점 소유분 제외 + 미배정 포함"이라
 * 어느 지점의 변이든 본사 목록을 바꿀 수 있다 — 본사 키에는 이 값이 함께 들어가
 * 임의 지점 bump(또는 미배정 문서 변이)로도 본사 스냅샷이 즉시 무효화된다.
 */
const COMPANY_EPOCH_KEY = "eformsign:doclist-epoch";
const SNAPSHOT_TTL_SECONDS = 5 * 60;
const DISPLAY_FIELD_TTL_SECONDS = 60 * 60;
/** 목록 스냅샷 하나가 이보다 커지면 저장을 건너뛴다(Valkey 메모리 보호). */
const SNAPSHOT_MAX_BYTES = 4_000_000;
const DISPLAY_FIELD_MAX_BYTES = 64_000;
/** 스냅샷 페이로드·검색 인덱스 구조가 바뀔 때 올린다 — 배포 직후 이전 구조 스냅샷 재사용을 차단. */
const SNAPSHOT_SCHEMA_VERSION = 1;
/** in-memory 저장소 상한(FIFO 축출) — Valkey 없는 환경에서 무한 성장으로 인한 OOM 방지. */
const MEMORY_STORE_MAX_ENTRIES = 32;
const DISPLAY_FIELD_MEMORY_STORE_MAX_ENTRIES = 512;

type SnapshotExclusionLookup = Pick<
    IEformsignDocumentMirrorRepository,
    | "findListExcludedDocumentIds"
    | "findUnreadyCompletedDocumentIds"
    | "findPermanentPurgeRequestedDocumentIds"
>;

/** Direct unit construction has no Nest container; production DI must provide the repository token. */
const NO_SNAPSHOT_EXCLUSIONS: SnapshotExclusionLookup = {
    findListExcludedDocumentIds: async () => [],
    findUnreadyCompletedDocumentIds: async () => [],
    findPermanentPurgeRequestedDocumentIds: async () => [],
};

export interface DocumentSnapshotReturnOptions {
    /**
     * The common snapshot retains tombstones for default "all" reads. Tabs and
     * deletion-filtered requests must fence a stale generation by current row id.
     */
    excludeTombstones?: boolean;
}

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
    private readonly displayFieldMemoryStore = new Map<string, MemoryEntry>();
    private readonly memoryVersions = new Map<string, number>();
    private memoryCompanyEpoch = 0;
    /** 같은 키에 대한 동시 미스는 스캔 promise 하나를 공유한다(프로세스 단위 single-flight). */
    private readonly inFlight = new Map<string, Promise<BuildOutcome<unknown>>>();

    constructor(
        @Inject(EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY)
        private readonly snapshotExclusionLookup: SnapshotExclusionLookup = NO_SNAPSHOT_EXCLUSIONS,
    ) {
        const valkeyUrl = process.env["VALKEY_URL"]?.trim();
        this.redis = valkeyUrl
            ? new Redis(valkeyUrl, {
                lazyConnect: true,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: 2_000,
            })
            : null;
        // ioredis는 'error' 리스너가 없으면 원시 스택을 console로 쏟아내고, 일부 내부
        // 불변식 위반은 하드 emit으로 프로세스를 죽일 수 있다 — 항상 리스너를 단다.
        this.redis?.on("error", (error) => {
            this.logger.warn(`Valkey client error: ${describeError(error)}`);
        });
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis) {
            this.redis.disconnect();
        }
    }

    async getDisplayFieldEnrichment(
        documentId: string,
        accessToken: string,
    ): Promise<DocumentDisplayFieldEnrichment | null> {
        const key = this.displayFieldKey(documentId, accessToken);
        let payload: string | null;

        if (!this.redis) {
            const entry = this.displayFieldMemoryStore.get(key);
            if (!entry) {
                return null;
            }
            if (entry.expiresAt <= Date.now()) {
                this.displayFieldMemoryStore.delete(key);
                return null;
            }
            payload = entry.payload;
        } else {
            try {
                await this.ensureRedisConnected();
                payload = await this.redis.get(key);
            } catch (error) {
                this.logger.warn(
                    `Display field cache read failed; bypassing cache: ${describeError(error)}`,
                );
                return null;
            }
        }

        if (payload === null) {
            return null;
        }

        try {
            const parsed = JSON.parse(payload) as unknown;
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                return null;
            }
            return parsed as DocumentDisplayFieldEnrichment;
        } catch {
            return null;
        }
    }

    async setDisplayFieldEnrichment(
        documentId: string,
        accessToken: string,
        enrichment: DocumentDisplayFieldEnrichment,
    ): Promise<void> {
        const key = this.displayFieldKey(documentId, accessToken);
        let payload: string;
        try {
            payload = JSON.stringify(enrichment);
        } catch (error) {
            this.logger.warn(
                `Document display fields could not be serialized for caching: ${describeError(error)}`,
            );
            return;
        }
        if (Buffer.byteLength(payload, "utf8") > DISPLAY_FIELD_MAX_BYTES) {
            this.logger.warn("Document display fields are too large to cache");
            return;
        }

        if (!this.redis) {
            this.pruneDisplayFieldMemoryStore();
            while (this.displayFieldMemoryStore.size >= DISPLAY_FIELD_MEMORY_STORE_MAX_ENTRIES) {
                const oldestKey = this.displayFieldMemoryStore.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }
                this.displayFieldMemoryStore.delete(oldestKey);
            }
            this.displayFieldMemoryStore.set(key, {
                expiresAt: Date.now() + DISPLAY_FIELD_TTL_SECONDS * 1_000,
                payload,
            });
            return;
        }

        try {
            await this.ensureRedisConnected();
            await this.redis.set(key, payload, "EX", DISPLAY_FIELD_TTL_SECONDS);
        } catch (error) {
            this.logger.warn(
                `Display field cache write failed; result not cached: ${describeError(error)}`,
            );
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
     * 문서 생성·동기화·삭제처럼 목록을 바꾸는 쓰기 흐름에서 호출한다.
     * 캐시를 우회해야 하는 상태면 null을 돌려준다.
     */
    async bumpVersion(branchId: string): Promise<number | null> {
        if (!this.redis) {
            const next = (this.memoryVersions.get(branchId) ?? 0) + 1;
            this.memoryVersions.set(branchId, next);
            this.memoryCompanyEpoch += 1;
            this.dropMemoryEntriesForBranch(branchId);
            return next;
        }

        try {
            await this.ensureRedisConnected();
            await this.redis.incr(COMPANY_EPOCH_KEY);
            return await this.redis.incr(this.versionKey(branchId));
        } catch (error) {
            this.logger.warn(
                `Snapshot version bump failed for branch ${branchId}: ${describeError(error)}`,
            );
            return null;
        }
    }

    /**
     * 미배정(지점 미매핑) 문서만 바뀐 변이에서 호출한다 — 지점 버전은 그대로 두고
     * 본사(HQ) 스냅샷만 무효화한다. 실패는 조용히 삼킨다.
     */
    async bumpCompanyEpoch(): Promise<void> {
        if (!this.redis) {
            this.memoryCompanyEpoch += 1;
            return;
        }

        try {
            await this.ensureRedisConnected();
            await this.redis.incr(COMPANY_EPOCH_KEY);
        } catch (error) {
            this.logger.warn(`Company epoch bump failed: ${describeError(error)}`);
        }
    }

    private async getCompanyEpoch(): Promise<number | null> {
        if (!this.redis) {
            return this.memoryCompanyEpoch;
        }

        try {
            await this.ensureRedisConnected();
            const raw = await this.redis.get(COMPANY_EPOCH_KEY);
            if (raw === null) {
                return 0;
            }
            const parsed = Number.parseInt(raw, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (error) {
            this.logger.warn(`Company epoch lookup failed; bypassing snapshot cache: ${describeError(error)}`);
            return null;
        }
    }

    /**
     * 스냅샷이 있으면 그대로, 없으면 `build()`로 만들어 저장한 뒤 돌려준다.
     * 같은 키에 대한 동시 미스는 하나의 `build()`만 실행한다.
     * 저장에 실패(크기 초과·Valkey 오류)한 스냅샷은 snapshotVersion을 내보내지 않는다 —
     * 요청마다 builtAt이 달라져 클라이언트가 드리프트 리셋 루프에 빠지는 것을 막는다.
     */
    async getOrBuild<TDoc>(
        params: DocumentSnapshotKeyParams,
        build: () => Promise<DocumentSnapshotEntry<TDoc>[]>,
        returnOptions: DocumentSnapshotReturnOptions = {},
    ): Promise<DocumentSnapshotResult<TDoc>> {
        const version = await this.getVersion(params.branchId);
        if (version === null) {
            return {
                entries: await this.excludeSnapshotEntries(
                    await this.buildSafeEntries(build, params.source),
                    returnOptions,
                    params.source,
                ),
                cached: false,
            };
        }
        let keyVersion = `${version}`;
        if (params.isHeadquarters) {
            const epoch = await this.getCompanyEpoch();
            if (epoch === null) {
                return {
                    entries: await this.excludeSnapshotEntries(
                        await this.buildSafeEntries(build, params.source),
                        returnOptions,
                        params.source,
                    ),
                    cached: false,
                };
            }
            keyVersion = `${version}e${epoch}`;
        }

        const key = this.snapshotKey(params, keyVersion);
        const read = await this.readSnapshot<TDoc>(key);
        if (read.status === "error") {
            return {
                entries: await this.excludeSnapshotEntries(
                    await this.buildSafeEntries(build, params.source),
                    returnOptions,
                    params.source,
                ),
                cached: false,
            };
        }
        if (read.status === "hit") {
            const entries = await this.excludeSnapshotEntries(
                read.snapshot.entries,
                returnOptions,
                params.source,
            );
            this.logger.log(
                `documentSnapshot hit branch=${params.branchId} scope=${params.scope} docs=${entries.length}`,
            );
            return {
                entries,
                snapshotVersion: formatSnapshotVersion(read.snapshot),
                cached: true,
            };
        }

        const inFlight = this.inFlight.get(key);
        if (inFlight) {
            const shared = (await inFlight) as BuildOutcome<TDoc>;
            return {
                entries: await this.excludeSnapshotEntries(
                    shared.snapshot.entries,
                    returnOptions,
                    params.source,
                ),
                ...(shared.stored ? { snapshotVersion: formatSnapshotVersion(shared.snapshot) } : {}),
                cached: true,
            };
        }

        const pending = this.buildAndStore(key, version, params, build);
        this.inFlight.set(key, pending as Promise<BuildOutcome<unknown>>);
        // 성공/실패와 무관하게 in-flight 슬롯을 비운다. 실패 자체는 호출부가 await 하며 처리한다.
        void pending.catch(() => undefined).finally(() => this.inFlight.delete(key));

        const outcome = await pending;
        return {
            entries: await this.excludeSnapshotEntries(
                outcome.snapshot.entries,
                returnOptions,
                params.source,
            ),
            ...(outcome.stored ? { snapshotVersion: formatSnapshotVersion(outcome.snapshot) } : {}),
            cached: false,
        };
    }

    private async buildAndStore<TDoc>(
        key: string,
        version: number,
        params: DocumentSnapshotKeyParams,
        build: () => Promise<DocumentSnapshotEntry<TDoc>[]>,
    ): Promise<BuildOutcome<TDoc>> {
        const entries = await this.buildSafeEntries(build, params.source);
        const snapshot: StoredSnapshot<TDoc> = { version, builtAt: Date.now(), entries };
        const stored = await this.writeSnapshot(key, snapshot, params);
        return { snapshot, stored };
    }

    private async buildSafeEntries<TDoc>(
        build: () => Promise<DocumentSnapshotEntry<TDoc>[]>,
        source: DocumentSnapshotKeyParams["source"],
    ): Promise<DocumentSnapshotEntry<TDoc>[]> {
        return this.excludeSnapshotEntries(await build(), {}, source);
    }

    /**
     * A purge intent is hidden in every list. Tombstones are hidden only when the
     * request's existing list semantics require it. Both are durable before cache
     * invalidation, so lookup failure deliberately propagates rather than returning a
     * cached row whose current list visibility is unknown.
     */
    private async excludeSnapshotEntries<TDoc>(
        entries: DocumentSnapshotEntry<TDoc>[],
        options: DocumentSnapshotReturnOptions,
        source: DocumentSnapshotKeyParams["source"],
    ): Promise<DocumentSnapshotEntry<TDoc>[]> {
        const excludedIds = new Set(options.excludeTombstones
            ? await this.snapshotExclusionLookup.findListExcludedDocumentIds()
            : await this.snapshotExclusionLookup.findPermanentPurgeRequestedDocumentIds());
        if (source === "mirror") {
            for (const documentId of await this.snapshotExclusionLookup
                .findUnreadyCompletedDocumentIds()) {
                excludedIds.add(documentId);
            }
        }
        return this.filterExcludedSnapshotEntries(entries, excludedIds);
    }

    private filterExcludedSnapshotEntries<TDoc>(
        entries: DocumentSnapshotEntry<TDoc>[],
        excludedIds: Set<string>,
    ): DocumentSnapshotEntry<TDoc>[] {
        if (excludedIds.size === 0) {
            return entries;
        }

        return entries.filter((entry) => {
            const document = entry.document;
            if (typeof document !== "object" || document === null || !("id" in document)) {
                return true;
            }
            const documentId = (document as { id?: unknown }).id;
            return typeof documentId !== "string" || !excludedIds.has(documentId);
        });
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
    ): Promise<boolean> {
        const payload = JSON.stringify(snapshot);
        if (Buffer.byteLength(payload, "utf8") > SNAPSHOT_MAX_BYTES) {
            this.logger.warn(
                `documentSnapshot too large to cache branch=${params.branchId} scope=${params.scope} docs=${snapshot.entries.length}`,
            );
            return false;
        }

        if (!this.redis) {
            this.pruneMemoryStore();
            while (this.memoryStore.size >= MEMORY_STORE_MAX_ENTRIES) {
                const oldestKey = this.memoryStore.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }
                this.memoryStore.delete(oldestKey);
            }
            this.memoryStore.set(key, {
                expiresAt: Date.now() + SNAPSHOT_TTL_SECONDS * 1_000,
                payload,
            });
            return true;
        }

        try {
            await this.ensureRedisConnected();
            await this.redis.set(key, payload, "EX", SNAPSHOT_TTL_SECONDS);
            return true;
        } catch (error) {
            this.logger.warn(`Snapshot write failed; snapshot not cached: ${describeError(error)}`);
            return false;
        }
    }

    private snapshotKey(params: DocumentSnapshotKeyParams, version: string): string {
        const source = params.source ?? "api";
        const tenant = `${SNAPSHOT_KEY_PREFIX}:v${SNAPSHOT_SCHEMA_VERSION}:${source}`
            + `:${params.branchId}:${params.scope}`;
        // A mirror snapshot is decided entirely by the tenant and the generation, so there
        // is no credential in its key — see DocumentSnapshotKeyParams for why that matters.
        return params.source === "mirror"
            ? `${tenant}:${version}`
            : `${tenant}:${this.tokenHash(params.accessToken)}:${version}`;
    }

    private versionKey(branchId: string): string {
        return `${VERSION_KEY_PREFIX}:${branchId}`;
    }

    private displayFieldKey(documentId: string, accessToken: string): string {
        return `${DISPLAY_FIELD_KEY_PREFIX}:${documentId}:${this.tokenHash(accessToken)}`;
    }

    private tokenHash(accessToken: string): string {
        return createHash("sha256").update(accessToken).digest("hex");
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

    private pruneDisplayFieldMemoryStore(): void {
        const now = Date.now();
        for (const [key, entry] of this.displayFieldMemoryStore) {
            if (entry.expiresAt <= now) {
                this.displayFieldMemoryStore.delete(key);
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
