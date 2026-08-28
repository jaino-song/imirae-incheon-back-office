import { Prisma } from "@prisma/client";
import {
    getClientAutomationIntentDedupeKey,
    getEmployeeAutomationIntentDedupeKey,
    getScheduleAutomationIntentDedupeKey,
    EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
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
    clientId: number | null;
    employeeId?: number;
    employeeScheduleId: number | null;
    recipientType: MessageTriggerRecipientType;
    templateKey: MessageTriggerTemplateKey;
    dedupeKey: string;
    kind: MessageAutomationIntentKind;
    includePast: boolean;
    suppressGreeting: boolean;
    intentAt: Date;
    replaceExisting: boolean;
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
        replaceExisting: false,
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
        replaceExisting?: boolean;
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
        replaceExisting: params.replaceExisting ?? false,
    });
}

export async function persistEmployeeProfileRefreshMessageAutomationIntent(
    transaction: Prisma.TransactionClient,
    params: {
        branchId: string;
        employeeId: number;
        intentAt: Date;
    },
): Promise<void> {
    await persistMessageAutomationIntent(transaction, {
        branchId: params.branchId,
        clientId: null,
        employeeId: params.employeeId,
        employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        dedupeKey: getEmployeeAutomationIntentDedupeKey(params.branchId, params.employeeId),
        kind: "employee",
        includePast: true,
        suppressGreeting: false,
        intentAt: params.intentAt,
        replaceExisting: false,
    });
}

async function persistMessageAutomationIntent(
    transaction: Prisma.TransactionClient,
    params: PersistIntentParams,
): Promise<void> {
    if (params.replaceExisting && params.employeeScheduleId !== null) {
        await transaction.message_trigger_job.updateMany({
            where: {
                branchId: params.branchId,
                employeeScheduleId: params.employeeScheduleId,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
                status: "pending",
                canceledByUser: false,
            },
            data: {
                status: "canceled",
                canceledAt: params.intentAt,
                cancelReason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
                nextAttemptAt: null,
            },
        });
    }

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
        ...(params.clientId === null ? {} : { clientId: params.clientId }),
        ...(params.employeeId === undefined ? {} : { employeeId: params.employeeId }),
        memberId: `${params.kind}:${params.employeeId ?? params.clientId}`,
        recipientName: "메시지 자동화 복구",
        recipientPhone: "",
        templateVariables: {
            intentKind: params.kind,
            includePast: String(params.includePast),
            suppressGreeting: String(params.suppressGreeting),
            replaceExisting: String(params.replaceExisting),
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
