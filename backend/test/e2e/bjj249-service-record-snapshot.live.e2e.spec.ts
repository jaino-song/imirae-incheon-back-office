import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ServiceRecordEntryModule } from "module/service-record-entry.module";
import { EformsignWebhookModule } from "module/eformsign-webhook.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordTokenContext } from "application/services/service-record-token.service";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { chunkSessionsByTier } from "application/usecases/eformsign-doc/service-record-field-mapper";
import { SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS } from "application/usecases/eformsign-doc/service-record-field-ids";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";

/**
 * LIVE E2E for BJJ-249: runs the REAL case-based 제공기록지 pipeline against the shared dev DB and
 * the REAL eformsign tenant — creates and then deletes actual documents. Gated behind LIVE_E2E=1
 * and excluded from the default unit run (test/e2e/ is in testPathIgnorePatterns).
 *
 * Run:
 *   LIVE_E2E=1 pnpm exec jest test/e2e/bjj249-service-record-snapshot.live.e2e.spec.ts \
 *     --testPathIgnorePatterns=/node_modules/ --runInBand
 *
 * Covers the full lifecycle the wizard + schedulers drive in production:
 *   1. wizard backend path (saveHeader + 5 locked/approved sessions) → READY_TO_FINALIZE
 *   2. scheduler finalize (processDueCases → executeCase) → configured-tier prefilled documents
 *      at the 제공업체 확인 step, case DOCUMENTS_CREATED
 *   3. scheduler re-run idempotency — same documents, no duplicates
 *   4. reviewer headless finalize + exact mirror sync → case COMPLETED, contract untouched
 * All with real vendors (E2E_VENDOR_STUBS must NOT be set).
 */
const LIVE = process.env["LIVE_E2E"] === "1";

const TEST_TAG = "E2E-BJJ249-삭제예정";
const SESSION_COUNT = 5;
const SERVICE_DATES = [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-06",
    "2026-07-07",
] as const;
// 1x1 PNG dataURI — satisfies the client-signature requirement; renders as the signature mark in eformsign.
const TEST_CLIENT_SIGNATURE =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

(LIVE ? describe : describe.skip)("BJJ-249 live E2E — case-based service-record snapshot pipeline", () => {
    jest.setTimeout(180_000);

    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
    let prisma: PrismaService;
    let serviceRecordService: ServiceRecordEntryService;
    let lifecycleService: ServiceRecordLifecycleService;
    let finalizationService: ServiceRecordFinalizationService;
    let finalizeDocumentHeadless: FinalizeDocumentHeadlessUsecase;
    let eformsignClient: IEformsignClientRepository;

    let branchId: string;
    let clientId: number;
    let employeeId: number;
    let scheduleId: number;
    let caseId: string;
    let ctx: ServiceRecordTokenContext;
    let createdDocumentIds: string[] = [];

    beforeAll(async () => {
        expect(process.env["E2E_VENDOR_STUBS"]).not.toBe("1"); // must run against real vendors

        moduleRef = await Test.createTestingModule({
            // TenantModule is @Global in the real app — imported here so guards on
            // transitively-imported controllers (SystemSettingModule etc.) resolve.
            imports: [ConfigModule.forRoot({ isGlobal: true }), TenantModule, ServiceRecordEntryModule, EformsignWebhookModule, SchedulerLeaseModule],
        }).compile();

        prisma = moduleRef.get(PrismaService, { strict: false });
        serviceRecordService = moduleRef.get(ServiceRecordEntryService, { strict: false });
        lifecycleService = moduleRef.get(ServiceRecordLifecycleService, { strict: false });
        finalizationService = moduleRef.get(ServiceRecordFinalizationService, { strict: false });
        finalizeDocumentHeadless = moduleRef.get(FinalizeDocumentHeadlessUsecase, { strict: false });
        eformsignClient = moduleRef.get(EFORMSIGN_CLIENT_REPOSITORY, { strict: false });

        const branch = await prisma.branch.findFirst();
        if (!branch) throw new Error("no branch row in dev DB");
        branchId = branch.id;

        // employee.id is a manually-assigned smallint — grab a free id near the top of the range.
        const maxEmployee = await prisma.employee.aggregate({ _max: { id: true } });
        employeeId = Math.min((maxEmployee._max.id ?? 0) + 101, 32700);
        await prisma.employee.create({
            data: {
                id: employeeId,
                name: `테스트인력-${TEST_TAG}`,
                workArea: ["E2E"],
                phone: `010-0000-${String(Date.now()).slice(-4)}`,
                grade: "E2E",
                branchId,
            },
        });

        // Ended service: endDate 20:00 KST is already past, so the case is finalization-due.
        const client = await prisma.client.create({
            data: {
                name: `테스트고객-${TEST_TAG}`,
                duration: SESSION_COUNT,
                voucherClient: false,
                branchId,
                startDate: d(SERVICE_DATES[0]),
                endDate: d(SERVICE_DATES.at(-1)!),
            } as never,
        });
        clientId = client.id;

        const schedule = await prisma.employee_schedule.create({
            data: {
                primaryEmployeeId: employeeId,
                clientId,
                branchId,
                workAddress: "E2E 테스트 주소",
                startDate: d(SERVICE_DATES[0]),
                endDate: d(SERVICE_DATES.at(-1)!),
            },
        });
        scheduleId = schedule.id;

        const record = await lifecycleService.ensureForClient(clientId);
        if (!record) throw new Error("service_record_case was not created for the seeded client");
        caseId = record.id;
        ctx = { tokenId: "live-e2e", branchId, scheduleId, employeeId, serviceRecordCaseId: caseId };
    });

    afterAll(async () => {
        // Best-effort cleanup — remote documents first, then DB rows (FK order).
        try {
            if (createdDocumentIds.length && eformsignClient) {
                const token = await eformsignClient.getAccessToken(Date.now());
                const access = token.oauth_token.access_token;
                const base = process.env["EFORMSIGN_DOC_API_URL"];
                const res = await fetch(`${base}/v2.0/api/documents`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
                    body: JSON.stringify({ document_ids: createdDocumentIds }),
                });
                console.log(`[cleanup] eformsign DELETE -> ${res.status} ${(await res.text()).slice(0, 160)}`);
            }
        } catch (e) {
            console.log(`[cleanup] eformsign delete failed: ${e} — void manually: ${createdDocumentIds.join(", ")}`);
        }
        try {
            if (prisma && scheduleId) {
                await prisma.eformsign_doc.deleteMany({ where: { documentId: { in: createdDocumentIds } } });
                if (caseId) {
                    // cascades service_record_day / snapshot chunks / assignments / tokens
                    await prisma.service_record_case.deleteMany({ where: { id: caseId } });
                }
                await prisma.service_record.deleteMany({ where: { scheduleId } });
                await prisma.employee_schedule.deleteMany({ where: { id: scheduleId } });
                await prisma.client.deleteMany({ where: { id: clientId } });
                await prisma.employee.deleteMany({ where: { id: employeeId } });
            }
        } catch (e) {
            console.log(`[cleanup] DB cleanup failed: ${e} — rows tagged ${TEST_TAG} need manual removal`);
        }
        await moduleRef?.close();
    });

    it("wizard path: header + 5 approved sessions drive the case to READY_TO_FINALIZE", async () => {
        await serviceRecordService.saveHeader(ctx, {
            momName: "김산모",
            momBirth: "900101",
            babyName: "김아기",
            babyBirth: "260615",
            deliveryType: "자연분만",
            babyWeight: "3.2",
        });

        const fullAnswers = {
            perineum: ["열상"],
            breast: ["이상없음"],
            excretion: ["이상없음"],
            sitzBath: "실시",
            meals_meal: "3",
            meals_snack: "2",
            temperature_temp: "36.8",
            sleep: "잘 잠",
            breastFeeding_count: "5",
            formulaFeeding_count: "2",
            formulaFeeding_ml: "60",
            stool: "이상변",
            stool_color: "녹색",
            bath: "실시",
        };
        const lightAnswers = { sitzBath: "미실시", sleep: "잘 못 잠", stool: "정상변" };

        for (let i = 1; i <= SESSION_COUNT; i++) {
            await serviceRecordService.upsertSession(
                ctx,
                i,
                {
                    serviceDate: SERVICE_DATES[i - 1]!,
                    answers: i === 1 ? fullAnswers : lightAnswers,
                    ...(i === 1 ? { etcService: "예방접종 안내", notes: "E2E 특이사항" } : {}),
                    paymentConfirmed: i % 2 === 1, // odd sessions confirmed
                    momApproval: "approved",
                    // First-lock submissions now require the client's signature (CLIENT_SIGNATURE_REQUIRED).
                    clientSignature: TEST_CLIENT_SIGNATURE,
                },
                true,
            );
        }

        const record = await prisma.service_record_case.findUnique({ where: { id: caseId } });
        expect(record?.status).toBe("READY_TO_FINALIZE");
        expect(record?.completedAt).not.toBeNull();
        expect(record?.finalizationDueAt).not.toBeNull();
        expect(record!.finalizationDueAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("scheduler finalize creates fully prefilled documents using the configured tiers", async () => {
        const finalized = await finalizationService.processDueCases();
        expect(finalized).toBeGreaterThanOrEqual(1);

        const record = await prisma.service_record_case.findUnique({ where: { id: caseId } });
        expect(record?.status).toBe("DOCUMENTS_CREATED");
        expect(record?.finalizedAt).not.toBeNull();

        const docs = await prisma.eformsign_doc.findMany({
            where: { serviceRecordCaseId: caseId },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        createdDocumentIds = docs.map((doc) => doc.documentId);
        const configuredTiers = SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
            .filter(({ envKey }) => Boolean(process.env[envKey]?.trim()))
            .map(({ tier }) => tier);
        const expectedChunks = chunkSessionsByTier([...SERVICE_DATES], configuredTiers);

        expect(configuredTiers).toContain(5);
        expect(docs).toHaveLength(expectedChunks.length);
        expect(docs.every((doc) => doc.documentKind === "service_record_snapshot")).toBe(true);

        const chunks = await prisma.service_record_snapshot_chunk.findMany({
            where: { serviceRecordCaseId: caseId },
            orderBy: { chunkIndex: "asc" },
        });
        expect(chunks).toHaveLength(expectedChunks.length);
        expect(chunks.every((chunk) => chunk.status === "CREATED")).toBe(true);

        const token = await eformsignClient.getAccessToken(Date.now());
        const access = token.oauth_token.access_token;

        const fieldsOf = async (docId: string) => {
            const doc = await eformsignClient.getDocument(access, docId);
            const map = new Map<string, string>();
            for (const f of doc.fields ?? []) map.set(f.id, f.value);
            return { doc, map };
        };

        const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
        const fieldMaps: Array<Map<string, string>> = [];
        for (const [index, documentId] of createdDocumentIds.entries()) {
            const expectedChunk = expectedChunks[index]!;
            const { doc, map } = await fieldsOf(documentId);
            fieldMaps.push(map);

            expect(doc.current_status?.step_name).toBe("제공업체 확인");
            expect(map.get("제공기관 이름")).toBe(branch.name);
            for (let slot = 1; slot <= expectedChunk.tier; slot += 1) {
                const serviceDate = expectedChunk.days[slot - 1];
                if (!serviceDate) {
                    expect(map.get(`월 ${slot}`) ?? "").toBe("");
                    expect(map.get(`산모확인서명 ${slot}`)).toBe("X");
                    continue;
                }

                const globalSessionIndex = SERVICE_DATES.indexOf(serviceDate) + 1;
                expect(map.get(`월 ${slot}`)).toBe(serviceDate.slice(5, 7));
                expect(map.get(`일 ${slot}`)).toBe(serviceDate.slice(8, 10));
                expect(map.get(`산모확인서명 ${slot}`)).toBe("O");
                expect(map.get(`결제 확인 ${slot}`) ?? "").toBe(
                    globalSessionIndex % 2 === 1 ? "체크1" : "",
                );
            }
        }

        const m1 = fieldMaps[0]!;
        expect(m1.get("산모 이름")).toBe("김산모");
        expect(m1.get("산모 생년월일")).toBe("1990-01-01");
        expect(m1.get("신생아 출생일자")).toBe("2026-06-15");
        expect(m1.get("자연분만")).toBe("체크1");
        expect(m1.get("월 1")).toBe("07");
        expect(m1.get("일 1")).toBe("01");
        // session 1 detail
        expect(m1.get("회음절개부위 열상 1")).toBe("체크1");
        expect(m1.get("좌욕 실시 1")).toBe("체크1");
        expect(m1.get("이상변 1")).toBe("체크1");
        expect(m1.get("색깔 1")).toBe("녹색");
        expect(m1.get("체온 1")).toBe("36.8");
        expect(m1.get("식사 1")).toBe("3");
        expect(m1.get("기타서비스 1")).toBe("예방접종 안내");
        // session 2 (light answers)
        expect(m1.get("좌욕 미실시 2")).toBe("체크1");
        expect(m1.get("정상변 2")).toBe("체크1");
    });

    it("re-running the scheduler is idempotent — same documents, no duplicates", async () => {
        await finalizationService.processDueCases();

        const docs = await prisma.eformsign_doc.findMany({
            where: { serviceRecordCaseId: caseId },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        expect(docs.map((doc) => doc.documentId).sort()).toEqual([...createdDocumentIds].sort());

        const record = await prisma.service_record_case.findUnique({ where: { id: caseId } });
        expect(record?.status).toBe("DOCUMENTS_CREATED");
    });

    it("reviewer headless finalize completes the case after exact mirror sync without touching the contract", async () => {
        const before = await prisma.client.findUnique({ where: { id: clientId } });
        expect(before?.eDocId).toBeNull();

        for (const documentId of createdDocumentIds) {
            await expect(finalizeDocumentHeadless.execute({ documentId }, createEformsignWorkerPrincipal(branchId))).resolves.toMatchObject({ ok: true });
        }

        const deadline = Date.now() + 60_000;
        let record = await prisma.service_record_case.findUnique({ where: { id: caseId } });
        while (record?.status !== "COMPLETED" && Date.now() < deadline) {
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
            record = await prisma.service_record_case.findUnique({ where: { id: caseId } });
        }
        expect(record?.status).toBe("COMPLETED");
        expect(record?.documentsCompletedAt).not.toBeNull();

        const after = await prisma.client.findUnique({ where: { id: clientId } });
        expect(after?.eDocId).toBeNull(); // BJJ-247 invariant: service-record docs never link eDocId
        expect(after?.endDate).toEqual(before?.endDate ?? null);

        const captureDirectory = process.env["LIVE_CAPTURE_PDF_DIR"]?.trim();
        if (captureDirectory) {
            await mkdir(captureDirectory, { recursive: true });
            for (const [index, documentId] of createdDocumentIds.entries()) {
                const storedPdf = await prisma.eformsign_doc_file.findFirst({
                    where: {
                        fileType: "document",
                        eformsignDoc: { documentId },
                    },
                    select: { content: true },
                });
                expect(Buffer.from(storedPdf!.content).subarray(0, 5).toString("ascii")).toBe("%PDF-");
                await writeFile(
                    join(captureDirectory, `service-record-${index + 1}.pdf`),
                    Buffer.from(storedPdf!.content),
                );
            }
        }
    });
});
