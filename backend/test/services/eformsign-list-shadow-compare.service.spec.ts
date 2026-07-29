import { ConfigService } from "@nestjs/config";

import {
    eformsignListCompareFields,
    EformsignListShadowCompareService,
    type ListShadowCompareQuery,
    type ListShadowCompareServed,
} from "application/services/eformsign-list-shadow-compare.service";
import { eformsignListDocFromMirror } from "application/utils/eformsign-list-doc-from-mirror";
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

/**
 * The served payload for documents that agree with the mirror, in served order. A test
 * that wants a difference overrides one piece, so what it is asserting stays visible.
 */
function servedFrom(
    documents: EformsignDocEntity[],
    overrides: Partial<ListShadowCompareServed> = {},
): ListShadowCompareServed {
    const ordered = [...documents].sort(
        (a, b) => b.createdDate.getTime() - a.createdDate.getTime(),
    );
    return {
        documentIds: ordered.map((document) => document.documentId),
        fieldsById: new Map(
            ordered.map((document) => [
                document.documentId,
                eformsignListCompareFields(eformsignListDocFromMirror(document)),
            ] as const),
        ),
        oldestScannedAt: ordered.length > 0
            ? ordered[ordered.length - 1]!.createdDate.getTime()
            : undefined,
        // Most tests are about a capped scan, where an old mirror-only row is expected;
        // the exhaustive case is asserted on its own below.
        scanCapped: true,
        ...overrides,
    };
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

    function spyOnLogger(service: EformsignListShadowCompareService) {
        const logger = (service as unknown as {
            logger: { log: (message: string) => void; warn: (message: string) => void };
        }).logger;
        return {
            log: jest.spyOn(logger, "log").mockImplementation(() => undefined),
            warn: jest.spyOn(logger, "warn").mockImplementation(() => undefined),
        };
    }

    /** compareInBackground deliberately does not await; give the microtasks a turn. */
    const settle = async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setImmediate(resolve));
    };

    it.each([undefined, "false", "1"])(
        "does nothing with EFORMSIGN_SHADOW_COMPARE_ENABLED=%s",
        async (value) => {
            const service = createService(value);

            service.compareInBackground(createQuery(), servedFrom([]));
            await settle();

            expect(repository.findAll).not.toHaveBeenCalled();
        },
    );

    it("reports a match when the mirror produces the same list", async () => {
        const documents = [
            createMirrorDocument({ documentId: "doc-2", createdDate: "2026-07-02T00:00:00.000Z" }),
            createMirrorDocument({ documentId: "doc-1", createdDate: "2026-07-01T00:00:00.000Z" }),
        ];
        repository.findAll.mockResolvedValue(documents);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(createQuery(), servedFrom(documents));
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.log.mock.calls[0]?.[0]).toContain("match");
    });

    it("names the documents each side is missing", async () => {
        const shared = createMirrorDocument({ documentId: "doc-1" });
        repository.findAll.mockResolvedValue([
            shared,
            createMirrorDocument({ documentId: "doc-3" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(createQuery(), servedFrom([
            shared,
            createMirrorDocument({ documentId: "doc-2" }),
        ]));
        await settle();

        const message = logger.warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("missing=doc-2");
        expect(message).toContain("extra=doc-3");
    });

    it("reports an order difference when the same documents come out the other way round", async () => {
        const a = createMirrorDocument({
            documentId: "doc-a",
            createdDate: "2026-07-01T00:00:00.000Z",
        });
        const b = createMirrorDocument({
            documentId: "doc-b",
            createdDate: "2026-07-02T00:00:00.000Z",
        });
        repository.findAll.mockResolvedValue([a, b]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        // The mirror sorts b first; the served list claims a first.
        service.compareInBackground(
            createQuery(),
            servedFrom([a, b], { documentIds: ["doc-a", "doc-b"] }),
        );
        await settle();

        expect(logger.warn.mock.calls[0]?.[0]).toContain("order differs");
    });

    it("still checks order when an out-of-range document is present", async () => {
        // Dropping the order check whenever anything sat outside the vendor's range would
        // hide a reversal behind a single ancient row.
        const a = createMirrorDocument({
            documentId: "doc-a",
            createdDate: "2026-07-01T00:00:00.000Z",
        });
        const b = createMirrorDocument({
            documentId: "doc-b",
            createdDate: "2026-07-02T00:00:00.000Z",
        });
        repository.findAll.mockResolvedValue([
            a,
            b,
            createMirrorDocument({
                documentId: "doc-ancient",
                createdDate: "2024-01-01T00:00:00.000Z",
            }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery(),
            servedFrom([a, b], { documentIds: ["doc-a", "doc-b"] }),
        );
        await settle();

        const message = logger.warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("order differs");
        expect(message).toContain("olderThanScanned=1");
        expect(message).not.toContain("extra=");
    });

    it("reports documents whose values differ even when the list itself matches", async () => {
        // Membership and order can agree while the row serves a different status, and the
        // UI reads that directly — it drives the pill and which actions are offered.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-1", statusType: "060" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery(),
            servedFrom([createMirrorDocument({ documentId: "doc-1", statusType: "050" })]),
        );
        await settle();

        expect(logger.warn.mock.calls[0]?.[0]).toContain("fields=doc-1[statusType]");
    });

    it("attributes documents older than the vendor's scanned range separately", async () => {
        // The served path scans at most 10 vendor pages of 100 and warns when it hits that
        // cap. Counting those as disagreements would make the gate unreachable for any
        // company past a thousand documents, while they are what the switch recovers.
        const recent = createMirrorDocument({
            documentId: "doc-new",
            createdDate: "2026-07-05T00:00:00.000Z",
        });
        repository.findAll.mockResolvedValue([
            recent,
            createMirrorDocument({
                documentId: "doc-ancient",
                createdDate: "2024-01-01T00:00:00.000Z",
            }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(createQuery(), servedFrom([recent]));
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.log.mock.calls[0]?.[0]).toContain("olderThanScanned=1");
    });

    it("applies the same template filter the served list did", async () => {
        const kept = createMirrorDocument({ documentId: "doc-keep", templateId: "template-1" });
        repository.findAll.mockResolvedValue([
            kept,
            createMirrorDocument({ documentId: "doc-drop", templateId: "template-9" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery({ templateId: "template-1", templateMatch: "include" }),
            servedFrom([kept]),
        );
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("matches 초성 against the recipient name, the way the served search does", async () => {
        const song = createMirrorDocument({ documentId: "doc-song", stepRecipientName: "송진호" });
        repository.findAll.mockResolvedValue([
            song,
            createMirrorDocument({ documentId: "doc-park", stepRecipientName: "박수신" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        // 초성 검색은 startsWith 규칙이라 "ㅅㅈㅎ"는 송진호만 집는다.
        service.compareInBackground(createQuery({ search: "ㅅㅈㅎ" }), servedFrom([song]));
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("does not search the stored customerName, because the served list cannot", async () => {
        // The vendor list is fetched without include_fields, so the served search never
        // sees a customer name on the document and matches the recipient name instead.
        // Searching the mirror's own column would find documents the served path cannot.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-hidden",
                customerName: "최고객",
                documentName: "계약",
                stepRecipientName: "송진호",
            }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(createQuery({ search: "최고객" }), servedFrom([]));
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.log.mock.calls[0]?.[0]).toContain("match");
    });

    it("searches headquarters recipient names from branch-owned rows only", async () => {
        // The served path builds its recipient-name corpus from findAll(branchId), so an
        // unassigned document's recipient name is not searchable there.
        repository.findAllForHeadquarters.mockResolvedValue([
            createMirrorDocument({
                documentId: "doc-unassigned",
                documentName: null,
                stepRecipientName: "박수신",
            }),
        ]);
        repository.findAll.mockResolvedValue([]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery({ isHeadquarters: true, search: "박수신" }),
            servedFrom([]),
        );
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.log.mock.calls[0]?.[0]).toContain("match");
    });

    it("reads the headquarters corpus from the method that includes unclaimed rows", async () => {
        const hqDocument = createMirrorDocument({ documentId: "doc-hq" });
        repository.findAllForHeadquarters.mockResolvedValue([hqDocument]);
        const service = createService("true");
        spyOnLogger(service);

        service.compareInBackground(
            createQuery({ isHeadquarters: true }),
            servedFrom([hqDocument]),
        );
        await settle();

        expect(repository.findAllForHeadquarters).toHaveBeenCalledWith("branch-1");
        // findAll is still consulted, but only for the recipient-name search corpus the
        // served path builds the same way — not for which documents the list contains.
        expect(repository.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("stands in for the vendor inbox with local status categories on the tab endpoints", async () => {
        // The tabs are most of the traffic, and the mirror does not record which inbox a
        // document sat in — the switch has to answer them from status codes. Comparing
        // that substitution is the only way to learn whether it lands the same content.
        const drafting = createMirrorDocument({ documentId: "doc-open", statusType: "060" });
        repository.findAll.mockResolvedValue([
            drafting,
            createMirrorDocument({ documentId: "doc-done", statusType: "050" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery({ scope: "in-progress", scopeCategories: ["drafting", "in-progress"] }),
            servedFrom([drafting]),
        );
        await settle();

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.log.mock.calls[0]?.[0]).toContain("scope=in-progress");
    });

    it("reports a stale completion date even when everything else agrees", async () => {
        // The list renders updated_date as the signed date, so a mirror that is right
        // about membership and status can still show users the wrong day.
        const mirrored = createMirrorDocument({ documentId: "doc-1" });
        repository.findAll.mockResolvedValue([mirrored]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        const served = servedFrom([mirrored]);
        served.fieldsById.get("doc-1")!.updatedAt += 86_400_000;
        service.compareInBackground(createQuery(), served);
        await settle();

        expect(logger.warn.mock.calls[0]?.[0]).toContain("fields=doc-1[updatedAt]");
    });

    it("refuses to classify local rows when the vendor scan returned nothing", async () => {
        // A branch whose documents all sit past the 10-page company scan cap looks exactly
        // like a branch whose mirror is wrong. Picking either verdict would be inventing
        // one; the operator can tell them apart from the scan's own cap warning.
        repository.findAll.mockResolvedValue([
            createMirrorDocument({ documentId: "doc-old" }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(createQuery(), servedFrom([]));
        await settle();

        const message = logger.warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("localOnlyNoScanRange=doc-old");
        expect(message).not.toContain("extra=");
        expect(message).not.toContain("olderThanScanned=");
    });

    it("calls an old mirror-only row a real extra when the scan was exhaustive", async () => {
        // A scan that ran out of pages saw everything, so the vendor genuinely does not
        // have this document — its age says nothing. Suppressing it would be the one way
        // this comparison could bless a mirror that is wrong.
        const recent = createMirrorDocument({
            documentId: "doc-new",
            createdDate: "2026-07-05T00:00:00.000Z",
        });
        repository.findAll.mockResolvedValue([
            recent,
            createMirrorDocument({
                documentId: "doc-ancient",
                createdDate: "2024-01-01T00:00:00.000Z",
            }),
        ]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery(),
            servedFrom([recent], { scanCapped: false }),
        );
        await settle();

        const message = logger.warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("extra=doc-ancient");
        expect(message).not.toContain("olderThanScanned=");
    });

    it("keeps the search term itself out of the log", async () => {
        // Searches are customer names often enough that the term does not belong in a
        // centralised log, and a raw value could break the log line apart.
        repository.findAll.mockResolvedValue([]);
        const service = createService("true");
        const logger = spyOnLogger(service);

        service.compareInBackground(
            createQuery({ search: "김민수\n[Shadow] injected" }),
            servedFrom([createMirrorDocument({ documentId: "doc-missing" })]),
        );
        await settle();

        const message = logger.warn.mock.calls[0]?.[0] ?? "";
        expect(message).toContain("search=present");
        expect(message).not.toContain("김민수");
        expect(message).not.toContain("injected");
    });

    it("runs one comparison at a time and says how many it skipped", async () => {
        // Every list request would otherwise load the whole branch mirror and sort it,
        // competing with the served requests for the same connection pool.
        let release: (() => void) | undefined;
        repository.findAll.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve([]);
        }));
        const service = createService("true");
        const logger = spyOnLogger(service);
        const served = servedFrom([]);

        service.compareInBackground(createQuery(), served);
        service.compareInBackground(createQuery(), served);
        service.compareInBackground(createQuery(), served);
        expect(repository.findAll).toHaveBeenCalledTimes(1);

        release?.();
        await settle();

        // The run that got through reports what it displaced, so the log says how much of
        // the traffic this evidence actually covers.
        expect(logger.log.mock.calls[0]?.[0]).toContain("skippedWhileBusy=2");
    });

    it("never lets a comparison failure escape into the request", async () => {
        // The response has already been sent by the time this runs; throwing here would
        // become an unhandled rejection, not an error the caller could do anything with.
        repository.findAll.mockRejectedValue(new Error("mirror unavailable"));
        const service = createService("true");
        const logger = spyOnLogger(service);

        expect(() => service.compareInBackground(createQuery(), servedFrom([])))
            .not.toThrow();
        await settle();

        expect(logger.warn.mock.calls[0]?.[0]).toContain("comparison failed");
    });
});
