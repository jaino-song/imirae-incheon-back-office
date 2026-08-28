import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchIntentEntity,
    type EformsignDispatchAction,
    type EformsignDispatchIntentStatus,
} from "domain/entities/eformsign-dispatch-intent.entity";
import {
    type IEformsignDispatchIntentRepository,
    type PrepareEformsignDispatchIntentInput,
    type ReconcileEformsignDispatchIntentInput,
} from "domain/repositories/eformsign-dispatch-intent.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type IntentRow = Prisma.eformsign_dispatch_intentGetPayload<Record<string, never>>;

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const sameNullable = <T>(left: T | null | undefined, right: T | null | undefined): boolean =>
    (left ?? null) === (right ?? null);

@Injectable()
export class SbEformsignDispatchIntentRepository implements IEformsignDispatchIntentRepository {
    constructor(private readonly prisma: PrismaService) {}

    async prepare(input: PrepareEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity> {
        const existing = await this.prisma.eformsign_dispatch_intent.findUnique({
            where: { businessKey: input.businessKey },
        });
        if (existing) {
            return this.assertIdentity(existing, input);
        }

        try {
            const created = await this.prisma.eformsign_dispatch_intent.create({
                data: {
                    branchId: input.branchId,
                    clientId: input.clientId ?? null,
                    localDocumentId: input.localDocumentId ?? null,
                    assignmentId: input.assignmentId ?? null,
                    providerDocumentId: input.providerDocumentId ?? null,
                    templateId: input.templateId ?? null,
                    action: input.action,
                    generation: input.generation,
                    businessKey: input.businessKey,
                    fingerprint: input.fingerprint,
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED,
                },
            });
            return this.toDomain(created);
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            const concurrent = await this.prisma.eformsign_dispatch_intent.findUnique({
                where: { businessKey: input.businessKey },
            });
            if (!concurrent) throw error;
            return this.assertIdentity(concurrent, input);
        }
    }

    async claim(
        intentId: string,
        branchId: string,
    ): Promise<{ intent: EformsignDispatchIntentEntity; claimed: boolean } | null> {
        const current = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        if (!current) return null;

        const nextAttemptCount = current.attemptCount + 1;
        const claimed = await this.prisma.eformsign_dispatch_intent.updateMany({
            where: {
                id: intentId,
                branchId,
                attemptCount: current.attemptCount,
                status: {
                    in: [
                        EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED,
                        EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED,
                    ],
                },
            },
            data: {
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                attemptCount: { increment: 1 },
                startedAt: new Date(),
                uncertainAt: null,
                uncertainReason: null,
                reconciledAt: null,
                reconciledOutcome: null,
                reconciledByUserId: null,
                reconciliationReason: null,
            },
        });
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        const claimedByThisAttempt = claimed.count === 1
            && row?.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
            && row.attemptCount === nextAttemptCount;
        return row ? { intent: this.toDomain(row), claimed: claimedByThisAttempt } : null;
    }

    async markAccepted(
        intentId: string,
        branchId: string,
        attemptCount: number,
        providerDocumentId: string,
        providerReceipt?: unknown,
    ): Promise<EformsignDispatchIntentEntity | null> {
        const normalizedProviderDocumentId = providerDocumentId.trim();
        if (!normalizedProviderDocumentId) {
            throw new ConflictException("전자문서 provider id가 필요합니다.");
        }

        const current = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        if (!current) return null;
        if (
            current.providerDocumentId
            && current.providerDocumentId !== normalizedProviderDocumentId
        ) {
            throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
        }
        if (
            current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
            && current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
        ) {
            // An accepted/reconciled row is terminal and must not be overwritten by
            // a late response from another attempt. Prepared/non-delivery rows are
            // similarly owned by the next claim.
            return this.toDomain(current);
        }
        if (current.attemptCount !== attemptCount) {
            return this.toDomain(current);
        }

        const updated = await this.prisma.eformsign_dispatch_intent.updateMany({
            where: {
                id: intentId,
                branchId,
                attemptCount,
                status: {
                    in: [
                        EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                        EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                    ],
                },
            },
            data: {
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED,
                providerDocumentId: normalizedProviderDocumentId,
                providerAcceptedAt: new Date(),
                uncertainAt: null,
                uncertainReason: null,
                ...(providerReceipt === undefined
                    ? {}
                    : { providerReceipt: providerReceipt as Prisma.InputJsonValue }),
            },
        });
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        if (!row) return null;
        if (updated.count === 0 && row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED) {
            if (row.providerDocumentId && row.providerDocumentId !== normalizedProviderDocumentId) {
                throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
            }
        }
        return this.toDomain(row);
    }

    async markUncertain(
        intentId: string,
        branchId: string,
        attemptCount: number,
        reason: string,
        providerDocumentId?: string | null,
    ): Promise<EformsignDispatchIntentEntity | null> {
        const current = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        if (!current) return null;
        if (
            providerDocumentId
            && current.providerDocumentId
            && providerDocumentId.trim() !== current.providerDocumentId
        ) {
            throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
        }
        if (current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED) {
            return this.toDomain(current);
        }
        if (current.attemptCount !== attemptCount) {
            return this.toDomain(current);
        }

        const updated = await this.prisma.eformsign_dispatch_intent.updateMany({
            where: {
                id: intentId,
                branchId,
                attemptCount,
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
            },
            data: {
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                uncertainAt: new Date(),
                uncertainReason: reason.trim().slice(0, 500),
                ...(providerDocumentId?.trim() ? { providerDocumentId: providerDocumentId.trim() } : {}),
            },
        });
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        return row ? this.toDomain(row) : updated.count > 0 ? null : this.toDomain(current);
    }

    async releaseBeforeSend(
        intentId: string,
        branchId: string,
        attemptCount: number,
        reason: string,
    ): Promise<EformsignDispatchIntentEntity | null> {
        const current = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        if (!current) return null;
        if (current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED) {
            return this.toDomain(current);
        }
        if (current.attemptCount !== attemptCount) {
            return this.toDomain(current);
        }

        await this.prisma.eformsign_dispatch_intent.updateMany({
            where: {
                id: intentId,
                branchId,
                attemptCount,
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
            },
            data: {
                status: EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED,
                uncertainReason: `pre_send:${reason.trim()}`.slice(0, 500),
                startedAt: null,
            },
        });
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        return row ? this.toDomain(row) : null;
    }

    async reconcile(input: ReconcileEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity | null> {
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: input.intentId, branchId: input.branchId },
        });
        if (!row) return null;

        if (
            input.providerDocumentId
            && row.providerDocumentId
            && input.providerDocumentId.trim() !== row.providerDocumentId
        ) {
            throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
        }

        if (
            input.outcome === "not_delivered"
            && (
                row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                || row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            )
        ) {
            throw new ConflictException("이미 전달된 전자문서는 미전달로 변경할 수 없습니다.");
        }

        // A STARTED intent still owns an in-flight provider attempt. Marking it
        // not-delivered here would release the durable claim while the provider
        // request can still succeed, allowing a retry to create a duplicate.
        // Callers must first persist UNCERTAIN (after the provider attempt has
        // ended) or release the claim before asking an operator to reconcile it.
        if (
            input.outcome === "not_delivered"
            && row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
        ) {
            throw new ConflictException("진행 중인 전자문서는 미전달로 변경할 수 없습니다.");
        }

        if (
            (input.outcome === "delivered" && row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED)
            || (
                input.outcome === "not_delivered"
                && row.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED
            )
        ) {
            return this.toDomain(row);
        }

        const nextStatus = input.outcome === "delivered"
            ? EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            : EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED;
        // A create intent may carry a remote id discovered during an uncertain
        // attempt. Once an operator confirms non-delivery, that orphan id must
        // not fence the next create receipt. Finalize intents retain their
        // provider id because it is the document being finalized.
        const clearCreateReceipt = input.outcome === "not_delivered" && row.action === "create";
        const expectedAttemptCount = input.attemptCount ?? row.attemptCount;
        if (input.attemptCount !== undefined && input.attemptCount !== row.attemptCount) {
            throw new ConflictException("전자문서 작업 시도가 변경되어 확인 결과를 적용할 수 없습니다.");
        }
        const updated = await this.prisma.eformsign_dispatch_intent.updateMany({
            where: {
                id: row.id,
                branchId: input.branchId,
                attemptCount: expectedAttemptCount,
                ...(input.outcome === "not_delivered"
                    ? {
                        status: {
                            notIn: [
                                EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED,
                                EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                                EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED,
                            ],
                        },
                    }
                    : {}),
            },
            data: {
                status: nextStatus,
                reconciledAt: new Date(),
                reconciledOutcome: input.outcome,
                reconciledByUserId: input.actorUserId,
                reconciliationReason: input.reason.trim().slice(0, 500),
                ...(clearCreateReceipt
                    ? { providerDocumentId: null }
                    : input.providerDocumentId?.trim()
                    ? { providerDocumentId: input.providerDocumentId.trim() }
                    : {}),
            },
        });
        if (updated.count === 0) {
            const current = await this.prisma.eformsign_dispatch_intent.findFirst({
                where: { id: row.id, branchId: input.branchId },
            });
            if (current && current.attemptCount !== expectedAttemptCount) {
                throw new ConflictException("전자문서 작업 시도가 변경되어 확인 결과를 적용할 수 없습니다.");
            }
            if (
                input.outcome === "not_delivered"
                && current
                && (
                    current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                    || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                    || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
                )
            ) {
                throw new ConflictException(
                    current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                        ? "진행 중인 전자문서는 미전달로 변경할 수 없습니다."
                        : "이미 전달된 전자문서는 미전달로 변경할 수 없습니다.",
                );
            }
            return current ? this.toDomain(current) : null;
        }
        const current = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: row.id, branchId: input.branchId },
        });
        return current ? this.toDomain(current) : null;
    }

    async findById(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null> {
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        return row ? this.toDomain(row) : null;
    }

    private assertIdentity(
        row: IntentRow,
        input: PrepareEformsignDispatchIntentInput,
    ): EformsignDispatchIntentEntity {
        if (
            row.branchId !== input.branchId
            || row.action !== input.action
            || row.generation !== input.generation
            || row.fingerprint !== input.fingerprint
            || !sameNullable(row.clientId, input.clientId)
            || !sameNullable(row.localDocumentId, input.localDocumentId)
            || !sameNullable(row.assignmentId, input.assignmentId)
            || !sameNullable(row.templateId, input.templateId)
            || (
                Boolean(input.providerDocumentId)
                && Boolean(row.providerDocumentId)
                && row.providerDocumentId !== input.providerDocumentId
            )
        ) {
            throw new ConflictException("전자문서 작업 요청이 기존 작업과 충돌합니다.");
        }
        return this.toDomain(row);
    }

    private toDomain(row: IntentRow): EformsignDispatchIntentEntity {
        return new EformsignDispatchIntentEntity({
            id: row.id,
            branchId: row.branchId,
            clientId: row.clientId,
            localDocumentId: row.localDocumentId,
            assignmentId: row.assignmentId,
            providerDocumentId: row.providerDocumentId,
            templateId: row.templateId,
            action: row.action as EformsignDispatchAction,
            generation: row.generation,
            businessKey: row.businessKey,
            fingerprint: row.fingerprint,
            status: row.status as EformsignDispatchIntentStatus,
            attemptCount: row.attemptCount,
            startedAt: row.startedAt,
            providerAcceptedAt: row.providerAcceptedAt,
            uncertainAt: row.uncertainAt,
            uncertainReason: row.uncertainReason,
            providerReceipt: row.providerReceipt,
            reconciledAt: row.reconciledAt,
            reconciledOutcome:
                row.reconciledOutcome === "delivered" || row.reconciledOutcome === "not_delivered"
                    ? row.reconciledOutcome
                    : null,
            reconciledByUserId: row.reconciledByUserId,
            reconciliationReason: row.reconciliationReason,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }
}
