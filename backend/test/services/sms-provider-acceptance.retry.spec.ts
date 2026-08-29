import { ConflictException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import {
    SmsProviderAcceptanceService,
} from "application/services/sms-provider-acceptance.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("SMS provider acceptance and retry boundary", () => {
    const branchId = "11111111-1111-1111-1111-111111111111";
    const createSource = () =>
        MessageLogEntity.reconstitute(
            77,
            branchId,
            "aligo_sms",
            "client_greeting_sms",
            "job-77",
            "01012345678",
            7,
            "안녕하세요",
            {
                senderPhone: "0212345678",
                recipientName: "고객",
                title: "인사 메시지",
                msgType: "AUTO",
                retrySafety: "uncertain",
            },
            "failed",
            null,
            "provider response unavailable",
            1,
            new Date("2026-08-29T00:00:00.000Z"),
            new Date("2026-08-29T00:00:01.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
            "고객",
            "01012345678",
            "sms:source-attempt",
            "source-fingerprint",
            "uncertain",
            new Date("2026-08-29T00:00:00.000Z"),
        );

    const createRepository = (source: MessageLogEntity) => {
        const repository = {
            findByIdInBranch: jest.fn().mockResolvedValue(source),
            update: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
            reconcileProviderAttempt: jest.fn().mockImplementation(async (
                log: MessageLogEntity,
                outcome: "delivered" | "not-delivered",
                actor: string,
                reason: string,
                providerMessageId?: string | null,
            ) => {
                log.reconcileProviderOutcome({ outcome, actor, reason, providerMessageId });
                return log;
            }),
            claimProviderAttempt: jest.fn().mockImplementation(async (log: MessageLogEntity) => {
                if (!log.canStartProviderCall()) return null;
                log.markProviderCallStarted(new Date("2026-08-29T00:01:00.000Z"));
                return log;
            }),
            startRetryAttempt: jest.fn().mockImplementation(async (
                _sourceLog: MessageLogEntity,
                draft: MessageLogEntity,
            ) =>
                MessageLogEntity.reconstitute(
                    78,
                    draft.branchId,
                    draft.provider,
                    draft.templateKey,
                    draft.triggerJobId,
                    draft.receiver,
                    draft.clientId,
                    draft.messageBody,
                    draft.variables,
                    draft.status,
                    draft.aligoMid,
                    draft.errorMessage,
                    draft.attempts,
                    draft.lastAttemptAt,
                    draft.nextRetryAt,
                    draft.createdAt,
                    draft.updatedAt,
                    draft.recipientName,
                    draft.recipientPhone,
                    draft.providerAcceptanceKey,
                    draft.providerAcceptanceFingerprint,
                    draft.providerAcceptanceState,
                    draft.providerCallStartedAt,
                    draft.providerAcceptedAt,
                    draft.providerReconciledAt,
                    draft.providerReconciledBy,
                    draft.providerReconciliationReason,
                ),
            ),
        };
        return repository;
    };

    const createProvider = () => ({
        sendSms: jest.fn().mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        }),
    });

    it("requires authoritative non-delivery before one retry and never retries the uncertain source", async () => {
        const source = createSource();
        const repository = createRepository(source);
        const acceptance = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );
        const provider = createProvider();
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );

        await acceptance.reconcile({
            branchId,
            logId: source.id,
            outcome: "not-delivered",
            actor: "operator-1",
            reason: "provider history confirms no delivery",
        });
        expect(source.providerAcceptanceState).toBe("reconciled_not_delivered");

        const retry = await retryService.retryById(branchId, source.id);

        expect(retry).toEqual(expect.objectContaining({
            id: 78,
            providerAcceptanceState: "accepted",
            status: "sent",
        }));
        expect(provider.sendSms).toHaveBeenCalledTimes(1);
        expect(repository.startRetryAttempt).toHaveBeenCalledTimes(1);
        expect(source.providerAcceptanceState).toBe("reconciled_not_delivered");
    });

    it("blocks retry after authoritative delivery reconciliation", async () => {
        const source = createSource();
        const repository = createRepository(source);
        const acceptance = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );
        const provider = createProvider();
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );

        await acceptance.reconcile({
            branchId,
            logId: source.id,
            outcome: "delivered",
            actor: "operator-1",
            reason: "provider receipt confirms delivery",
            providerMessageId: "provider-123",
        });

        await expect(retryService.retryById(branchId, source.id)).rejects.toThrow(ConflictException);
        expect(source.providerAcceptanceState).toBe("reconciled_delivered");
        expect(source.status).toBe("sent");
        expect(provider.sendSms).not.toHaveBeenCalled();
        expect(repository.startRetryAttempt).not.toHaveBeenCalled();
    });
});
