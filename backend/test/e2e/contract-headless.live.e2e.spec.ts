import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EformsignService } from "application/services/eformsign.service";
import { ContractDataDto } from "application/dto/contract.dto";
import { CreateEformsignDocUsecase } from "application/usecases/eformsign-doc/create-eformsign-doc.usecase";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { extractEformsignContractEndDate } from "application/utils/eformsign-contract-client-candidate";
import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

/**
 * LIVE E2E for the maternity-contract paths. It creates real eformsign documents and
 * permanently removes them afterwards. Default Jest runs skip this suite.
 *
 * Run:
 *   LIVE_E2E=1 pnpm exec jest test/e2e/contract-headless.live.e2e.spec.ts \
 *     --testPathIgnorePatterns=/node_modules/ --runInBand
 *
 * The normal creation case uses the production DispatchDocumentHeadlessUsecase. The
 * provider-review case uses the real Seogu multi-step template, assigns only the customer
 * participant prerequisite to the configured eformsign service member without SMS, then
 * exercises the production FinalizeDocumentHeadlessUsecase through every provider-owned step.
 */
const LIVE = process.env["LIVE_E2E"] === "1";
const RUN_ID = Date.now().toString(36);
const TEST_TAG = `E2E-CONTRACT-${RUN_ID}-삭제예정`;
const TEST_AREA = process.env["LIVE_CONTRACT_AREA"]?.trim() || "Seogu";
const TEST_CUSTOMER_PHONE = "01000000000";
const REVIEW_END_DATE = "2026-11-30";
const TEST_SIGNATURE =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const buildContract = (
    customerName: string,
    caretakerName: string,
    caretakerPhone: string,
): ContractDataDto => ({
    customerName,
    customerContact: TEST_CUSTOMER_PHONE,
    customerDOB: "900101",
    customerAddress: "E2E 삭제예정 테스트 주소",
    caretaker1Name: caretakerName,
    caretaker1Contact: caretakerPhone,
    type: "산모신생아건강관리",
    days: "5",
    area: TEST_AREA,
    contractDuration: "5일",
    startYear: "26",
    startMonth: "11",
    startDay: "24",
    startDate: "2026-11-24",
    endYear: "26",
    endMonth: "11",
    endDay: "30",
    endDate: REVIEW_END_DATE,
    paymentYear: "26",
    paymentMonth: "11",
    paymentDay: "24",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    issuerPhone: "01000000000",
});

(LIVE ? describe : describe.skip)("maternity contract live E2E — headless creation and review", () => {
    jest.setTimeout(300_000);

    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
    let prisma: PrismaService;
    let dispatchDocument: DispatchDocumentHeadlessUsecase;
    let finalizeDocument: FinalizeDocumentHeadlessUsecase;
    let createEformsignDoc: CreateEformsignDocUsecase;
    let eformsignService: EformsignService;
    let headlessService: EformsignHeadlessService;
    let eformsignClient: IEformsignClientRepository;

    let branchId: string;
    let employeeId: number;
    let employeePhone: string;
    let employeeName: string;
    let creationClientId: number;
    let reviewClientId: number;
    let contractTemplateId: string;
    const scheduleIds: number[] = [];
    const remoteDocumentIds = new Set<string>();
    const runStartedAt = Date.now();

    const access = async () => eformsignClient.getAccessToken(Date.now());

    const findRemoteByCustomer = async (
        customerName: string,
        createdAfter = runStartedAt - 5_000,
    ): Promise<string | undefined> => {
        const token = await access();
        const recent = (await eformsignClient.getAllDocuments(token.oauth_token.access_token))
            .filter((document) => document.created_date >= createdAfter)
            .slice(0, 30);
        const matches: string[] = [];
        for (const candidate of recent) {
            try {
                const detail = await eformsignClient.getDocument(
                    token.oauth_token.access_token,
                    candidate.id,
                );
                if (detail.fields?.some((field) => (
                    field.id === "이용자 성명" && field.value === customerName
                ))) {
                    matches.push(candidate.id);
                }
            } catch {
                // A concurrently deleted document is irrelevant to this run.
            }
        }
        if (matches.length > 1) {
            throw new Error(`multiple remote test documents found for ${customerName}`);
        }
        return matches[0];
    };

    const waitForRemote = async (
        documentId: string,
        predicate: (
            statusType: string,
            stepType: string,
            document: Awaited<ReturnType<IEformsignClientRepository["getDocument"]>>,
        ) => boolean,
        timeoutMs = 90_000,
    ) => {
        const token = await access();
        const deadline = Date.now() + timeoutMs;
        let latest = await eformsignClient.getDocument(token.oauth_token.access_token, documentId);
        while (
            !predicate(latest.current_status.status_type, latest.current_status.step_type, latest)
            && Date.now() < deadline
        ) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
            latest = await eformsignClient.getDocument(token.oauth_token.access_token, documentId);
        }
        return latest;
    };

    beforeAll(async () => {
        expect(process.env["E2E_VENDOR_STUBS"]).not.toBe("1");

        moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), TenantModule, EformsignDocModule],
        }).compile();

        prisma = moduleRef.get(PrismaService, { strict: false });
        dispatchDocument = moduleRef.get(DispatchDocumentHeadlessUsecase, { strict: false });
        finalizeDocument = moduleRef.get(FinalizeDocumentHeadlessUsecase, { strict: false });
        createEformsignDoc = moduleRef.get(CreateEformsignDocUsecase, { strict: false });
        eformsignService = moduleRef.get(EformsignService, { strict: false });
        headlessService = moduleRef.get(EformsignHeadlessService, { strict: false });
        eformsignClient = moduleRef.get(EFORMSIGN_CLIENT_REPOSITORY, { strict: false });

        const areaTemplate = await prisma.doc_template.findFirst({
            where: { areaId: TEST_AREA, area: { branch: { isActive: { not: false } } } },
            select: { templateId: true, area: { select: { branchId: true } } },
        });
        if (!areaTemplate?.templateId || !areaTemplate.area.branchId) {
            throw new Error(`${TEST_AREA} contract template is not configured for an active live-test branch`);
        }
        branchId = areaTemplate.area.branchId;
        contractTemplateId = areaTemplate.templateId;

        const maxEmployee = await prisma.employee.aggregate({ _max: { id: true } });
        employeeId = (maxEmployee._max.id ?? 0) + 1;
        if (employeeId > 32760) throw new Error("no safe smallint employee id for live test");
        employeeName = `테스트제공인력-${TEST_TAG}`;
        employeePhone = `019${String(employeeId).padStart(8, "0").slice(-8)}`;
        await prisma.employee.create({
            data: {
                id: employeeId,
                name: employeeName,
                workArea: ["E2E"],
                phone: employeePhone,
                grade: "E2E",
                branchId,
            },
        });

        const makeClient = async (suffix: string) => prisma.client.create({
            data: {
                name: `${suffix}-${TEST_TAG}`,
                phone: suffix === "생성" ? TEST_CUSTOMER_PHONE : "01000000001",
                address: "E2E 삭제예정 테스트 주소",
                birthday: "900101",
                duration: 5,
                fullPrice: "1000000",
                grant: "800000",
                actualPrice: "200000",
                voucherClient: false,
                suppressGreetingSms: true,
                branchId,
                startDate: d("2026-11-24"),
                // Deliberately different: completed-document reconciliation must replace it.
                endDate: d("2026-12-31"),
            },
        });
        const creationClient = await makeClient("생성");
        const reviewClient = await makeClient("검토");
        creationClientId = creationClient.id;
        reviewClientId = reviewClient.id;

        for (const clientId of [creationClientId, reviewClientId]) {
            const schedule = await prisma.employee_schedule.create({
                data: {
                    primaryEmployeeId: employeeId,
                    clientId,
                    branchId,
                    workAddress: "E2E 삭제예정 테스트 주소",
                    startDate: d("2026-11-24"),
                    endDate: d("2026-12-31"),
                },
            });
            scheduleIds.push(schedule.id);
        }
    });

    afterAll(async () => {
        try {
            if (eformsignClient) {
                for (const customerName of [`생성-${TEST_TAG}`, `검토-${TEST_TAG}`]) {
                    const discovered = await findRemoteByCustomer(customerName);
                    if (discovered) remoteDocumentIds.add(discovered);
                }
                if (remoteDocumentIds.size > 0) {
                    const token = await access();
                    await eformsignService.deleteDocuments(
                        token.oauth_token.access_token,
                        [...remoteDocumentIds],
                        true,
                    );
                    console.log(`[cleanup] permanently deleted ${remoteDocumentIds.size} eformsign test document(s)`);
                }
            }
        } catch (error) {
            console.log(`[cleanup] remote cleanup failed: ${error}; ids=${[...remoteDocumentIds].join(",")}`);
        }
        try {
            if (prisma) {
                await prisma.client.updateMany({
                    where: { id: { in: [creationClientId, reviewClientId].filter(Boolean) } },
                    data: { eDocId: null },
                });
                await prisma.eformsign_doc.deleteMany({
                    where: {
                        OR: [
                            { documentId: { in: [...remoteDocumentIds] } },
                            { customerName: { contains: TEST_TAG } },
                        ],
                    },
                });
                await prisma.employee_schedule.deleteMany({ where: { id: { in: scheduleIds } } });
                await prisma.client.deleteMany({
                    where: { id: { in: [creationClientId, reviewClientId].filter(Boolean) } },
                });
                if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
            }
        } catch (error) {
            console.log(`[cleanup] DB cleanup failed: ${error}; tag=${TEST_TAG}`);
        }
        await moduleRef?.close();
    });

    it("production creation sends one fully-prefilled contract and rejects an immediate duplicate", async () => {
        const customerName = `생성-${TEST_TAG}`;
        const startedAt = Date.now();
        const result = await dispatchDocument.execute(branchId, {
            clientId: creationClientId,
            contractData: buildContract(customerName, employeeName, employeePhone),
        });
        if (result.ok) remoteDocumentIds.add(result.documentId);
        else if (result.remoteDocumentId) remoteDocumentIds.add(result.remoteDocumentId);

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        if (!result.ok) throw new Error(result.reason);

        const recoveredId = result.documentId ?? await findRemoteByCustomer(customerName, startedAt - 5_000);
        expect(recoveredId).toBeTruthy();
        remoteDocumentIds.add(recoveredId!);

        const token = await access();
        const remote = await eformsignClient.getDocument(token.oauth_token.access_token, recoveredId!);
        const fields = new Map(remote.fields?.map((field) => [field.id, field.value]));
        expect(fields.get("이용자 성명")).toBe(customerName);
        expect(fields.get("이용자 생년월일")).toBe("900101");
        expect(fields.get("이용자 주소")).toBe("E2E 삭제예정 테스트 주소");
        expect(fields.get("제공인력 1 성명")).toBe(employeeName);
        expect(fields.get("제공인력 1 연락처")).toBe(employeePhone);
        // eformsign formats numeric currency inputs before persisting them.
        expect(fields.get("서비스 비용")).toBe("1,000,000");
        expect(fields.get("정부지원금")).toBe("800,000");
        expect(fields.get("본인부담금")).toBe("200,000");
        expect(EFORMSIGN_COMPLETED_STATUS_CODES.has(remote.current_status.status_type)).toBe(false);

        const local = await prisma.eformsign_doc.findUnique({ where: { documentId: recoveredId! } });
        const client = await prisma.client.findUnique({ where: { id: creationClientId } });
        expect(local).toMatchObject({
            documentId: recoveredId,
            clientId: creationClientId,
            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            customerName,
        });
        expect(client?.eDocId).toBe(recoveredId);

        await expect(dispatchDocument.execute(branchId, {
            clientId: creationClientId,
            contractData: buildContract(customerName, employeeName, employeePhone),
        })).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "duplicate_pending_document",
            existingDocumentId: recoveredId,
        }));
        expect(await findRemoteByCustomer(customerName, startedAt - 5_000)).toBe(recoveredId);
    });

    it("real provider-review automation completes the contract and converges the client mirror", async () => {
        const customerName = `검토-${TEST_TAG}`;
        const token = await access();
        const contractData = buildContract(customerName, employeeName, employeePhone);
        const documentOption = eformsignService.generateDocumentOptions(
            contractData,
            token.oauth_token.access_token,
            token.oauth_token.refresh_token,
            contractTemplateId,
        ) as Record<string, unknown>;
        const user = documentOption["user"] as { id: string };
        const prefill = documentOption["prefill"] as {
            fields: Array<{ id: string; value: string }>;
            recipients: Array<Record<string, unknown>>;
        };
        // Test-only prerequisite: assign the participant step to the service member so
        // no customer SMS is sent and the real provider-review step can be reached safely.
        prefill.recipients[0] = {
            step_idx: "2",
            step_type: "05",
            name: customerName,
            id: user.id,
            // The participant step refuses to open its send-confirmation dialog when
            // an internal member has no delivery channel. Mail goes only to the same
            // configured eformsign service member; no customer is contacted.
            use_mail: true,
            use_sms: false,
        };
        prefill.fields.push(
            { id: "이용자 이메일", value: user.id },
            { id: "계약 년도", value: "26" },
            { id: "계약 월", value: "11" },
            { id: "계약 일", value: "24" },
            { id: "게약 년도", value: "26" },
            { id: "계약 서명 년도", value: "26" },
            { id: "계약 서명 월", value: "11" },
            { id: "계약 서명 일", value: "24" },
            { id: "이용자 서명", value: TEST_SIGNATURE },
            { id: "개인정보 처리", value: "동의함" },
            { id: "고유식별정보 처리 동의", value: "동의함" },
            { id: "민감정보 처리 동의", value: "동의함" },
            { id: "제3자 제공 동의", value: "동의함" },
        );

        const fixtureStartedAt = Date.now();
        const fixtureResult = await headlessService.dispatchCreation({ documentOption });
        const documentId = fixtureResult.documentId
            ?? await findRemoteByCustomer(customerName, fixtureStartedAt - 5_000);
        expect(documentId).toBeTruthy();
        remoteDocumentIds.add(documentId!);

        const participantStage = await eformsignClient.getDocument(
            token.oauth_token.access_token,
            documentId!,
        );
        const participantStepIndex = participantStage.current_status.step_index;
        const participantOptions = await eformsignService.generateStaffCompletionOptions(
            documentId!,
            token.oauth_token.access_token,
            token.oauth_token.refresh_token,
        ) as Record<string, unknown>;
        // This test-only prerequisite is fully prefilled, including the four
        // template radio values ("동의함"), so the normal editor gate can submit it.
        // eformsign can drop the safe top-level click without opening its popup.
        // A production request correctly falls back to the visible iframe after two
        // such misses. The live harness may reopen that same unfinished test document
        // to reach the provider stage; it never retries after popup send is attempted.
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const participantResult = await headlessService.dispatchFinalize({
                documentOption: participantOptions,
                documentId: documentId!,
            });
            const current = await waitForRemote(
                documentId!,
                (statusType, _stepType, document) => (
                    EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)
                    || document.current_status.step_index !== participantStepIndex
                ),
                5_000,
            );
            if (
                EFORMSIGN_COMPLETED_STATUS_CODES.has(current.current_status.status_type)
                || current.current_status.step_index !== participantStepIndex
                || participantResult.ok
            ) break;
            expect(participantResult).toEqual(expect.objectContaining({
                ok: false,
                reason: expect.stringContaining("confirmation popup timed out twice"),
            }));
        }

        const reviewStage = await waitForRemote(
            documentId!,
            (statusType, _stepType, document) => (
                EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)
                || document.current_status.step_name.includes("제공기관")
            ),
        );
        expect(EFORMSIGN_COMPLETED_STATUS_CODES.has(reviewStage.current_status.status_type)).toBe(false);
        expect(reviewStage.current_status.step_name).toContain("제공기관");

        await createEformsignDoc.execute(branchId, {
            documentId: documentId!,
            documentName: reviewStage.document_name,
            templateName: reviewStage.template?.name,
            customerName,
            clientId: reviewClientId,
            statusType: reviewStage.current_status.status_type,
            statusDetail: reviewStage.current_status.step_name,
            stepType: reviewStage.current_status.step_type,
            stepIndex: reviewStage.current_status.step_index,
            stepName: reviewStage.current_status.step_name,
            stepRecipientType: reviewStage.current_status.step_recipients?.[0]?.recipient_type ?? "06",
            stepRecipientName: reviewStage.current_status.step_recipients?.[0]?.name ?? "제공기관 확인",
            stepRecipientSms: TEST_CUSTOMER_PHONE,
            expiredDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
            linkToClient: true,
            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            templateId: reviewStage.template?.id,
        });

        let completed = reviewStage;
        for (let providerAttempt = 1; providerAttempt <= 3; providerAttempt += 1) {
            if (EFORMSIGN_COMPLETED_STATUS_CODES.has(completed.current_status.status_type)) break;
            const before = [
                completed.current_status.status_type,
                completed.current_status.step_type,
                completed.current_status.step_index,
                completed.current_status.step_name,
            ].join("|");

            await expect(finalizeDocument.execute({
                documentId: documentId!,
                prefillEndDate: REVIEW_END_DATE,
            })).resolves.toMatchObject({ ok: true });

            completed = await waitForRemote(
                documentId!,
                (statusType, _stepType, document) => (
                    EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)
                    || [
                        document.current_status.status_type,
                        document.current_status.step_type,
                        document.current_status.step_index,
                        document.current_status.step_name,
                    ].join("|") !== before
                ),
            );
        }
        expect(EFORMSIGN_COMPLETED_STATUS_CODES.has(completed.current_status.status_type)).toBe(true);

        const mirrorDeadline = Date.now() + 90_000;
        let local = await prisma.eformsign_doc.findUnique({ where: { documentId: documentId! } });
        let client = await prisma.client.findUnique({ where: { id: reviewClientId } });
        while (
            (local?.syncStatus !== "ready" || client?.endDate?.getTime() !== d(REVIEW_END_DATE).getTime())
            && Date.now() < mirrorDeadline
        ) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
            local = await prisma.eformsign_doc.findUnique({ where: { documentId: documentId! } });
            client = await prisma.client.findUnique({ where: { id: reviewClientId } });
        }
        expect(local?.statusType).toBe(completed.current_status.status_type);
        expect(local?.syncStatus).toBe("ready");
        expect(client?.eDocId).toBe(documentId);
        expect(extractEformsignContractEndDate(
            local!.detailPayload as unknown as EformsignApiDocumentResponse,
        )).toEqual(d(REVIEW_END_DATE));
        expect(client?.endDate).toEqual(d(REVIEW_END_DATE));

        const captureDirectory = process.env["LIVE_CAPTURE_PDF_DIR"]?.trim();
        if (captureDirectory) {
            const storedPdf = await prisma.eformsign_doc_file.findFirst({
                where: {
                    fileType: "document",
                    eformsignDoc: { documentId: documentId! },
                },
                select: { content: true },
            });
            expect(Buffer.from(storedPdf!.content).subarray(0, 5).toString("ascii")).toBe("%PDF-");
            await mkdir(captureDirectory, { recursive: true });
            await writeFile(
                join(captureDirectory, `contract-${TEST_AREA}.pdf`),
                Buffer.from(storedPdf!.content),
            );
        }
    });
});
