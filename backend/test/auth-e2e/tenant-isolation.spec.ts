import { randomUUID } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    IMessageLogRepository,
    MESSAGE_LOG_REPOSITORY,
} from "domain/repositories/message-log.repository.interface";
import {
    IMessageTriggerJobRepository,
    MESSAGE_TRIGGER_JOB_REPOSITORY,
} from "domain/repositories/message-trigger-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import {
    getTenantIsolationStats,
    resetTenantIsolationStats,
    resolveTenantIsolationMode,
} from "infrastructure/tenant/tenant-isolation.reporter";

import { AppModule } from "../../app.module";

/**
 * Live-Postgres cross-branch isolation proof, complementing the mocked-guard
 * assertions in test/e2e/multi-tenancy.spec.ts (which stub ClientService and
 * TenantGuard collaborators directly). This spec boots the real AppModule
 * against the auth-e2e Postgres instance and never mocks a repository,
 * service, or guard.
 */

const PASSWORD = "Password1!";
const BRANCH_1 = "20000000-0000-4000-8000-000000000001";
const BRANCH_2 = "20000000-0000-4000-8000-000000000002";
const ADMIN_2_EMAIL = "admin-b@auth-e2e.test";

describe("live-database cross-branch tenant isolation", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    // A plain, unextended-by-nothing-special-but-request-independent PrismaClient. Every
    // query issued through this instance runs OUTSIDE any tenantContextStore.run() —
    // this test file never opens an ALS store around it — so `tenantContextStore.get()`
    // resolves to undefined for these calls, and the tenant-isolation Prisma extension's
    // `decidePreExecution` hits its first branch ("no ALS store active" -> bypass). That is
    // not a gap in the isolation under test: it is exactly why this instance is safe to use
    // as an out-of-band verifier of what actually landed in the database.
    let verifyPrisma: PrismaClient;

    let branch1ClientId: number;
    let branch2ClientId: number;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
        await app.init();
        prisma = app.get(PrismaService);

        verifyPrisma = new PrismaClient();
        await verifyPrisma.$connect();

        const [branch1Client, branch2Client] = await Promise.all([
            verifyPrisma.client.create({
                data: {
                    name: "Tenant Isolation Spec Branch1 Client",
                    branchId: BRANCH_1,
                    voucherClient: false,
                },
            }),
            verifyPrisma.client.create({
                data: {
                    name: "Tenant Isolation Spec Branch2 Client",
                    branchId: BRANCH_2,
                    voucherClient: false,
                },
            }),
        ]);
        branch1ClientId = branch1Client.id;
        branch2ClientId = branch2Client.id;
    });

    afterAll(async () => {
        await verifyPrisma.client.deleteMany({
            where: { id: { in: [branch1ClientId, branch2ClientId] } },
        });
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

    async function branch2Session() {
        const login2 = await login(ADMIN_2_EMAIL);
        return selectBranch(login2.accessToken, BRANCH_2);
    }

    describe("API read isolation", () => {
        it("never exposes a branch-1 client's row to a branch-2 session's get-by-id", async () => {
            const session = await branch2Session();

            // ClientController#findById (interface/controllers/client.controller.ts) returns
            // whatever ClientService#findById resolves to, and that in turn is a branch-scoped
            // Prisma findFirst (infrastructure/database/repositories/sb.client.repository.ts)
            // that resolves to `null` on a cross-branch id -- it does NOT throw NotFoundException.
            // A Nest controller returning `null` sends HTTP 200 with an empty JSON body, not
            // 404/403 (this exact behavior is already documented by the mocked-guard test at
            // test/e2e/multi-tenancy.spec.ts:141-153, which asserts status 200 for the same
            // scenario). Asserting 403/404 here would be asserting behavior the app does not
            // have; the isolation guarantee this test proves is narrower and load-bearing: the
            // branch-1 row itself is never returned to the branch-2 caller.
            const response = await request(app.getHttpServer())
                .get(`/clients/${branch1ClientId}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);
            expect(response.body?.id).not.toBe(branch1ClientId);
        });

        it("excludes branch-1 rows from a branch-2 session's client list", async () => {
            const session = await branch2Session();

            const response = await request(app.getHttpServer())
                .get("/clients")
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(200);

            const ids = (response.body as Array<{ id: number }>).map((c) => c.id);
            expect(ids).not.toContain(branch1ClientId);
        });
    });

    describe("API write isolation", () => {
        it("rejects update and delete of a branch-1 client from a branch-2 session, and leaves the row untouched", async () => {
            const session = await branch2Session();

            // Both ClientService#update and ClientService#delete re-resolve the target via the
            // branch-scoped findById first and throw NotFoundException when it comes back null
            // (application/services/client.service.ts:1508-1511, and
            // application/usecases/client/delete-client.usecase.ts:27-31) -- unlike the plain
            // get-by-id read path above, these two DO surface as 404.
            await request(app.getHttpServer())
                .patch(`/clients/${branch1ClientId}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .send({ name: "hacked-by-branch-2" })
                .expect(404);

            await request(app.getHttpServer())
                .delete(`/clients/${branch1ClientId}`)
                .set("Authorization", `Bearer ${session.accessToken}`)
                .expect(404);

            // Direct, ALS-free verification (see `verifyPrisma` comment above): prove the row
            // is unchanged and still present, independent of anything the HTTP layer reported.
            const stillThere = await verifyPrisma.client.findUnique({
                where: { id: branch1ClientId },
            });
            expect(stillThere).not.toBeNull();
            expect(stillThere?.name).toBe("Tenant Isolation Spec Branch1 Client");
            expect(stillThere?.branchId).toBe(BRANCH_1);
        });
    });

    describe("repository-level isolation", () => {
        let jobRepo: IMessageTriggerJobRepository;
        let logRepo: IMessageLogRepository;
        let ruleId: string;
        let branch1JobId: string;
        let branch1LogId: number;

        beforeAll(async () => {
            jobRepo = app.get<IMessageTriggerJobRepository>(MESSAGE_TRIGGER_JOB_REPOSITORY);
            logRepo = app.get<IMessageLogRepository>(MESSAGE_LOG_REPOSITORY);

            const rule = await verifyPrisma.message_trigger_rule.create({
                data: {
                    branchId: BRANCH_1,
                    name: "tenant-isolation-spec rule",
                    eventType: "CLIENT_CREATED",
                    offsetType: "IMMEDIATE",
                    recipientType: MessageTriggerRecipientType.CLIENT,
                    templateKey: MessageTriggerTemplateKey.INFO,
                },
            });
            ruleId = rule.id;

            const created = await jobRepo.create(
                MessageTriggerJobEntity.create({
                    branchId: BRANCH_1,
                    ruleId,
                    scheduledFor: new Date(Date.now() + 60_000),
                    recipientType: MessageTriggerRecipientType.CLIENT,
                    templateKey: MessageTriggerTemplateKey.INFO,
                    dedupeKey: `tenant-isolation-spec:${randomUUID()}`,
                    payload: {
                        memberId: "tenant-isolation-spec",
                        recipientName: "tenant-isolation-spec",
                        recipientPhone: "01000000000",
                        templateVariables: {},
                    },
                }),
            );
            branch1JobId = created.id;

            const log = await verifyPrisma.message_log.create({
                data: {
                    branchId: BRANCH_1,
                    provider: "aligo_sms",
                    templateKey: MessageTriggerTemplateKey.INFO,
                    receiver: "01000000000",
                    messageBody: "tenant-isolation-spec fixture",
                },
            });
            branch1LogId = log.id;
        });

        afterAll(async () => {
            await verifyPrisma.message_log.deleteMany({ where: { id: branch1LogId } });
            await verifyPrisma.message_trigger_job.deleteMany({ where: { id: branch1JobId } });
            await verifyPrisma.message_trigger_rule.deleteMany({ where: { id: ruleId } });
        });

        it("message_trigger_job findByIdInBranch is branch-fenced", async () => {
            await expect(jobRepo.findByIdInBranch(BRANCH_2, branch1JobId)).resolves.toBeNull();
            const own = await jobRepo.findByIdInBranch(BRANCH_1, branch1JobId);
            expect(own).not.toBeNull();
            expect(own?.id).toBe(branch1JobId);
        });

        it("message_log findByIdInBranch is branch-fenced", async () => {
            await expect(logRepo.findByIdInBranch(BRANCH_2, branch1LogId)).resolves.toBeNull();
            const own = await logRepo.findByIdInBranch(BRANCH_1, branch1LogId);
            expect(own).not.toBeNull();
            expect(own?.id).toBe(branch1LogId);
        });

        it("message_trigger_job update() pinned to the wrong branch does not touch the row (no-op/P2025); pinned to the owning branch it succeeds", async () => {
            // SbMessageTriggerJobRepository#update (infrastructure/database/repositories/
            // sb.message-trigger-job.repository.ts:157-186) always folds the entity's own
            // branchId into the Prisma `where` alongside `id` (branchWhereFragment). This is
            // enforced by the repository's own where-clause construction, independent of the
            // tenant-isolation Prisma extension/ALS store: both this call and the earlier
            // findByIdInBranch calls above run with no ALS store active at all (case 1 of
            // decidePreExecution -> bypass), so what's under test here is the repository's own
            // branch fence, not the extension.
            const wronglyPinned = await jobRepo.findByIdInBranch(BRANCH_1, branch1JobId);
            expect(wronglyPinned).not.toBeNull();
            wronglyPinned!.branchId = BRANCH_2; // simulate a caller pinning the where-clause to the wrong (non-owning) branch
            wronglyPinned!.cancelReason = "cross-branch-attempt";
            await expect(jobRepo.update(wronglyPinned!)).rejects.toThrow();

            const stillBranch1 = await verifyPrisma.message_trigger_job.findUnique({
                where: { id: branch1JobId },
            });
            expect(stillBranch1?.branchId).toBe(BRANCH_1);
            expect(stillBranch1?.cancelReason).toBeNull();

            const correctlyPinned = await jobRepo.findByIdInBranch(BRANCH_1, branch1JobId);
            correctlyPinned!.cancelReason = "same-branch-update";
            const updated = await jobRepo.update(correctlyPinned!);
            expect(updated.cancelReason).toBe("same-branch-update");
        });
    });

    // This describe block asserts on the module-level counters exposed by
    // infrastructure/tenant/tenant-isolation.reporter.ts (getTenantIsolationStats /
    // resetTenantIsolationStats). Those counters are process-global for the lifetime of this
    // spec FILE's module registry (Jest gives each test file its own sandboxed module registry,
    // so this does not leak into auth-lifecycle.spec.ts or any other file even under
    // maxWorkers: 1). If this ever proves flaky -- e.g. a future edit to an earlier `it` in
    // this file starts touching a tenant model inside an ALS-scoped store between the
    // resetTenantIsolationStats() call and the assertion below -- skip just this describe block
    // (change `describe` to `describe.skip` two lines down) rather than the whole file; nothing
    // else in this spec depends on it.
    (resolveTenantIsolationMode() === "observe" ? describe : describe.skip)(
        "observe-mode tenant_isolation_violation reporting",
        () => {
            it("records exactly one violation for a deliberately unscoped read inside an artificial http-origin store", async () => {
                resetTenantIsolationStats();

                await tenantContextStore.run({ origin: "http", branchId: BRANCH_1 }, async () => {
                    // Deliberately unscoped: no `where.branchId` filter, issued through the
                    // DI-provided (tenant-isolation-extended) PrismaService while an artificial
                    // http-origin ALS store claims branch1. branch2ClientId (this spec's own
                    // branch-2 fixture) is enough to trip `cross_branch_read`.
                    await prisma.client.findMany({
                        where: { id: { in: [branch1ClientId, branch2ClientId] } },
                    });
                });

                expect(getTenantIsolationStats()).toMatchObject({
                    violations: 1,
                    violationsByKind: { cross_branch_read: 1 },
                });
            });
        },
    );
});
