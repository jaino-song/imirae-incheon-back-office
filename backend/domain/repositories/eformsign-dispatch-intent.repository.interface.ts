import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchAction,
    EformsignDispatchIntentEntity,
    EformsignDispatchIntentStatus,
} from "domain/entities/eformsign-dispatch-intent.entity";

export interface PrepareEformsignDispatchIntentInput {
    branchId: string;
    clientId?: number | null;
    localDocumentId?: number | null;
    assignmentId?: number | null;
    providerDocumentId?: string | null;
    templateId?: string | null;
    action: EformsignDispatchAction;
    generation: string;
    businessKey: string;
    fingerprint: string;
}

export interface ReconcileEformsignDispatchIntentInput {
    branchId: string;
    intentId: string;
    outcome: "delivered" | "not_delivered";
    actorUserId: string;
    reason: string;
    providerDocumentId?: string | null;
}

export interface IEformsignDispatchIntentRepository {
    prepare(input: PrepareEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity>;
    claim(
        intentId: string,
        branchId: string,
    ): Promise<{ intent: EformsignDispatchIntentEntity; claimed: boolean } | null>;
    markAccepted(
        intentId: string,
        branchId: string,
        providerDocumentId: string,
        providerReceipt?: unknown,
    ): Promise<EformsignDispatchIntentEntity | null>;
    markUncertain(
        intentId: string,
        branchId: string,
        reason: string,
        providerDocumentId?: string | null,
    ): Promise<EformsignDispatchIntentEntity | null>;
    releaseBeforeSend(
        intentId: string,
        branchId: string,
        reason: string,
    ): Promise<EformsignDispatchIntentEntity | null>;
    reconcile(input: ReconcileEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity | null>;
    findById(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null>;
}

export const EFORMSIGN_DISPATCH_INTENT_REPOSITORY = "EFORMSIGN_DISPATCH_INTENT_REPOSITORY";

export function isDispatchIntentTerminal(status: EformsignDispatchIntentStatus): boolean {
    return status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
        || status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED;
}
