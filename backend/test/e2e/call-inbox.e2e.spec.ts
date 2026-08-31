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

/**
 * Call Inbox E2E — real DB, real call-inbox slice, vendor stubs.
 *
 * SAFETY: this suite mutates the database (creates an ingest token, a
 * call_record, a client_draft and a client). It must ONLY run against the
 * disposable e2e stack — the throwaway Postgres container the mobile-ci e2e
 * job stands up (migrate deploy + db:seed:e2e + E2E_VENDOR_STUBS=1). To make
 * that non-negotiable it self-skips unless E2E_VENDOR_STUBS=1, so an
 * accidental `npm test` against a developer's live DATABASE_URL can never
 * reach these mutations. (jest.config.ts also ignores test/e2e/, so the
 * default unit run never even collects this file — this guard is the second
 * belt.)
 *
 * Slice choice: we import CallInboxModule (+ ClientModule, TenantModule)
 * rather than the whole AppModule. AppModule transitively pulls in the
 * ESM-only `nanoid` (via the ai-chat slice) which ts-jest does not transform,
 * and no spec in this repo boots AppModule for that reason. CallInboxModule
 * wires the real controllers, services, guards and — because
 * E2E_VENDOR_STUBS=1 — the StubCallExtractionAdapter behind CALL_EXTRACTION_PORT.
 *
 * StubCallExtractionAdapter (infrastructure/vendor-stubs/e2e-vendor-stubs.ts)
 * returns a deterministic NEW_CONSULTATION result for 김서연 (name + dueDate
 * proposals, both high-confidence, requestSummary "...(E2E stub)"). Aligo is
 * stubbed too, and confirm passes suppressGreetingSms anyway, so no SMS egress.
 *
 * Guards: CallIngestGuard and TenantGuard run REAL (token resolution + branch
 * authorization are genuinely exercised against the DB). Only JwtGuard is
 * overridden to inject the seeded owner identity — the established seam in this
 * repo's controller specs, since passport/JwtModule are not part of this slice.
 *
 * Seed fixtures consumed (test/e2e-env/seed-e2e.ts): the owner user and the
 * branch it owns. This spec creates only its own per-run rows and removes them
 * in afterAll.
 */

// Seeded fixtures (test/e2e-env/seed-e2e.ts).
const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";

const E2E_ENABLED = process.env["E2E_VENDOR_STUBS"] === "1";
// Skip the whole suite outside the disposable e2e stack (see header).
const describeE2E = E2E_ENABLED ? describe : describe.skip;

// Unique per run so re-runs against the same disposable DB never collide on
// the call_record.driveFileId unique constraint.
const FILE_ID = `e2e-call-${Date.now()}`;
const FILE_NAME = "통화 녹음 김서연_010-4821-7763.m4a";

const webhookPayload = {
    driveFileId: FILE_ID,
    fileName: FILE_NAME,
    sttModel: "gemini-3.5-transcribe",
    diarized: true,
    vocabularyVersion: "v1",
    transcriptRaw: [{ speaker: "1", text: "산후도우미 문의요" }],
};

interface DraftListItem {
    id: string;
    type: string;
    status: string;
    requestSummary: string;
    callerPhone: string | null;
    callRecordId: string;
    hasLowConfidence: boolean;
}

describeE2E("Call Inbox E2E (webhook → draft → confirm)", () => {
    let app: INestApplication;
    let prisma: PrismaService;

    // Captured across the ordered flow.
    let ingestToken: string;
    let ingestTokenId: string | undefined;
    let callRecordId: string;
    let draftId: string;
    let createdClientId: number | undefined;

    // Injects the seeded owner. TenantGuard (real) consumes this and verifies
    // the branch exists in the DB before allowing the request.
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
        // Mirror main.ts wiring so behaviour matches production:
        // 1mb json limit for long transcript payloads + the strict global pipe.
        app.use(json({ limit: "1mb" }));
        app.useGlobalPipes(
            new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
        );
        await app.init();

        prisma = app.get(PrismaService);
    });

    afterAll(async () => {
        // Best-effort cleanup of this run's rows (the disposable DB is also
        // reset per CI run, but keep local re-runs idempotent). Order respects
        // FK direction: draft → call_record, client last, token independent.
        if (prisma) {
            await prisma.client_draft
                .deleteMany({ where: { callRecord: { driveFileId: FILE_ID } } })
                .catch(() => undefined);
            await prisma.call_record.deleteMany({ where: { driveFileId: FILE_ID } }).catch(() => undefined);
            if (createdClientId !== undefined) {
                await prisma.client.deleteMany({ where: { id: createdClientId } }).catch(() => undefined);
            }
            if (ingestTokenId !== undefined) {
                await prisma.call_ingest_token.deleteMany({ where: { id: ingestTokenId } }).catch(() => undefined);
            }
        }
        await app?.close();
    });

    it("1. owner provisions a call-ingest token (cit_ prefix)", async () => {
        const res = await request(app.getHttpServer())
            .post(`/branches/${BRANCH_ID}/call-ingest-tokens`)
            .send({ label: "e2e" });

        expect(res.status).toBe(201);
        expect(typeof res.body.token).toBe("string");
        expect(res.body.token).toMatch(/^cit_/);
        expect(res.body.branchId).toBe(BRANCH_ID);

        ingestToken = res.body.token;
        ingestTokenId = res.body.id;
    });

    it("2. webhook ingests a fresh transcript → 202 accepted, not duplicate", async () => {
        const res = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set("Authorization", `Bearer ${ingestToken}`)
            .send(webhookPayload);

        expect(res.status).toBe(202);
        expect(res.body.accepted).toBe(true);
        expect(res.body.duplicate).toBe(false);
        expect(typeof res.body.callRecordId).toBe("string");

        callRecordId = res.body.callRecordId;
    });

    it("2b. the stored call_record carries transcript_raw + stt_meta; summary stays null at ingest", async () => {
        const record = await prisma.call_record.findUnique({ where: { id: callRecordId } });

        expect(record).not.toBeNull();
        expect(record?.transcript).toEqual(webhookPayload.transcriptRaw);
        expect(record?.transcriptRaw).toEqual(webhookPayload.transcriptRaw);
        expect(record?.sttMeta).toEqual({
            sttModel: webhookPayload.sttModel,
            diarized: webhookPayload.diarized,
            vocabularyVersion: webhookPayload.vocabularyVersion,
        });
        expect(record?.summary).toBeNull();
    });

    it("3. re-posting the identical payload is idempotent → 200 duplicate, same callRecordId", async () => {
        const res = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set("Authorization", `Bearer ${ingestToken}`)
            .send(webhookPayload);

        expect(res.status).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(res.body.callRecordId).toBe(callRecordId);
    });

    it("4. the NEW_CLIENT draft surfaces from async extraction (poll ≤10s)", async () => {
        const deadline = Date.now() + 10_000;
        let draft: DraftListItem | undefined;

        while (Date.now() < deadline) {
            const res = await request(app.getHttpServer()).get("/client-drafts?status=PENDING&limit=100");
            expect(res.status).toBe(200);

            draft = (res.body.data as DraftListItem[]).find((d) => d.callRecordId === callRecordId);
            if (draft) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        expect(draft).toBeDefined();
        const found = draft as DraftListItem;
        expect(found.type).toBe("NEW_CLIENT");
        expect(found.requestSummary).toContain("E2E stub");
        expect(found.hasLowConfidence).toBe(false);
        // resolveCallerPhone normalizes the stub candidate "010-4821-7763".
        expect(found.callerPhone).toBe("01048217763");

        draftId = found.id;
    });

    it("5. staff confirms the draft → creates a client (suppressGreetingSms)", async () => {
        const res = await request(app.getHttpServer())
            .post(`/client-drafts/${draftId}/confirm`)
            .send({
                fields: {
                    name: "김서연",
                    careCenter: false,
                    voucherClient: false,
                    breastPump: false,
                    dueDate: "2026-07-15",
                },
                suppressGreetingSms: true,
            });

        // POST default is 201 in Nest; assert 2xx per the plan.
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        expect(typeof res.body.clientId).toBe("number");

        createdClientId = res.body.clientId;
    });

    it("6. the created client is 김서연 and the draft is now CONFIRMED", async () => {
        const clientRes = await request(app.getHttpServer()).get(`/clients/${createdClientId}`);
        expect(clientRes.status).toBe(200);
        expect(clientRes.body.name).toBe("김서연");

        const draftRes = await request(app.getHttpServer()).get(`/client-drafts/${draftId}`);
        expect(draftRes.status).toBe(200);
        expect(draftRes.body.status).toBe("CONFIRMED");
        expect(draftRes.body.clientId).toBe(createdClientId);
    });

    it("7. a second confirm of the same draft is rejected → 409", async () => {
        const res = await request(app.getHttpServer())
            .post(`/client-drafts/${draftId}/confirm`)
            .send({
                fields: {
                    name: "김서연",
                    careCenter: false,
                    voucherClient: false,
                    breastPump: false,
                    dueDate: "2026-07-15",
                },
                suppressGreetingSms: true,
            });

        expect(res.status).toBe(409);
    });

    it("8. the webhook rejects an invalid ingest token → 401", async () => {
        const res = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set("Authorization", "Bearer cit_invalid-token-e2e")
            .send({ ...webhookPayload, driveFileId: `${FILE_ID}-invalid` });

        expect(res.status).toBe(401);
    });
});
