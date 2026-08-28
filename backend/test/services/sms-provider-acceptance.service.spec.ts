import { ConflictException } from "@nestjs/common";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
    SmsProviderAcceptanceService,
} from "application/services/sms-provider-acceptance.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("SmsProviderAcceptanceService", () => {
    const branchId = "11111111-1111-1111-1111-111111111111";
    const createAttempt = (state: "prepared" | "started" | "uncertain" = "prepared") =>
        MessageLogEntity.reconstitute(
            42,
            branchId,
            "aligo_sms",
            "manual_sms",
            null,
            "01012345678",
            null,
            "테스트 메시지",
            { retrySafety: state === "uncertain" ? "uncertain" : "pending" },
            state === "uncertain" ? "failed" : "pending",
            null,
            state === "uncertain" ? "provider response unavailable" : null,
            state === "uncertain" ? 1 : 0,
            null,
            null,
            new Date("2026-08-29T00:00:00.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
            "수신자",
            "01012345678",
            buildSmsProviderAcceptanceKey("manual", "request-42"),
            buildSmsProviderAcceptanceFingerprint({
                branchId,
                receiver: "01012345678",
                message: "테스트 메시지",
            }),
            state,
            state === "prepared" ? null : new Date("2026-08-29T00:00:01.000Z"),
        );

    it("creates opaque deterministic acceptance identities without exposing SMS secrets", () => {
        const key = buildSmsProviderAcceptanceKey("manual", "request-42");
        const fingerprint = buildSmsProviderAcceptanceFingerprint({
            receiver: "01012345678",
            message: "수신자에게 보낼 비밀 본문",
        });

        expect(key).toMatch(/^sms:[a-f0-9]{64}$/);
        expect(key).not.toContain("request-42");
        expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(fingerprint).not.toContain("01012345678");
        expect(fingerprint).not.toContain("비밀");
        expect(buildSmsProviderAcceptanceKey("manual", "request-42")).toBe(key);
    });

    it("requires a prepared row before a provider call can be started", async () => {
        const attempt = createAttempt();
        const repository = {
            prepareProviderAttempt: jest.fn().mockResolvedValue(attempt),
            claimProviderAttempt: jest.fn().mockResolvedValue(null),
        };
        const service = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );

        await expect(service.beginProviderCall(attempt)).rejects.toThrow(ConflictException);
        expect(repository.claimProviderAttempt).toHaveBeenCalledTimes(1);

        attempt.providerAcceptanceState = "started";
        await expect(service.beginProviderCall(attempt)).rejects.toThrow(ConflictException);
    });

    it("converges duplicate preparation on the repository-owned attempt", async () => {
        const attempt = createAttempt();
        const existing = createAttempt("started");
        const repository = {
            prepareProviderAttempt: jest.fn().mockResolvedValue(existing),
        };
        const service = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );

        const result = await service.prepare(attempt);

        expect(result).toBe(existing);
        expect(repository.prepareProviderAttempt).toHaveBeenCalledWith(attempt);
    });

    it("records a provider receipt only after the immutable started transition", () => {
        const attempt = createAttempt();
        const startedAt = new Date("2026-08-29T00:00:01.000Z");
        const acceptedAt = new Date("2026-08-29T00:00:02.000Z");

        attempt.markProviderCallStarted(startedAt);
        attempt.recordProviderResult({
            accepted: true,
            providerMessageId: "provider-42",
            now: acceptedAt,
        });

        expect(attempt.providerAcceptanceState).toBe("accepted");
        expect(attempt.providerCallStartedAt).toBe(startedAt);
        expect(attempt.providerAcceptedAt).toBe(acceptedAt);
        expect(attempt.aligoMid).toBe("provider-42");
        expect(attempt.attempts).toBe(1);
        expect(() => attempt.markProviderCallStarted()).toThrow();
    });

    it("allows one reconciliation, then makes the outcome immutable", async () => {
        const attempt = createAttempt("uncertain");
        const repository = {
            findByIdInBranch: jest.fn().mockResolvedValue(attempt),
            reconcileProviderAttempt: jest
                .fn()
                .mockImplementation(async (row: MessageLogEntity, outcome: "delivered" | "not-delivered", actor: string, reason: string, providerMessageId?: string) => {
                    row.reconcileProviderOutcome({ outcome, actor, reason, providerMessageId });
                    return row;
                }),
        };
        const service = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );

        const reconciled = await service.reconcile({
            branchId,
            logId: attempt.id,
            outcome: "not-delivered",
            actor: "operator-1",
            reason: "provider history confirms no delivery",
        });

        expect(reconciled.providerAcceptanceState).toBe("reconciled_not_delivered");
        expect(reconciled.status).toBe("failed");
        expect(reconciled.nextRetryAt).toBeInstanceOf(Date);
        expect(reconciled.variables["retrySafety"]).toBe("reconciled-not-delivered");

        repository.findByIdInBranch.mockResolvedValue(reconciled);
        await expect(
            service.reconcile({
                branchId,
                logId: attempt.id,
                outcome: "delivered",
                actor: "operator-2",
                reason: "conflicting operator decision",
            }),
        ).rejects.toThrow("immutable");
        expect(repository.reconcileProviderAttempt).toHaveBeenCalledTimes(1);
    });

    it("marks a delivered reconciliation as terminal and allows an idempotent repeat", async () => {
        const attempt = createAttempt("started");
        const repository = {
            findByIdInBranch: jest.fn().mockResolvedValue(attempt),
            reconcileProviderAttempt: jest
                .fn()
                .mockImplementation(async (row: MessageLogEntity, outcome: "delivered" | "not-delivered", actor: string, reason: string, providerMessageId?: string) => {
                    row.reconcileProviderOutcome({ outcome, actor, reason, providerMessageId });
                    return row;
                }),
        };
        const service = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );

        const first = await service.reconcile({
            branchId,
            logId: attempt.id,
            outcome: "delivered",
            actor: "operator-1",
            reason: "provider receipt 123 confirmed delivery",
            providerMessageId: "123",
        });
        const second = await service.reconcile({
            branchId,
            logId: attempt.id,
            outcome: "delivered",
            actor: "operator-2",
            reason: "repeated lookup",
            providerMessageId: "123",
        });

        expect(first).toBe(second);
        expect(second.providerAcceptanceState).toBe("reconciled_delivered");
        expect(second.status).toBe("sent");
        expect(second.nextRetryAt).toBeNull();
        expect(second.variables["retrySafety"]).toBe("delivered");
        expect(repository.reconcileProviderAttempt).toHaveBeenCalledTimes(1);
    });

    it("rejects reconciliation for rows that never crossed the provider boundary", async () => {
        const attempt = createAttempt("prepared");
        const repository = {
            findByIdInBranch: jest.fn().mockResolvedValue(attempt),
        };
        const service = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );

        await expect(
            service.reconcile({
                branchId,
                logId: attempt.id,
                outcome: "not-delivered",
                actor: "operator-1",
                reason: "not sent",
            }),
        ).rejects.toThrow(ConflictException);
    });
});
