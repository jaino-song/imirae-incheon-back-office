import { Prisma } from "@prisma/client";
import {
    getClientAutomationIntentDedupeKey,
    getScheduleAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
    MessageAutomationIntentKind,
} from "domain/constants/message-automation-intent";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

interface PersistIntentParams {
    branchId: string;
    clientId: number;
    employeeScheduleId: number | null;
    recipientType: MessageTriggerRecipientType;
    templateKey: MessageTriggerTemplateKey;
    dedupeKey: string;
    kind: MessageAutomationIntentKind;
    includePast: boolean;
    suppressGreeting: boolean;
    intentAt: Date;
}

export async function persistClientMessageAutomationIntent(
    transaction: Prisma.TransactionClient,
    params: {
        branchId: string;
        clientId: number;
        includePast: boolean;
        suppressGreeting: boolean;
        intentAt: Date;
    },
): Promise<void> {
    await persistMessageAutomationIntent(transaction, {
        ...params,
        employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        dedupeKey: getClientAutomationIntentDedupeKey(params.branchId, params.clientId),
        kind: "client",
    });
}

export async function persistScheduleMessageAutomationIntent(
    transaction: Prisma.TransactionClient,
    params: {
        branchId: string;
        clientId: number;
        scheduleId: number;
        includePast: boolean;
        intentAt: Date;
    },
): Promise<void> {
    await persistMessageAutomationIntent(transaction, {
        branchId: params.branchId,
        clientId: params.clientId,
        employeeScheduleId: params.scheduleId,
        recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        dedupeKey: getScheduleAutomationIntentDedupeKey(params.branchId, params.scheduleId),
        kind: "schedule",
        includePast: params.includePast,
        suppressGreeting: false,
        intentAt: params.intentAt,
    });
}

async function persistMessageAutomationIntent(
    transaction: Prisma.TransactionClient,
    params: PersistIntentParams,
): Promise<void> {
    await transaction.message_trigger_rule.upsert({
        where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID },
        create: {
            id: MESSAGE_AUTOMATION_INTENT_RULE_ID,
            branchId: null,
            name: "메시지 자동화 생성 복구 표식",
            isActive: false,
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            isDefault: false,
            jobsStale: false,
        },
        update: {},
    });
    const payload = {
        clientId: params.clientId,
        memberId: `${params.kind}:${params.clientId}`,
        recipientName: "메시지 자동화 복구",
        recipientPhone: "",
        templateVariables: {
            intentKind: params.kind,
            includePast: String(params.includePast),
            suppressGreeting: String(params.suppressGreeting),
        },
    } satisfies Prisma.InputJsonObject;
    await transaction.message_trigger_job.upsert({
        where: { dedupeKey: params.dedupeKey },
        create: {
            branchId: params.branchId,
            ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
            status: "failed",
            scheduledFor: params.intentAt,
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
            clientId: params.clientId,
            employeeScheduleId: params.employeeScheduleId,
            recipientType: params.recipientType,
            recipientPhone: null,
            templateKey: params.templateKey,
            dedupeKey: params.dedupeKey,
            payload,
            attempts: 0,
            nextAttemptAt: params.intentAt,
        },
        update: {
            status: "failed",
            scheduledFor: params.intentAt,
            sentAt: null,
            canceledAt: null,
            cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
            canceledByUser: false,
            clientId: params.clientId,
            employeeScheduleId: params.employeeScheduleId,
            recipientType: params.recipientType,
            recipientPhone: null,
            templateKey: params.templateKey,
            payload,
            attempts: 0,
            nextAttemptAt: params.intentAt,
        },
    });
}
