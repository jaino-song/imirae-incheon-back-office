import { Prisma } from "@prisma/client";

import {
    MessageLogEntity,
    MessageLogStatus,
    SmsProviderAcceptanceState,
} from "domain/entities/message-log.entity";

type MessageLogRow = {
    id: number;
    branchId: string | null;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    recipientName: string | null;
    recipientPhone: string | null;
    messageBody: string;
    variables: Prisma.JsonValue;
    status: string;
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    providerAcceptanceKey?: string | null;
    providerAcceptanceFingerprint?: string | null;
    providerAcceptanceState?: string | null;
    providerCallStartedAt?: Date | null;
    providerAcceptedAt?: Date | null;
    providerReconciledAt?: Date | null;
    providerReconciledBy?: string | null;
    providerReconciliationReason?: string | null;
};

export class MessageLogMapper {
    static toDomain(row: MessageLogRow): MessageLogEntity {
        return MessageLogEntity.reconstitute(
            row.id,
            row.branchId,
            row.provider,
            row.templateKey,
            row.triggerJobId,
            row.receiver,
            row.clientId,
            row.messageBody,
            (row.variables as Record<string, string>) ?? {},
            row.status as MessageLogStatus,
            row.aligoMid,
            row.errorMessage,
            row.attempts,
            row.lastAttemptAt,
            row.nextRetryAt,
            row.createdAt,
            row.updatedAt,
            row.recipientName,
            row.recipientPhone,
            row.providerAcceptanceKey ?? null,
            row.providerAcceptanceFingerprint ?? null,
            (row.providerAcceptanceState as SmsProviderAcceptanceState | undefined) ?? "legacy",
            row.providerCallStartedAt ?? null,
            row.providerAcceptedAt ?? null,
            row.providerReconciledAt ?? null,
            row.providerReconciledBy ?? null,
            row.providerReconciliationReason ?? null,
        );
    }

    static toPrismaCreate(entity: MessageLogEntity) {
        return {
            branchId: entity.branchId,
            provider: entity.provider,
            templateKey: entity.templateKey,
            triggerJobId: entity.triggerJobId,
            receiver: entity.receiver,
            clientId: entity.clientId,
            recipientName: entity.recipientName,
            recipientPhone: entity.recipientPhone,
            messageBody: entity.messageBody,
            variables: entity.variables as Prisma.InputJsonValue,
            status: entity.status,
            aligoMid: entity.aligoMid,
            errorMessage: entity.errorMessage,
            attempts: entity.attempts,
            lastAttemptAt: entity.lastAttemptAt,
            nextRetryAt: entity.nextRetryAt,
            providerAcceptanceKey: entity.providerAcceptanceKey,
            providerAcceptanceFingerprint: entity.providerAcceptanceFingerprint,
            providerAcceptanceState: entity.providerAcceptanceState,
            providerCallStartedAt: entity.providerCallStartedAt,
            providerAcceptedAt: entity.providerAcceptedAt,
            providerReconciledAt: entity.providerReconciledAt,
            providerReconciledBy: entity.providerReconciledBy,
            providerReconciliationReason: entity.providerReconciliationReason,
        };
    }

    static toPrismaUpdate(entity: MessageLogEntity) {
        return {
            status: entity.status,
            aligoMid: entity.aligoMid,
            errorMessage: entity.errorMessage,
            attempts: entity.attempts,
            lastAttemptAt: entity.lastAttemptAt,
            nextRetryAt: entity.nextRetryAt,
            recipientName: entity.recipientName,
            recipientPhone: entity.recipientPhone,
            providerAcceptanceFingerprint: entity.providerAcceptanceFingerprint,
            providerAcceptanceState: entity.providerAcceptanceState,
            providerCallStartedAt: entity.providerCallStartedAt,
            providerAcceptedAt: entity.providerAcceptedAt,
            providerReconciledAt: entity.providerReconciledAt,
            providerReconciledBy: entity.providerReconciledBy,
            providerReconciliationReason: entity.providerReconciliationReason,
        };
    }
}
