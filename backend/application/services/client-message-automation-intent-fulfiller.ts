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
    const claimed = await params.prisma.$queryRaw<Array<{
        id: string;
        scheduled_for: Date | string;
    }>>(Prisma.sql`
        UPDATE "message_trigger_job"
        SET next_attempt_at = clock_timestamp() + (${CLAIM_LEASE_MINUTES} * interval '1 minute'),
            updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE dedupe_key = ${dedupeKey}
          AND rule_id = ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
          AND status = 'failed'
          AND cancel_reason = ${MESSAGE_AUTOMATION_INTENT_RETRY_REASON}
          AND canceled_by_user = false
          AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
        RETURNING id, scheduled_for;
    `);
    const claim = claimed[0];
    if (!claim) return false;

    try {
        if (!(await isBranchApproved(params.prisma, params.branchId))) {
            await releaseClientIntent(params.prisma, claim.id);
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
            await releaseClientIntent(params.prisma, claim.id);
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

async function releaseClientIntent(prisma: PrismaService, id: string): Promise<void> {
    await prisma.message_trigger_job.updateMany({
        where: {
            id,
            ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
            status: "failed",
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
        },
        data: {
            nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
        },
    });
}
