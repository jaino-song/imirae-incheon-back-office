import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { json } from "express";
import request from "supertest";

import { CallInboxModule } from "module/call-inbox.module";
import { ClientModule } from "module/client.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

/**
 * Call Inbox SMS Automation E2E — real DB, real call-inbox + message-trigger
 * slices, vendor stubs.
 *
 * PURPOSE: prove that a client created from a confirmed CALL draft
 * (call-inbox.service.ts confirmNewClientWithDraft → clientService.create)
 * triggers the EXISTING CLIENT_CREATED SMS automation exactly like a
 * manually-created client — and that suppressGreetingSms surgically skips
 * only the CLIENT_GREETING template, not the whole automation pipeline. This
 * is verification, not new behavior: no automation-engine or confirm-flow
 * code is touched here (see design spec §7).
 *
 * Invocation chain under test (call-inbox.service.ts:381 →
 * client.service.ts:1090-1140 → client-message-automation-intent-fulfiller.ts
 * → message-trigger.service.ts:833 syncClientRulesForClient). Job creation is
 * SYNCHRONOUS within the confirm HTTP call — no cron/queue needs driving.
 *
 * SAFETY: mutates the DB (ingest token, call_record, client_draft, client,
 * message_trigger_rule/job rows). Self-skips unless E2E_VENDOR_STUBS=1, and
 * jest.config.ts ignores test/e2e/ from the default unit run — see
 * call-inbox.e2e.spec.ts's header for the full rationale (identical here).
 *
 * SHARED-DB WARNING: this file runs in the SAME --runInBand jest process and
 * the SAME disposable database as call-inbox.e2e.spec.ts (the runner matches
 * `test/e2e/call-inbox*`), in jest-chosen (not guaranteed) file order. That
 * shared spec's own case 5 confirms a NEW_CLIENT draft, which — on whichever
 * of the two files runs first — auto-provisions the branch's default
 * CLIENT_GREETING rule via ensureDefaultRulesForBranch
 * (message-trigger.service.ts:355-361, :1208-1229) and never tears it down.
 * So this spec must never assume a clean message_trigger_rule slate: every
 * rule it depends on is found-or-created (see ensureClientCreatedRule below),
 * and only rows THIS file created are removed in afterAll.
 */

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";

const E2E_ENABLED = process.env["E2E_VENDOR_STUBS"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

// Unique per run, and never overlapping the shared call-inbox.e2e.spec.ts's
// own driveFileIds, so re-runs against the same disposable DB never collide
// on the call_record.driveFileId unique constraint.
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const FILE_ID_GREETING_ON = `e2e-sms-automation-on-${RUN_ID}`;
const FILE_ID_GREETING_OFF = `e2e-sms-automation-off-${RUN_ID}`;

function buildWebhookPayload(driveFileId: string) {
    return {
        driveFileId,
        fileName: "통화 녹음 SMS자동화_010-0000-0000.m4a",
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
    requestSummary: string;
    callerPhone: string | null;
    callRecordId: string;
    hasLowConfidence: boolean;
}

interface EnsuredRule {
    id: string;
    created: boolean;
}

interface ClientAutomationJob {
    id: string;
    ruleId: string;
    branchId: string | null;
    templateKey: string;
    payload: unknown;
}

describeE2E("Call Inbox SMS Automation E2E (call-created client → CLIENT_CREATED automation)", () => {
    let app: INestApplication;
    let prisma: PrismaService;

    let ingestToken: string;
    let ingestTokenId: string | undefined;

    let clientGreetingRule: EnsuredRule;
    let thanksRule: EnsuredRule;

    let clientIdGreetingOn: number | undefined;
    let clientIdGreetingOff: number | undefined;

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
                SchedulerLeaseModule,
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

        const tokenRes = await request(app.getHttpServer())
            .post(`/branches/${BRANCH_ID}/call-ingest-tokens`)
            .send({ label: "e2e-sms-automation" });
        if (tokenRes.status !== 201) {
            throw new Error(`Failed to provision call-ingest token: ${tokenRes.status} ${JSON.stringify(tokenRes.body)}`);
        }
        ingestToken = tokenRes.body.token;
        ingestTokenId = tokenRes.body.id;

        // Order-independent: find the CLIENT_CREATED+CLIENT_GREETING rule the
        // production auto-provisioning path (ensureDefaultRulesForBranch) may
        // already have created via the shared spec's own confirm, or create it
        // ourselves so this spec's assertions never depend on file run order.
        clientGreetingRule = await ensureClientCreatedRule(prisma, {
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            name: "신규 고객 인사 메시지",
            isDefault: true,
        });
        // THANKS is not part of the default-provisioning set, so this spec is
        // the sole owner of this rule's lifecycle in this DB.
        thanksRule = await ensureClientCreatedRule(prisma, {
            templateKey: MessageTriggerTemplateKey.THANKS,
            name: "예약 완료 안내 (E2E)",
            isDefault: false,
        });
    });

    afterAll(async () => {
        if (prisma) {
            const driveFileIds = [FILE_ID_GREETING_ON, FILE_ID_GREETING_OFF];
            await prisma.client_draft
                .deleteMany({ where: { callRecord: { driveFileId: { in: driveFileIds } } } })
                .catch(() => undefined);
            await prisma.call_record
                .deleteMany({ where: { driveFileId: { in: driveFileIds } } })
                .catch(() => undefined);

            const clientIds = [clientIdGreetingOn, clientIdGreetingOff]
                .filter((id): id is number => id !== undefined);
            if (clientIds.length > 0) {
                await prisma.message_trigger_job
                    .deleteMany({ where: { clientId: { in: clientIds } } })
                    .catch(() => undefined);
                await prisma.client.deleteMany({ where: { id: { in: clientIds } } }).catch(() => undefined);
            }

            if (thanksRule?.created) {
                await prisma.message_trigger_job
                    .deleteMany({ where: { ruleId: thanksRule.id } })
                    .catch(() => undefined);
                await prisma.message_trigger_rule
                    .deleteMany({ where: { id: thanksRule.id } })
                    .catch(() => undefined);
            }
            if (clientGreetingRule?.created) {
                await prisma.message_trigger_job
                    .deleteMany({ where: { ruleId: clientGreetingRule.id } })
                    .catch(() => undefined);
                await prisma.message_trigger_rule
                    .deleteMany({ where: { id: clientGreetingRule.id } })
                    .catch(() => undefined);
            }

            if (ingestTokenId !== undefined) {
                await prisma.call_ingest_token
                    .deleteMany({ where: { id: ingestTokenId } })
                    .catch(() => undefined);
            }
        }
        await app?.close();
    });

    /**
     * Ingests a fresh call-transcript webhook, polls for its NEW_CLIENT draft
     * (mirrors call-inbox.e2e.spec.ts test 2 → 4 exactly), then confirms it
     * with staff-final fields. Returns the created client's id.
     */
    const ingestAndConfirmDraft = async (params: {
        driveFileId: string;
        name: string;
        phone: string;
        suppressGreetingSms: boolean;
    }): Promise<number> => {
        const ingestRes = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set("Authorization", `Bearer ${ingestToken}`)
            .send(buildWebhookPayload(params.driveFileId));
        expect(ingestRes.status).toBe(202);
        expect(ingestRes.body.accepted).toBe(true);
        const callRecordId = ingestRes.body.callRecordId as string;

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

        const confirmRes = await request(app.getHttpServer())
            .post(`/client-drafts/${found.id}/confirm`)
            .send({
                fields: {
                    name: params.name,
                    phone: params.phone,
                    careCenter: false,
                    voucherClient: false,
                    breastPump: false,
                    dueDate: "2026-07-15",
                },
                suppressGreetingSms: params.suppressGreetingSms,
            });
        expect(confirmRes.status).toBeGreaterThanOrEqual(200);
        expect(confirmRes.status).toBeLessThan(300);
        expect(typeof confirmRes.body.clientId).toBe("number");
        return confirmRes.body.clientId as number;
    };

    /**
     * The non-intent, non-schedule CLIENT_CREATED automation jobs for a
     * client — same query shape as full-flow.e2e.spec.ts's
     * listClientGenericJobs (:276-289): always exclude the sentinel intent
     * marker row (ruleId = MESSAGE_AUTOMATION_INTENT_RULE_ID, a "failed"
     * durable-recovery placeholder written inside the create transaction,
     * never a real message job) and scope to clientId, never branch-wide.
     */
    const listClientAutomationJobs = (clientId: number): Promise<ClientAutomationJob[]> =>
        prisma.message_trigger_job.findMany({
            where: {
                clientId,
                employeeScheduleId: null,
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            },
            select: {
                id: true,
                ruleId: true,
                branchId: true,
                templateKey: true,
                payload: true,
            },
        });

    it("1. greeting ON: a confirmed call-created client gets both a CLIENT_GREETING and a THANKS job with real template variables", async () => {
        const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-7);
        const name = `SMS자동화ON-${uniqueDigits}`;
        const phone = `0109${uniqueDigits}`;

        clientIdGreetingOn = await ingestAndConfirmDraft({
            driveFileId: FILE_ID_GREETING_ON,
            name,
            phone,
            suppressGreetingSms: false,
        });

        const jobs = await listClientAutomationJobs(clientIdGreetingOn);
        const greetingJob = jobs.find((job) => job.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING);
        const thanksJob = jobs.find((job) => job.templateKey === MessageTriggerTemplateKey.THANKS);

        expect(greetingJob).toBeDefined();
        expect(thanksJob).toBeDefined();

        expect(greetingJob?.branchId).toBe(BRANCH_ID);
        expect(thanksJob?.branchId).toBe(BRANCH_ID);

        expect(greetingJob?.payload).toEqual(expect.objectContaining({
            templateVariables: { name, clientName: name, phone },
        }));
        expect(thanksJob?.payload).toEqual(expect.objectContaining({
            templateVariables: { name, clientName: name, phone },
        }));
    });

    it("2. greeting suppressed: a THANKS job still fires while CLIENT_GREETING is surgically skipped", async () => {
        const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-7);
        const name = `SMS자동화OFF-${uniqueDigits}`;
        const phone = `0106${uniqueDigits}`;

        clientIdGreetingOff = await ingestAndConfirmDraft({
            driveFileId: FILE_ID_GREETING_OFF,
            name,
            phone,
            suppressGreetingSms: true,
        });

        const jobs = await listClientAutomationJobs(clientIdGreetingOff);

        // Assert the THANKS job FIRST — an empty job set here would be a FAIL,
        // not a pass. This is what proves the pipeline actually ran (branch
        // approval gate, default-rule provisioning, sync) and that suppression
        // is scoped to templateKey === CLIENT_GREETING alone
        // (message-trigger.service.ts:911), not a blanket "no automation".
        const thanksJobs = jobs.filter((job) => job.templateKey === MessageTriggerTemplateKey.THANKS);
        expect(thanksJobs.length).toBeGreaterThanOrEqual(1);
        expect(thanksJobs[0]?.payload).toEqual(expect.objectContaining({
            templateVariables: { name, clientName: name, phone },
        }));

        const greetingJobs = jobs.filter((job) => job.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING);
        expect(greetingJobs).toHaveLength(0);
    });

    it("3. branch scope: both clients' automation jobs carry the fixture branch id; none exist for any other branch", async () => {
        const clientIds = [clientIdGreetingOn, clientIdGreetingOff]
            .filter((id): id is number => id !== undefined);
        expect(clientIds).toHaveLength(2);

        const jobs = await prisma.message_trigger_job.findMany({
            where: {
                clientId: { in: clientIds },
                employeeScheduleId: null,
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            },
            select: { branchId: true },
        });
        expect(jobs.length).toBeGreaterThan(0);
        expect(jobs.every((job) => job.branchId === BRANCH_ID)).toBe(true);

        const otherBranchJobCount = await prisma.message_trigger_job.count({
            where: {
                clientId: { in: clientIds },
                branchId: { not: BRANCH_ID },
            },
        });
        expect(otherBranchJobCount).toBe(0);
    });
});

/**
 * Find-or-create a CLIENT_CREATED/CLIENT recipient rule by templateKey, for
 * order-independent setup against a DB that may already carry it (from the
 * shared call-inbox.e2e.spec.ts's own confirm, in whichever file jest runs
 * first). Mirrors the working raw-Prisma pattern in
 * full-flow.e2e.spec.ts:238-268 (ensureEmployeeAssignmentRule): match on
 * branchId/isActive/eventType/recipientType/templateKey (the same fields
 * production's own matchTemplateKeyOnly default-provisioning check ignores
 * offsetType/offsetDays for), create with an explicit id when absent.
 */
async function ensureClientCreatedRule(
    prisma: PrismaService,
    params: { templateKey: MessageTriggerTemplateKey; name: string; isDefault: boolean },
): Promise<EnsuredRule> {
    const existing = await prisma.message_trigger_rule.findFirst({
        where: {
            branchId: BRANCH_ID,
            isActive: true,
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: params.templateKey,
        },
        select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const id = `e2e:client-created:${params.templateKey}:${Date.now()}:${Math.floor(Math.random() * 1000)}`;
    await prisma.message_trigger_rule.create({
        data: {
            id,
            branchId: BRANCH_ID,
            name: params.name,
            isActive: true,
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: params.templateKey,
            isDefault: params.isDefault,
            jobsStale: false,
        },
    });
    return { id, created: true };
}
