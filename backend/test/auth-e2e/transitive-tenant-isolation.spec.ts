import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../../app.module";

/**
 * Live-Postgres cross-branch isolation proof for the six data-bearing models that have NO
 * `branch_id` column and are therefore invisible to the tenant-isolation Prisma extension
 * (infrastructure/database/tenant-isolation.extension.ts) and absent from TENANT_MODELS
 * (infrastructure/tenant/tenant-models.generated.ts):
 *
 *   eformsign_doc_file, chat_message, chat_feedback, agent_message, doc_template,
 *   bank_account_info
 *
 * Design spec: docs/superpowers/specs/2026-09-01-call-inbox-productionization-design.md §5.2.
 * These models rely entirely on PARENT-PATH scoping (a join through a branch-keyed parent, or
 * an application-layer ownership check) — there is no Prisma-extension backstop for either
 * TENANT_ISOLATION_MODE. Every spec below therefore asserts APPLICATION-layer behavior
 * (controller/service/repository query construction) and must hold identically under both
 * `observe` and `enforce`, since neither mode changes how these six models are queried.
 *
 * Sibling to tenant-isolation.spec.ts; follows its convention exactly: boot the real AppModule,
 * never mock a repository/service/guard, and build fixtures in `beforeAll` via a bare
 * `new PrismaClient()` (`verifyPrisma`) that never opens a `tenantContextStore.run()` ALS scope,
 * so every fixture write hits `decidePreExecution`'s "no ALS store active -> bypass" branch
 * regardless of TENANT_ISOLATION_MODE — see the `verifyPrisma` comment in tenant-isolation.spec.ts
 * for the full rationale.
 *
 * Reuses the branches/users seed-auth-e2e.ts already creates (branchA/branchB,
 * admin-a/admin-b/user-a/user-b) — this spec adds only what that seed intentionally omits: area,
 * doc_template, bank_account_info, chat_session, chat_message, chat_feedback, agent_session,
 * agent_message, eformsign_doc, eformsign_doc_file.
 */

const PASSWORD = "Password1!";
// seed-auth-e2e.ts ids.branchA / ids.branchB
const BRANCH_1 = "20000000-0000-4000-8000-000000000001";
const BRANCH_2 = "20000000-0000-4000-8000-000000000002";
// seed-auth-e2e.ts emails for the branch-1 / branch-2 admin and regular-user accounts.
const ADMIN_1_EMAIL = "admin-a@auth-e2e.test";
const ADMIN_2_EMAIL = "admin-b@auth-e2e.test";
const USER_1_EMAIL = "user-a@auth-e2e.test";
const USER_2_EMAIL = "user-b@auth-e2e.test";
// seed-auth-e2e.ts ids.userA — the seed script does not export its `ids` map, so this spec's
// own fixture rows (chat_session.userId, chat_feedback.userId, agent_session.userId) that must
// FK to an existing user re-declare the one id they need.
const USER_1_ID = "10000000-0000-4000-8000-000000000003";

// This spec's own fixtures, created in beforeAll below.
const AREA_1_ID = "40000000-0000-4000-8000-000000000001"; // branch-1-owned area
// schema.prisma `model area`: branchId is nullable (`branchId String? @map("branch_id")`) — the
// "specific hole to probe" named in the unit brief.
const AREA_NULL_ID = "40000000-0000-4000-8000-000000000002";
const EFORMSIGN_DOC_1_DOCUMENT_ID = "transitive-spec-branch1-doc";

describe("transitively-scoped model tenant isolation (parent-path only, no branch_id column)", () => {
    let app: INestApplication;
    // Bare, unextended PrismaClient — see file-header comment. Used for fixture setup/teardown
    // and for direct-DB assertions that a rejected write left the row unchanged.
    let verifyPrisma: PrismaClient;

    let chatSession1Id: string;
    let chatMessage1Id: string;
    let chatFeedback1Id: string;
    let agentSession1Id: string;
    let agentMessage1Id: string;
    let eformsignDoc1Id: number;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
        await app.init();

        verifyPrisma = new PrismaClient();
        await verifyPrisma.$connect();

        // --- area (x2) -> doc_template, bank_account_info -----------------------------------
        await verifyPrisma.area.create({
            data: { id: AREA_1_ID, name: "Transitive Spec Area 1", koreanName: "이전스펙지역1", branchId: BRANCH_1 },
        });
        await verifyPrisma.area.create({
            data: { id: AREA_NULL_ID, name: "Transitive Spec Area Null", koreanName: "이전스펙지역없음", branchId: null },
        });
        await verifyPrisma.doc_template.create({
            data: { areaId: AREA_1_ID, templateId: "tpl-branch1", templateName: "Branch1 Template" },
        });
        await verifyPrisma.doc_template.create({
            data: { areaId: AREA_NULL_ID, templateId: "tpl-null-area", templateName: "Null Area Template" },
        });
        await verifyPrisma.bank_account_info.create({
            data: { areaId: AREA_1_ID, bankName: "Branch1 Bank", accNum: "111-111-111" },
        });
        await verifyPrisma.bank_account_info.create({
            data: { areaId: AREA_NULL_ID, bankName: "Null Area Bank", accNum: "999-999-999" },
        });

        // --- chat_session -> chat_message -> chat_feedback (branch-1, owned by user-a) ------
        const chatSession1 = await verifyPrisma.chat_session.create({
            data: { userId: USER_1_ID, branchId: BRANCH_1, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });
        chatSession1Id = chatSession1.id;
        const chatMessage1 = await verifyPrisma.chat_message.create({
            data: { sessionId: chatSession1Id, role: "user", content: "branch-1 secret chat content" },
        });
        chatMessage1Id = chatMessage1.id;
        const chatFeedback1 = await verifyPrisma.chat_feedback.create({
            data: {
                sessionId: chatSession1Id,
                messageId: chatMessage1Id,
                userId: USER_1_ID,
                type: "positive",
                comment: "branch-1 secret feedback comment",
            },
        });
        chatFeedback1Id = chatFeedback1.id;

        // --- agent_session -> agent_message (branch-1, owned by user-a) ---------------------
        const agentSession1 = await verifyPrisma.agent_session.create({
            data: {
                userId: USER_1_ID,
                branchId: BRANCH_1,
                model: "test-model",
                agentVersion: "test-version",
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
        });
        agentSession1Id = agentSession1.id;
        const agentMessage1 = await verifyPrisma.agent_message.create({
            data: {
                sessionId: agentSession1Id,
                role: "assistant",
                parts: [{ type: "text", text: "branch-1 secret agent reply" }],
            },
        });
        agentMessage1Id = agentMessage1.id;

        // --- eformsign_doc -> eformsign_doc_file (branch-1) ----------------------------------
        const detailSourceUpdatedDate = new Date("2026-01-01T00:00:00.000Z");
        const eformsignDoc1 = await verifyPrisma.eformsign_doc.create({
            data: {
                documentId: EFORMSIGN_DOC_1_DOCUMENT_ID,
                branchId: BRANCH_1,
                createdDate: new Date(),
                updatedDate: new Date(),
                statusType: "in_progress",
                statusDetail: "in_progress",
                stepType: "sign",
                stepIndex: "1",
                stepName: "sign",
                stepRecipientType: "member",
                stepRecipientName: "branch1 recipient",
                stepRecipientSms: "01000000000",
                expiredDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                syncStatus: "ready",
                // Only needs to be truthy for EformsignDocumentMirrorService#getStoredFileMetadata's
                // `!state?.detailPayload` guard — content is never asserted on.
                detailPayload: { current_status: { status_type: "in_progress" } },
                detailSourceUpdatedDate,
            },
        });
        eformsignDoc1Id = eformsignDoc1.id;
        await verifyPrisma.eformsign_doc_file.create({
            data: {
                eformsignDocId: eformsignDoc1Id,
                fileType: "document",
                content: Buffer.from("transitive-spec-pdf-bytes"),
                contentType: "application/pdf",
                byteSize: Buffer.from("transitive-spec-pdf-bytes").length,
                sha256: "a".repeat(64),
                // Must equal eformsign_doc.detailSourceUpdatedDate exactly (getTime() match) for
                // getStoredFileMetadata to resolve this file without falling through to
                // syncMissingDocumentFile (which would attempt a real vendor HTTP call).
                sourceUpdatedDate: detailSourceUpdatedDate,
            },
        });
    });

    afterAll(async () => {
        // Each delete cascades to its children (all `onDelete: Cascade` in schema.prisma), so
        // this also cleans up anything a positive-control test created (e.g. a fresh
        // chat_feedback row from the POST /ai/chat/feedback test below).
        await verifyPrisma.eformsign_doc.deleteMany({ where: { id: eformsignDoc1Id } });
        await verifyPrisma.agent_session.deleteMany({ where: { id: agentSession1Id } });
        await verifyPrisma.chat_session.deleteMany({ where: { id: chatSession1Id } });
        await verifyPrisma.area.deleteMany({ where: { id: { in: [AREA_1_ID, AREA_NULL_ID] } } });
        await verifyPrisma.$disconnect();
        await app.close();
    });

    async function login(email: string) {
        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ email, password: PASSWORD })
            .expect(201);
        return response.body as { accessToken: string; refreshToken: string };
    }

    async function selectBranch(accessToken: string, branchId: string) {
        const response = await request(app.getHttpServer())
            .post("/auth/select-branch")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ branchId })
            .expect(201);
        return response.body as { accessToken: string; refreshToken: string };
    }

    async function sessionFor(email: string, branchId: string) {
        const initial = await login(email);
        return selectBranch(initial.accessToken, branchId);
    }

    // =====================================================================================
    // doc_template — real access path: AreaTemplateController (interface/controllers/
    // area-template.controller.ts), gated by `@CurrentTenant() tenant.branchId` on every
    // handler, enforced by SbAreaTemplateRepository requiring `area: { branchId: branchid }`
    // (an exact match) on every query.
    // =====================================================================================
    describe("doc_template — parent-path scoping via area", () => {
        it("denies a branch-2 admin from reading a branch-1 area's doc_template", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            // SbAreaTemplateRepository#findByArea (infrastructure/database/repositories/
            // sb.area-template.repository.ts:40-45) resolves to `null` on a cross-branch area,
            // and AreaTemplateController#findByArea returns it unwrapped — Nest sends `null` as
            // HTTP 200 with an empty JSON body, not 404 (same documented pattern as
            // ClientController#findById in tenant-isolation.spec.ts:124-146).
            const response = await request(app.getHttpServer())
                .get("/area-templates/area")
                .query({ area: AREA_1_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body?.areaId).toBeUndefined();
            expect(response.body?.templateId).toBeUndefined();
        });

        it("lets a branch-1 admin read its own area's doc_template (positive control)", async () => {
            const session = await sessionFor(ADMIN_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .get("/area-templates/area")
                .query({ area: AREA_1_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body?.areaId).toBe(AREA_1_ID);
            expect(response.body?.templateId).toBe("tpl-branch1");
        });

        it("PROBE: a null-branch area's doc_template is unreachable through this path from EITHER branch (dead, not leaked)", async () => {
            // Resolves the unit brief's "specific hole to probe" for doc_template specifically:
            // SbAreaTemplateRepository#findByArea requires `area: { branchId: branchid }` where
            // `branchid` is always a concrete UUID (the caller's own selected branch) — Postgres
            // never matches `branch_id IS NULL` against `branch_id = <uuid>`, so a null-branch
            // area's doc_template can never satisfy this filter for ANY branch. It is dead
            // functionality via this path, not a cross-branch leak.
            const asBranch1 = await sessionFor(ADMIN_1_EMAIL, BRANCH_1);
            const asBranch2 = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            for (const session of [asBranch1, asBranch2]) {
                const response = await request(app.getHttpServer())
                    .get("/area-templates/area")
                    .query({ area: AREA_NULL_ID })
                    .set("Authorization", `Bearer ${session.accessToken}`)
                    .expect(200);
                expect(response.body?.areaId).toBeUndefined();
            }
        });
    });

    // =====================================================================================
    // bank_account_info — real access path: BankAccountInfoController (interface/controllers/
    // bank-account-info.controller.ts). HOLE: unlike its sibling AreaTemplateController above
    // (same `area` parent), this controller never resolves or passes a branchId at all.
    // =====================================================================================
    describe("bank_account_info — parent-path scoping via area (HOLE)", () => {
        it("lets a branch-1 admin read its own area's bank_account_info (positive control)", async () => {
            const session = await sessionFor(ADMIN_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .get("/bank-account-infos/area")
                .query({ area: AREA_1_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body?.area).toBe(AREA_1_ID);
            expect(response.body?.accNum).toBe("111-111-111");
        });

        // HOLE, confirmed at every layer:
        //   - interface/controllers/bank-account-info.controller.ts:23-28 (`findByArea`), :30-34
        //     (`update`), :36-39 (`delete`) call the service with ONLY `area` — no
        //     `@CurrentTenant()`, no `TenantGuard`; the only guard is `OwnerOrAdminGuard`
        //     (infrastructure/auth/owner-or-admin.guard.ts), which admits ANY branch's admin
        //     (`role === 'admin' || role === 'owner'`, not branch-scoped).
        //   - application/services/bank-account-info.service.ts#update has no branchId
        //     parameter in its signature at all — the gap cannot be closed by the controller
        //     alone without also changing the service/usecase.
        //   - application/usecases/bank-account-info/update-bank-account-info.usecase.ts:18
        //     calls `findByArea(area)` with no branchId — the exact smell named in the unit
        //     brief.
        //   - infrastructure/database/repositories/sb.bank-account-info.repository.ts:11-26:
        //     every method branch-filters ONLY when a branchId argument is supplied; the real
        //     HTTP path never supplies one, so the unfiltered branch of the `branchId ? ... :
        //     ...` ternary always runs.
        //   - `bank_account_info` has no `branch_id` column, so it is absent from TENANT_MODELS
        //     (infrastructure/tenant/tenant-models.generated.ts) and the tenant-isolation Prisma
        //     extension provides no backstop in EITHER mode.
        // This subsumes the brief's "nullable area" hypothesis (asserted separately below): even
        // a bank_account_info row whose area DOES have a real branch_id (AREA_1_ID, owned by
        // BRANCH_1) is fully readable and updatable by an admin from a different branch — the
        // null-area case is not a special case, just one more instance of the same missing check.
        //
        // Written as the DESIRED (secure) behavior and skipped, since it currently fails: the
        // read returns branch-1's real data instead of an empty/denied response, and the update
        // actually mutates the row instead of being rejected. Do not unskip without also fixing
        // the controller/service/usecase chain above — that fix is out of this unit's Paths
        // allowlist (`backend/test/auth-e2e/**` only) and routes through the orchestrator.
        it.skip("HOLE: should deny a branch-2 admin from reading and updating a branch-1 area's bank_account_info", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);

            const readResponse = await request(app.getHttpServer())
                .get("/bank-account-infos/area")
                .query({ area: AREA_1_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200); // matches AreaTemplateController's null-miss convention above: 200 + empty body, not a 4xx
            expect(readResponse.body?.area).toBeUndefined();

            await request(app.getHttpServer())
                .patch("/bank-account-infos")
                .query({ area: AREA_1_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .send({ bankName: "hacked-by-branch-2" });

            const stillThere = await verifyPrisma.bank_account_info.findUnique({ where: { areaId: AREA_1_ID } });
            expect(stillThere?.bankName).toBe("Branch1 Bank");
        });

        // Same HOLE, the brief's specific hypothesis: a bank_account_info row hanging off a
        // NULL-branch area has no branch gate anywhere and is reachable by any branch. Because
        // BankAccountInfoController never filters by branch at all (see above), this is not a
        // distinct code path from the one exercised above — it is included for direct
        // traceability to the brief's named hypothesis.
        it.skip("HOLE: should deny (but currently allows) reading a null-branch area's bank_account_info from any branch", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            const response = await request(app.getHttpServer())
                .get("/bank-account-infos/area")
                .query({ area: AREA_NULL_ID })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body?.area).toBeUndefined();
        });
    });

    // =====================================================================================
    // chat_message / chat_feedback — SAFE real access path: AIChatController (interface/
    // controllers/ai-chat.controller.ts), gated by both userId AND `@CurrentTenant()
    // tenant.branchId`. SbChatSessionRepository#findById (infrastructure/database/
    // repositories/sb.chat-session.repository.ts:12-27) requires an exact `{ id, userId,
    // branchId }` match and explicitly documents why a null-branch session is never returned
    // to a caller that supplied a branchId.
    // =====================================================================================
    describe("chat_message / chat_feedback — safe user-facing path (ai/chat)", () => {
        it("denies a branch-2 user from reading a branch-1 user's chat session (and its messages)", async () => {
            const session = await sessionFor(USER_2_EMAIL, BRANCH_2);
            await request(app.getHttpServer())
                .get(`/ai/chat/sessions/${chatSession1Id}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(404);
        });

        it("lets a branch-1 user read its own chat session and messages (positive control)", async () => {
            const session = await sessionFor(USER_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .get(`/ai/chat/sessions/${chatSession1Id}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body.id).toBe(chatSession1Id);
            expect(response.body.messages).toHaveLength(1);
            expect(response.body.messages[0].content).toBe("branch-1 secret chat content");
        });

        // Write-path denial/positive-control for chat_feedback specifically: AIChatController
        // #submitFeedback (interface/controllers/ai-chat.controller.ts:184-223) re-resolves the
        // session via `chat_session.findFirst({ where: { id, userId, branchId } })` before
        // creating any chat_feedback row.
        it("denies a branch-2 user from submitting feedback against a branch-1 user's session/message", async () => {
            const session = await sessionFor(USER_2_EMAIL, BRANCH_2);
            await request(app.getHttpServer())
                .post("/ai/chat/feedback")
                .set("Authorization", `Bearer ${session.accessToken}`)
                .send({ sessionId: chatSession1Id, messageId: chatMessage1Id, type: "negative" })
                .expect(404);
        });

        it("lets a branch-1 user submit feedback against its own session/message (positive control)", async () => {
            const session = await sessionFor(USER_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .post("/ai/chat/feedback")
                .set("Authorization", `Bearer ${session.accessToken}`)
                .send({ sessionId: chatSession1Id, messageId: chatMessage1Id, type: "positive" })
                .expect(201);
            expect(response.body.success).toBe(true);
        });
    });

    // =====================================================================================
    // chat_message / chat_feedback — SECOND real access path: AdminFeedbackController
    // (interface/controllers/admin-feedback.controller.ts). HOLE: this is an entirely separate
    // read path from the safe ai/chat path above, and it has no branch scoping whatsoever.
    // =====================================================================================
    describe("chat_message / chat_feedback — admin analytics path (admin/feedback) (HOLE)", () => {
        // HOLE, confirmed at every layer:
        //   - AdminFeedbackController is guarded by `JwtGuard, OwnerOrAdminGuard` ONLY
        //     (interface/controllers/admin-feedback.controller.ts:21-22) — no TenantGuard, no
        //     branch context read or passed anywhere in this controller.
        //   - OwnerOrAdminGuard (infrastructure/auth/owner-or-admin.guard.ts) admits ANY
        //     branch's admin via the JWT-validated `user.role` (a global column, not a
        //     branch-scoped role): `role === 'admin' || role === 'owner'`.
        //   - Every query in ChatFeedbackRepository (infrastructure/database/repositories/
        //     chat-feedback.repository.ts) is unfiltered by branch: `findById` (:37-48) and
        //     `findManyWithPagination` (:58-83) carry no `where.branchId`/session-ownership
        //     check of any kind.
        //   - `chat_feedback` (and `chat_message`, nested into the same response at
        //     admin-feedback.controller.ts:93-107) has no `branch_id` column, so neither is in
        //     TENANT_MODELS and the tenant-isolation Prisma extension provides no backstop in
        //     EITHER mode.
        // Net effect: any branch's admin can read every other branch's AI chat feedback AND the
        // full message/session content nested in the response.
        //
        // Written as the desired (secure) behavior and skipped, since it currently fails.
        it.skip("HOLE: should deny a branch-2 admin from reading a branch-1 user's chat_feedback via admin/feedback detail", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            await request(app.getHttpServer())
                .get(`/admin/feedback/${chatFeedback1Id}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(404);
        });

        it.skip("HOLE: should exclude branch-1 rows from a branch-2 admin's admin/feedback list", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            const response = await request(app.getHttpServer())
                .get("/admin/feedback")
                .query({ limit: 50 })
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            const ids = (response.body.data as Array<{ id: string }>).map((item) => item.id);
            expect(ids).not.toContain(chatFeedback1Id);
        });
    });

    // =====================================================================================
    // agent_message — real access path: AgentController (interface/controllers/
    // agent.controller.ts), gated by both userId AND branchId via `owner()`
    // (agent.controller.ts:209-212). PrismaAgentSessionRepository#findOwned
    // (infrastructure/database/repositories/prisma-agent-session.repository.ts:95-101)
    // requires an exact `{ id, userId, branchId }` match — agent_session.branchId is NOT NULL
    // in schema.prisma, so there is no nullable-parent variant to probe for this model.
    // =====================================================================================
    describe("agent_message — safe path via agent_session ownership (ai/agent/sessions)", () => {
        it("denies a branch-2 user from reading a branch-1 user's agent session (and its messages)", async () => {
            const session = await sessionFor(USER_2_EMAIL, BRANCH_2);
            await request(app.getHttpServer())
                .get(`/ai/agent/sessions/${agentSession1Id}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(404);
        });

        it("lets a branch-1 user read its own agent session and messages (positive control)", async () => {
            const session = await sessionFor(USER_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .get(`/ai/agent/sessions/${agentSession1Id}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body.id).toBe(agentSession1Id);
            expect(response.body.messages).toHaveLength(1);
            expect(response.body.messages[0].id).toBe(agentMessage1Id);
        });
    });

    // =====================================================================================
    // eformsign_doc_file — real access path: EformsignController (interface/controllers/
    // eformsign.controller.ts) `download_files` route, gated by `filterDocumentsByBranch`
    // (eformsign.controller.ts:298-329), which for a non-headquarters branch requires
    // `EformsignDocService#findAll(branchid)` to resolve the document (exact `branchId:
    // branchid` match — infrastructure/.../*.eformsign-doc.repository.ts:267-272). Our seed
    // branches (slugs "auth-e2e-a"/"auth-e2e-b") never match INCHEON_STAFF_BRANCH_SLUG, so the
    // deliberate headquarters cross-branch carve-out (eformsign.controller.ts:292-296, a named
    // design decision, not a gap) does not apply to either test branch here.
    // EformsignDocumentMirrorService#getStoredFileMetadata (application/services/
    // eformsign-document-mirror.service.ts:237-270) itself queries eformsign_doc_file by
    // documentId ONLY, with no branch filter — it relies entirely on the controller's
    // pre-check, exactly the "parent-path scoping" pattern this whole spec file audits.
    // =====================================================================================
    describe("eformsign_doc_file — parent-path scoping via eformsign_doc (api/documents/:id/download_files)", () => {
        it("denies a branch-2 session from reading a branch-1 document's file (403, gated before any file lookup)", async () => {
            const session = await sessionFor(ADMIN_2_EMAIL, BRANCH_2);
            await request(app.getHttpServer())
                .head(`/api/documents/${EFORMSIGN_DOC_1_DOCUMENT_ID}/download_files`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(403);
        });

        it("lets a branch-1 session read its own document's file metadata (positive control)", async () => {
            const session = await sessionFor(ADMIN_1_EMAIL, BRANCH_1);
            const response = await request(app.getHttpServer())
                .head(`/api/documents/${EFORMSIGN_DOC_1_DOCUMENT_ID}/download_files`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.headers["content-type"]).toBe("application/pdf");
        });
    });
});
