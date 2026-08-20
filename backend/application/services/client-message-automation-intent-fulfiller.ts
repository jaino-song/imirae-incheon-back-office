import { Prisma } from "@prisma/client";
import {
    getClientAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTriggerService } from "./message-trigger.service";

const CLAIM_LEASE_MINUTES = 10;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export async function fulfillClientMessageAutomationIntent(params: {
    prisma: PrismaService;
    triggerService: MessageTriggerService;
    branchId: string;
    clientId: number;
    includePast: boolean;
    suppressGreeting: boolean;
}): Promise<boolean> {
    const dedupeKey = getClientAutomationIntentDedupeKey(params.branchId, params.clientId);
    // Internal intent rows start at attempts=0. The first approved claim promotes the row to 1
    // while persisting its batch anchor; later claims retain that anchor for deterministic retries.
    const claimed = await params.prisma.$queryRaw<Array<{
        id: string;
        scheduled_for: Date | string;
    }>>(Prisma.sql`
        WITH claim_clock AS (
            SELECT date_trunc('milliseconds', clock_timestamp()) AS claimed_at
        ), candidate AS MATERIALIZED (
            SELECT
                job.id,
                COALESCE(intent_branch.sms_sender_approval_status = 'approved', false)
                    AS is_approved,
                claim_clock.claimed_at
            FROM "message_trigger_job" AS job
            CROSS JOIN claim_clock
            LEFT JOIN "branch" AS intent_branch
              ON intent_branch.id = job.branch_id
            WHERE job.dedupe_key = ${dedupeKey}
              AND job.rule_id = ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
              AND job.status = 'failed'
              AND job.cancel_reason = ${MESSAGE_AUTOMATION_INTENT_RETRY_REASON}
              AND job.canceled_by_user = false
              AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= claim_clock.claimed_at)
            FOR UPDATE OF job SKIP LOCKED
        ), updated AS (
            UPDATE "message_trigger_job" AS job
            SET scheduled_for = CASE
                    WHEN candidate.is_approved AND job.attempts = 0
                        THEN candidate.claimed_at
                    ELSE job.scheduled_for
                END,
                attempts = CASE
                    WHEN candidate.is_approved AND job.attempts = 0 THEN 1
                    WHEN candidate.is_approved THEN job.attempts
                    ELSE 0
                END,
                next_attempt_at = CASE
                    WHEN candidate.is_approved
                        THEN candidate.claimed_at
                            + (${CLAIM_LEASE_MINUTES} * interval '1 minute')
                    ELSE candidate.claimed_at
                        + (${RETRY_DELAY_MS} * interval '1 millisecond')
                END,
                updated_at = candidate.claimed_at
            FROM candidate
            WHERE job.id = candidate.id
            RETURNING job.id, job.scheduled_for, candidate.is_approved
        )
        SELECT id, scheduled_for
        FROM updated
        WHERE is_approved;
    `);
    const claim = claimed[0];
    if (!claim) return false;

    try {
        if (!(await isBranchApproved(params.prisma, params.branchId))) {
            await releaseClientIntent(params.prisma, claim.id, true);
            return false;
        }
        await params.triggerService.ensureDefaultRulesForBranch(params.branchId);
        await params.triggerService.syncClientRulesForClient(
            params.branchId,
            params.clientId,
            params.includePast,
            params.suppressGreeting,
            {
                stableBatchAt: claim.scheduled_for instanceof Date
                    ? claim.scheduled_for
                    : new Date(claim.scheduled_for),
                preserveExisting: true,
            },
        );
        if (!(await isBranchApproved(params.prisma, params.branchId))) {
            await releaseClientIntent(params.prisma, claim.id, true);
            return false;
        }
        await params.prisma.message_trigger_job.deleteMany({
            where: {
                id: claim.id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
            },
        });
        return true;
    } catch (error) {
        try {
            await releaseClientIntent(params.prisma, claim.id);
        } catch {
            // The bounded DB lease still makes the intent eligible again.
        }
        throw error;
    }
}

async function isBranchApproved(prisma: PrismaService, branchId: string): Promise<boolean> {
    const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { smsSenderApprovalStatus: true },
    });
    return branch?.smsSenderApprovalStatus === "approved";
}

async function releaseClientIntent(
    prisma: PrismaService,
    id: string,
    resetStableBatch = false,
): Promise<void> {
    await prisma.message_trigger_job.updateMany({
        where: {
            id,
            ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
            status: "failed",
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
        },
        data: {
            ...(resetStableBatch ? { attempts: 0 } : {}),
            nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
        },
    });
}
