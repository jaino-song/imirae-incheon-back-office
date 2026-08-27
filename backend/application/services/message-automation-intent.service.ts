import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
    getScheduleAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "./message-automation-intent-writer";
import { fulfillClientMessageAutomationIntent } from "./client-message-automation-intent-fulfiller";
import { MessageTriggerService } from "./message-trigger.service";
import { ServiceRecordLinkService } from "./service-record-link.service";

const CLAIM_LEASE_MINUTES = 10;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 100;

function toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
}

interface IntentCandidate {
    id: string;
    branchId: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    scheduledFor: Date;
    updatedAt: Date;
    payload: Prisma.JsonValue;
}

interface ScheduleIntentClaim {
    id: string;
    scheduledFor: Date;
    updatedAt: Date;
}

@Injectable()
export class MessageAutomationIntentService {
    private readonly logger = new Logger(MessageAutomationIntentService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly triggerService: MessageTriggerService,
        private readonly serviceRecordLinkService: ServiceRecordLinkService,
    ) {}

    async persistClientIntent(
        transaction: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            includePast: boolean;
            suppressGreeting: boolean;
            intentAt: Date;
        },
    ): Promise<void> {
        await persistClientMessageAutomationIntent(transaction, params);
    }

    async persistScheduleIntent(
        transaction: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            scheduleId: number;
            includePast: boolean;
            intentAt: Date;
            replaceExisting?: boolean;
        },
    ): Promise<void> {
        await persistScheduleMessageAutomationIntent(transaction, params);
    }

    async fulfillClientIntent(params: {
        branchId: string;
        clientId: number;
        includePast: boolean;
        suppressGreeting: boolean;
    }): Promise<boolean> {
        return fulfillClientMessageAutomationIntent({
            prisma: this.prisma,
            triggerService: this.triggerService,
            ...params,
        });
    }

    async fulfillScheduleIntent(params: {
        branchId: string;
        scheduleId: number;
        includePast: boolean;
        replaceExisting?: boolean;
        intentAt?: Date;
    }): Promise<boolean> {
        const dedupeKey = getScheduleAutomationIntentDedupeKey(params.branchId, params.scheduleId);
        const claim = await this.claimIntent(dedupeKey, params.intentAt);
        if (!claim) return false;

        try {
            if (!(await this.isBranchApproved(params.branchId))) {
                await this.releaseIntent(claim);
                return false;
            }
            await this.triggerService.syncEmployeeAssignmentRulesForSchedule(
                params.branchId,
                params.scheduleId,
                params.includePast,
                { preserveExisting: params.replaceExisting !== true },
            );
            if (!(await this.isBranchApproved(params.branchId))) {
                await this.releaseIntent(claim);
                return false;
            }
            await this.serviceRecordLinkService.scheduleForServiceStart(params.scheduleId);
            return this.deleteClaimedIntent(claim);
        } catch (error) {
            await this.releaseAfterFailure(claim, error);
            throw error;
        }
    }

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async reconcilePendingIntents(referenceDate = new Date()): Promise<number> {
        const candidates = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                OR: [
                    { nextAttemptAt: null },
                    { nextAttemptAt: { lte: referenceDate } },
                ],
            },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                employeeScheduleId: true,
                scheduledFor: true,
                updatedAt: true,
                payload: true,
            },
            orderBy: [
                { nextAttemptAt: "asc" },
                { updatedAt: "asc" },
            ],
            take: RECONCILIATION_BATCH_SIZE,
        });

        let fulfilled = 0;
        for (const candidate of candidates) {
            try {
                if (await this.fulfillCandidate(candidate)) fulfilled += 1;
            } catch (error) {
                this.logger.warn(
                    `[Message Automation Intent] Retry failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        return fulfilled;
    }

    private async claimIntent(
        dedupeKey: string,
        expectedIntentAt?: Date,
    ): Promise<ScheduleIntentClaim | null> {
        const expectedIntentFilter = expectedIntentAt
            ? Prisma.sql`AND scheduled_for = ${expectedIntentAt}`
            : Prisma.empty;
        const claimed = await this.prisma.$queryRaw<Array<{
            id: string;
            scheduled_for: Date | string;
            updated_at?: Date | string;
        }>>(Prisma.sql`
            UPDATE "message_trigger_job"
            SET next_attempt_at = clock_timestamp() + (${CLAIM_LEASE_MINUTES} * interval '1 minute'),
                updated_at = date_trunc('milliseconds', clock_timestamp())
            WHERE dedupe_key = ${dedupeKey}
              AND rule_id = ${MESSAGE_AUTOMATION_INTENT_RULE_ID}
              AND status = 'failed'
              AND cancel_reason = ${MESSAGE_AUTOMATION_INTENT_RETRY_REASON}
              AND canceled_by_user = false
              ${expectedIntentFilter}
              AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
            RETURNING id, scheduled_for, updated_at;
        `);
        const row = claimed[0];
        if (!row) return null;

        const scheduledFor = toDate(row.scheduled_for);
        return {
            id: row.id,
            scheduledFor,
            updatedAt: row.updated_at ? toDate(row.updated_at) : scheduledFor,
        };
    }

    private async isBranchApproved(branchId: string): Promise<boolean> {
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { smsSenderApprovalStatus: true },
        });
        return branch?.smsSenderApprovalStatus === "approved";
    }

    private async releaseIntent(claim: ScheduleIntentClaim): Promise<void> {
        await this.prisma.message_trigger_job.updateMany({
            where: {
                id: claim.id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                scheduledFor: claim.scheduledFor,
                updatedAt: claim.updatedAt,
            },
            data: {
                nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
            },
        });
    }

    private async releaseAfterFailure(
        claim: ScheduleIntentClaim,
        originalError: unknown,
    ): Promise<void> {
        try {
            await this.releaseIntent(claim);
        } catch (releaseError) {
            this.logger.error(
                `[Message Automation Intent] Failed to release claim ${claim.id} after ${String(originalError)}: ${String(releaseError)}`,
            );
        }
    }

    private async deleteClaimedIntent(claim: ScheduleIntentClaim): Promise<boolean> {
        const deleted = await this.prisma.message_trigger_job.deleteMany({
            where: {
                id: claim.id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                scheduledFor: claim.scheduledFor,
                updatedAt: claim.updatedAt,
            },
        });
        return deleted.count === 1;
    }

    private async fulfillCandidate(candidate: IntentCandidate): Promise<boolean> {
        const expectedVersion = {
            scheduledFor: candidate.scheduledFor,
            updatedAt: candidate.updatedAt,
        };
        if (!candidate.branchId) {
            await this.discardOrphanedIntent(candidate.id, expectedVersion);
            return false;
        }
        const variables = this.readTemplateVariables(candidate.payload);
        const kind = variables["intentKind"];
        const includePast = variables["includePast"] === "true";
        const replaceExisting = variables["replaceExisting"] === "true";
        if (kind === "client" && candidate.clientId !== null) {
            return this.fulfillClientIntent({
                branchId: candidate.branchId,
                clientId: candidate.clientId,
                includePast,
                suppressGreeting: variables["suppressGreeting"] === "true",
            });
        }
        if (kind === "schedule" && candidate.employeeScheduleId !== null) {
            return this.fulfillScheduleIntent({
                branchId: candidate.branchId,
                scheduleId: candidate.employeeScheduleId,
                includePast,
                replaceExisting,
                intentAt: candidate.scheduledFor,
            });
        }
        if (
            (kind === "client" && candidate.clientId === null)
            || (kind === "schedule" && candidate.employeeScheduleId === null)
        ) {
            await this.discardOrphanedIntent(candidate.id, expectedVersion);
            return false;
        }
        await this.quarantineInvalidIntent(candidate.id, expectedVersion);
        return false;
    }

    private async discardOrphanedIntent(
        id: string,
        expectedVersion: Pick<ScheduleIntentClaim, "scheduledFor" | "updatedAt">,
    ): Promise<void> {
        await this.prisma.message_trigger_job.deleteMany({
            where: {
                id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                scheduledFor: expectedVersion.scheduledFor,
                updatedAt: expectedVersion.updatedAt,
            },
        });
    }

    private async quarantineInvalidIntent(
        id: string,
        expectedVersion: Pick<ScheduleIntentClaim, "scheduledFor" | "updatedAt">,
    ): Promise<void> {
        await this.prisma.message_trigger_job.updateMany({
            where: {
                id,
                ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                canceledByUser: false,
                scheduledFor: expectedVersion.scheduledFor,
                updatedAt: expectedVersion.updatedAt,
            },
            data: {
                cancelReason: MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
                nextAttemptAt: null,
            },
        });
        this.logger.error(`[Message Automation Intent] Quarantined malformed intent ${id}`);
    }

    private readTemplateVariables(payload: Prisma.JsonValue): Record<string, string> {
        if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
        const variables = payload["templateVariables"];
        if (!variables || Array.isArray(variables) || typeof variables !== "object") return {};
        return Object.fromEntries(
            Object.entries(variables).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
        );
    }
}
