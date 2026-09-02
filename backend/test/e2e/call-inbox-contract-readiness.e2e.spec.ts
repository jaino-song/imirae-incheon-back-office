import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { json } from "express";
import request from "supertest";

import { CallInboxModule } from "module/call-inbox.module";
import { ClientModule } from "module/client.module";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CreateAndSendContractUsecase } from "application/usecases/eformsign-doc/create-and-send-contract.usecase";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";

type ClientRow = Awaited<ReturnType<PrismaService["client"]["findUniqueOrThrow"]>>;

/**
 * Contract readiness of a CALL-CREATED client — design spec §6.
 *
 * §6 asks: once call-inbox turns a phone call into a client, what does that
 * client still need before the EXISTING contract-issuance path (eformsign)
 * will accept it? This spec answers that with a live e2e against the real
 * production usecase, not a mock. It does NOT wire call-inbox to contract
 * issuance — 산모계약서 creation stays triggered elsewhere, unchanged.
 *
 * There is no HTTP controller for contract issuance (the only caller is the
 * ai-chat tool executor, a slice this harness cannot boot — ESM `nanoid`; see
 * the header comment in call-inbox.e2e.spec.ts). So this spec resolves
 * CreateAndSendContractUsecase straight from the Nest DI container and calls
 * `execute()` with the eformsign worker principal, exactly as
 * test/e2e/contract-headless.live.e2e.spec.ts:161-170 already does for
 * DispatchDocumentHeadlessUsecase — a provider that, like this one, is
 * registered in EformsignDocModule but not in its `exports` array.
 * EformsignDocModule is transitively in this graph via ClientModule
 * (module/client.module.ts:37), so `{ strict: false }` still reaches it.
 *
 * SAFETY / SCOPE: same as call-inbox.e2e.spec.ts — real DB, vendor stubs
 * only, self-skips unless E2E_VENDOR_STUBS=1 so an accidental run against a
 * live DATABASE_URL can never mutate anything (jest.config.ts also ignores
 * test/e2e/, so the default unit run never even collects this file). It runs
 * in the SAME jest process and DB as call-inbox.e2e.spec.ts
 * (scripts/run-call-inbox-e2e.mjs matches any spec path containing
 * "call-inbox" with --runInBand) — this file uses its own driveFileIds,
 * clients and eformsign_doc rows and cleans them up itself, so the two
 * suites do not interact and either can run first.
 *
 * The eformsign vendor stub records nothing about what was sent
 * (infrastructure/vendor-stubs/e2e-vendor-stubs.ts:647-649 discards
 * prefillFields), so the only observable proof of a successful issuance is
 * the persisted `eformsign_doc` mirror row that
 * create-and-send-contract.usecase.ts:316-338 writes after a real create
 * call. Field-level prefill assembly (address/date/empty-string fallbacks)
 * is covered instead by the existing usecase unit spec
 * (test/usecases/eformsign-doc/create-and-send-contract.usecase.spec.ts).
 */

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
// Seeded, branch-scoped, openToNextWork employee (test/e2e-env/seed-e2e.ts:306) —
// the fixture the brief names for exercising the assignment path.
const PRIMARY_EMPLOYEE_ID = 1;
const TEMPLATE_ID = "tpl-test";

const E2E_ENABLED = process.env["E2E_VENDOR_STUBS"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

// Unique to this spec file, never the shared call-inbox.e2e.spec.ts fixtures.
const RUN_TAG = Date.now().toString(36);

function buildWebhookPayload(driveFileId: string, fileName: string) {
    return {
        driveFileId,
        fileName,
        sttModel: "gemini-3.5-transcribe",
        diarized: true,
        vocabularyVersion: "v1",
        transcriptRaw: [
            { speaker: "1", text: "산후도우미 문의요" },
            { speaker: "2", text: "네 알겠습니다" },
        ],
    };
}

interface DraftListItem {
    id: string;
    type: string;
    status: string;
    callRecordId: string;
}

describeE2E(
    "Call Inbox contract readiness — what a call-created client can and cannot do (design spec §6)",
    () => {
        let app: INestApplication;
        let prisma: PrismaService;
        let createAndSendContract: CreateAndSendContractUsecase;

        let ingestToken: string;
        let ingestTokenId: string | undefined;

        const callRecordDriveFileIds: string[] = [];
        const createdClientIds: number[] = [];
        const createdDocumentIds: string[] = [];

        let gapClientId: number;
        let gapClientSnapshot: ClientRow;
        let invalidPhoneClientId: number;
        let invalidPhoneClientSnapshot: ClientRow;

        // Injects the seeded owner, mirroring call-inbox.e2e.spec.ts's seam.
        const ownerJwtGuard = {
            canActivate: (context: ExecutionContext) => {
                const req = context.switchToHttp().getRequest();
                req.user = {
                    userId: OWNER_USER_ID,
                    role: "owner",
                    branchId: BRANCH_ID,
                    branchRole: "owner",
                };
                return true;
            },
        };

        beforeAll(async () => {
            const moduleRef: TestingModule = await Test.createTestingModule({
                imports: [
                    ConfigModule.forRoot({ isGlobal: true }),
                    CallInboxModule,
                    ClientModule,
                    TenantModule,
                ],
            })
                .overrideGuard(JwtGuard)
                .useValue(ownerJwtGuard)
                .compile();

            app = moduleRef.createNestApplication();
            app.use(json({ limit: "1mb" }));
            app.useGlobalPipes(
                new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
            );
            await app.init();

            prisma = app.get(PrismaService);
            createAndSendContract = moduleRef.get(CreateAndSendContractUsecase, { strict: false });

            const tokenRes = await request(app.getHttpServer())
                .post(`/branches/${BRANCH_ID}/call-ingest-tokens`)
                .send({ label: `e2e-contract-readiness-${RUN_TAG}` });
            expect(tokenRes.status).toBe(201);
            ingestToken = tokenRes.body.token;
            ingestTokenId = tokenRes.body.id;
        });

        afterAll(async () => {
            if (prisma) {
                for (const driveFileId of callRecordDriveFileIds) {
                    await prisma.client_draft
                        .deleteMany({ where: { callRecord: { driveFileId } } })
                        .catch(() => undefined);
                    await prisma.call_record.deleteMany({ where: { driveFileId } }).catch(() => undefined);
                }
                if (createdClientIds.length > 0) {
                    // Unlink before deleting the eformsign_doc rows client.e_doc_id points at
                    // (FK: client.e_doc_id -> eformsign_doc.document_id, NO ACTION).
                    await prisma.client
                        .updateMany({ where: { id: { in: createdClientIds } }, data: { eDocId: null } })
                        .catch(() => undefined);
                }
                if (createdDocumentIds.length > 0) {
                    await prisma.eformsign_doc
                        .deleteMany({ where: { documentId: { in: createdDocumentIds } } })
                        .catch(() => undefined);
                }
                if (createdClientIds.length > 0) {
                    await prisma.eformsign_dispatch_intent
                        .deleteMany({ where: { clientId: { in: createdClientIds } } })
                        .catch(() => undefined);
                    await prisma.employee_schedule
                        .deleteMany({ where: { clientId: { in: createdClientIds } } })
                        .catch(() => undefined);
                    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } }).catch(() => undefined);
                }
                if (ingestTokenId !== undefined) {
                    await prisma.call_ingest_token
                        .deleteMany({ where: { id: ingestTokenId } })
                        .catch(() => undefined);
                }
            }
            await app?.close();
        });

        /** Runs the real webhook -> draft -> confirm pipeline and returns the created clientId. */
        async function ingestAndConfirm(
            driveFileId: string,
            fileName: string,
            fields: Record<string, unknown>,
        ): Promise<number> {
            callRecordDriveFileIds.push(driveFileId);

            const webhookRes = await request(app.getHttpServer())
                .post("/webhooks/call-transcripts")
                .set("Authorization", `Bearer ${ingestToken}`)
                .send(buildWebhookPayload(driveFileId, fileName));
            expect(webhookRes.status).toBe(202);
            const callRecordId: string = webhookRes.body.callRecordId;

            const deadline = Date.now() + 10_000;
            let draft: DraftListItem | undefined;
            while (Date.now() < deadline) {
                const listRes = await request(app.getHttpServer()).get("/client-drafts?status=PENDING&limit=100");
                expect(listRes.status).toBe(200);
                draft = (listRes.body.data as DraftListItem[]).find((d) => d.callRecordId === callRecordId);
                if (draft) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (!draft) throw new Error(`draft not found for driveFileId=${driveFileId}`);
            expect(draft.type).toBe("NEW_CLIENT");

            const confirmRes = await request(app.getHttpServer())
                .post(`/client-drafts/${draft.id}/confirm`)
                .send({ fields, suppressGreetingSms: true });
            expect(confirmRes.status).toBeGreaterThanOrEqual(200);
            expect(confirmRes.status).toBeLessThan(300);
            const clientId: number = confirmRes.body.clientId;
            createdClientIds.push(clientId);
            return clientId;
        }

        it("case 1 — readiness gap: a call-created client with NO caregiver assignment fails contract issuance with the exact guard message", async () => {
            gapClientId = await ingestAndConfirm(
                `e2e-call-contract-readiness-gap-${RUN_TAG}`,
                `통화 녹음 테스트-갭_010-9999-0001.m4a`,
                {
                    // Everything a call can plausibly hand off — deliberately NO primaryEmployeeId.
                    name: `갭클라이언트-${RUN_TAG}`,
                    phone: "01099990001",
                    address: "인천 남동구 테스트로 1",
                    startDate: "2026-09-15",
                },
            );
            gapClientSnapshot = await prisma.client.findUniqueOrThrow({ where: { id: gapClientId } });

            const result = await createAndSendContract.execute(
                BRANCH_ID,
                { clientId: gapClientId, templateId: TEMPLATE_ID },
                createEformsignWorkerPrincipal(BRANCH_ID),
            );

            // This is the design-spec §6 answer: a call yields everything except the
            // caregiver assignment. This is the SAME guard manually-created clients hit
            // (contract-client-assignment-guard.service.ts:9-15, already unit-tested at
            // create-and-send-contract.usecase.spec.ts:42) — not a call-specific defect.
            expect(result).toEqual({
                success: false,
                error: "고객의 제공인력 배정을 먼저 저장해 주세요.",
            });
        });

        it("case 2 — happy-minimal: call-derivable fields PLUS a caregiver assignment succeed, and the persisted eformsign_doc mirror carries the client's real name/phone", async () => {
            const happyClientId = await ingestAndConfirm(
                `e2e-call-contract-readiness-happy-${RUN_TAG}`,
                `통화 녹음 테스트-해피_010-9999-0002.m4a`,
                {
                    name: `해피클라이언트-${RUN_TAG}`,
                    phone: "01099990002",
                    address: "인천 남동구 테스트로 2",
                    startDate: "2026-09-15",
                    // The one thing case 1 was missing, seeded per the brief
                    // (test/e2e-env/seed-e2e.ts:306) — confirming with this set drives
                    // client.service.ts:1065 into executeWithInitialSchedule, which creates
                    // the employee_schedule row the assignment guard needs.
                    primaryEmployeeId: PRIMARY_EMPLOYEE_ID,
                },
            );
            const clientBeforeContract = await prisma.client.findUniqueOrThrow({ where: { id: happyClientId } });
            // No endDate was supplied above — sets up the today-substitution finding below.
            expect(clientBeforeContract.endDate).toBeNull();

            const result = await createAndSendContract.execute(
                BRANCH_ID,
                { clientId: happyClientId, templateId: TEMPLATE_ID },
                createEformsignWorkerPrincipal(BRANCH_ID),
            );

            expect(result.success).toBe(true);
            expect(typeof result.documentId).toBe("string");
            const documentId = result.documentId as string;
            createdDocumentIds.push(documentId);

            // FINDING (not fixed here — see the result contract's not_built list):
            // create-and-send-contract.usecase.ts:237-243 formatDate(null) substitutes
            // TODAY for a missing endDate rather than leaving 계약 종료 년/월/일 blank or
            // throwing. Nothing in this call failed because of it; the client above just
            // proved it. The prefill assembly itself is not observable from this e2e
            // (the vendor stub discards prefillFields), so this is recorded as an
            // observed behavior, not asserted against the discarded payload.

            const doc = await prisma.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
            expect(doc).toMatchObject({
                clientId: happyClientId,
                customerName: `해피클라이언트-${RUN_TAG}`,
                stepRecipientName: `해피클라이언트-${RUN_TAG}`,
                // Proves name+phone actually crossed the provider boundary as the
                // client's real values, not a placeholder.
                stepRecipientSms: "01099990002",
                documentName: `계약서 - 해피클라이언트-${RUN_TAG}`,
                templateId: TEMPLATE_ID,
                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            });

            const clientAfterContract = await prisma.client.findUniqueOrThrow({ where: { id: happyClientId } });
            expect(clientAfterContract.eDocId).toBe(documentId);
        });

        it("case 3 — negative control: a client with an invalid phone hits the exact validation contract before the assignment guard even runs", async () => {
            // Deliberately NOT run through webhook -> draft -> confirm: ConfirmNewClientFieldsDto's
            // phone field is itself @IsCanonicalPhone()-validated (interface/dto/canonical-phone.validator.ts),
            // so a malformed phone can never reach ClientService.create through that HTTP path. This
            // negative control only needs "a client" per the brief, so it is seeded directly —
            // the same pattern test/e2e/contract-headless.live.e2e.spec.ts:198-215 already uses.
            const invalidPhoneClient = await prisma.client.create({
                data: {
                    name: `무효연락처-${RUN_TAG}`,
                    phone: "12",
                    branchId: BRANCH_ID,
                    voucherClient: false,
                    suppressGreetingSms: true,
                },
            });
            invalidPhoneClientId = invalidPhoneClient.id;
            createdClientIds.push(invalidPhoneClientId);
            invalidPhoneClientSnapshot = invalidPhoneClient;

            const result = await createAndSendContract.execute(
                BRANCH_ID,
                { clientId: invalidPhoneClientId, templateId: TEMPLATE_ID },
                createEformsignWorkerPrincipal(BRANCH_ID),
            );

            // Proves the validation genuinely runs in this harness (create-and-send-contract.usecase.ts:89-99),
            // which is what makes case 2's success meaningful rather than a harness artifact.
            expect(result).toEqual({
                success: false,
                error: "고객 연락처가 유효하지 않습니다",
            });
        });

        it("case 4 — no-mutation check: the failed readiness probes (cases 1 and 3) did not alter the client rows they read", async () => {
            const gapAfter = await prisma.client.findUniqueOrThrow({ where: { id: gapClientId } });
            expect(gapAfter).toEqual(gapClientSnapshot);

            const invalidPhoneAfter = await prisma.client.findUniqueOrThrow({ where: { id: invalidPhoneClientId } });
            expect(invalidPhoneAfter).toEqual(invalidPhoneClientSnapshot);
        });
    },
);
