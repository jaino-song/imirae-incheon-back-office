import { createHash } from "node:crypto";

import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";

import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchIntentEntity,
} from "domain/entities/eformsign-dispatch-intent.entity";
import {
    EFORMSIGN_DISPATCH_INTENT_REPOSITORY,
    IEformsignDispatchIntentRepository,
    PrepareEformsignDispatchIntentInput,
    ReconcileEformsignDispatchIntentInput,
    isDispatchIntentTerminal,
} from "domain/repositories/eformsign-dispatch-intent.repository.interface";

export interface DispatchIntentClaimInput extends Omit<PrepareEformsignDispatchIntentInput, "businessKey"> {
    businessKey?: string;
}

export type DispatchIntentClaim = {
    intent: EformsignDispatchIntentEntity;
    disposition: "claimed" | "already_accepted" | "uncertain";
};

const normalizeIdentityPart = (value: string | number | null | undefined): string =>
    value === null || value === undefined ? "-" : String(value).trim() || "-";

/**
 * Shared durable boundary for every provider-changing eformsign path.
 *
 * The provider is not assumed to offer exactly-once delivery. A claim is
 * persisted before credentials are read or a provider request is attempted;
 * started/uncertain claims therefore remain non-replayable until an operator
 * explicitly records authoritative non-delivery.
 */
@Injectable()
export class EformsignDispatchBoundaryService {
    constructor(
        @Inject(EFORMSIGN_DISPATCH_INTENT_REPOSITORY)
        private readonly repository: IEformsignDispatchIntentRepository,
    ) {}

    async claim(input: DispatchIntentClaimInput): Promise<DispatchIntentClaim> {
        const prepared = await this.repository.prepare({
            ...input,
            businessKey: input.businessKey ?? buildEformsignDispatchBusinessKey(input),
        });

        if (prepared.fingerprint !== input.fingerprint) {
            throw new ConflictException("전자문서 작업 요청이 기존 작업과 충돌합니다.");
        }

        if (isDispatchIntentTerminal(prepared.status)) {
            return { intent: prepared, disposition: "already_accepted" };
        }
        if (
            prepared.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
            || prepared.status === EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
        ) {
            return { intent: prepared, disposition: "uncertain" };
        }

        const claimedResult = await this.repository.claim(prepared.id, prepared.branchId);
        if (!claimedResult) {
            throw new ConflictException("전자문서 작업을 시작할 수 없습니다.");
        }
        const claimed = claimedResult.intent;
        if (isDispatchIntentTerminal(claimed.status)) {
            return { intent: claimed, disposition: "already_accepted" };
        }
        if (!claimedResult.claimed) {
            return { intent: claimed, disposition: "uncertain" };
        }
        if (
            claimed.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
            || claimed.status === EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
        ) {
            return { intent: claimed, disposition: "claimed" };
        }
        return { intent: claimed, disposition: "uncertain" };
    }

    async markAccepted(
        intent: EformsignDispatchIntentEntity,
        providerDocumentId: string,
        providerReceipt?: unknown,
    ): Promise<EformsignDispatchIntentEntity | null> {
        return this.repository.markAccepted(
            intent.id,
            intent.branchId,
            intent.attemptCount,
            providerDocumentId,
            providerReceipt,
        );
    }

    async markUncertain(
        intent: EformsignDispatchIntentEntity,
        reason: string,
        providerDocumentId?: string | null,
    ): Promise<EformsignDispatchIntentEntity | null> {
        return this.repository.markUncertain(
            intent.id,
            intent.branchId,
            intent.attemptCount,
            reason,
            providerDocumentId,
        );
    }

    async releaseBeforeSend(
        intent: EformsignDispatchIntentEntity,
        reason: string,
    ): Promise<EformsignDispatchIntentEntity | null> {
        return this.repository.releaseBeforeSend(
            intent.id,
            intent.branchId,
            intent.attemptCount,
            reason,
        );
    }

    async reconcile(input: ReconcileEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity> {
        const branchId = input.branchId?.trim();
        const intentId = input.intentId?.trim();
        const actorUserId = input.actorUserId?.trim();
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (!branchId || !intentId || !actorUserId || !reason) {
            throw new ForbiddenException("전자문서 작업을 확인할 권한이 없습니다.");
        }
        const result = await this.repository.reconcile({
            ...input,
            branchId,
            intentId,
            actorUserId,
            reason: reason.slice(0, 500),
            providerDocumentId: input.providerDocumentId?.trim() || undefined,
        });
        if (!result) {
            throw new ForbiddenException("전자문서 작업을 확인할 권한이 없습니다.");
        }
        return result;
    }

    async findById(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null> {
        return this.repository.findById(branchId, intentId);
    }
}

export function buildEformsignDispatchBusinessKey(
    input: Pick<DispatchIntentClaimInput, "branchId" | "clientId" | "localDocumentId" | "assignmentId" | "templateId" | "action" | "generation">,
): string {
    const identity = [
        normalizeIdentityPart(input.branchId),
        normalizeIdentityPart(input.clientId),
        normalizeIdentityPart(input.localDocumentId),
        normalizeIdentityPart(input.assignmentId),
        normalizeIdentityPart(input.templateId),
        normalizeIdentityPart(input.action),
        normalizeIdentityPart(input.generation),
    ].join("|");
    return createHash("sha256").update(identity).digest("hex");
}
