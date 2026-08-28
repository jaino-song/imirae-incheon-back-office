export const EFORMSIGN_DISPATCH_INTENT_STATUS = {
    PREPARED: "prepared",
    STARTED: "started",
    UNCERTAIN: "uncertain",
    ACCEPTED: "accepted",
    RECONCILED_NOT_DELIVERED: "reconciled_not_delivered",
    RECONCILED_DELIVERED: "reconciled_delivered",
} as const;

export type EformsignDispatchIntentStatus =
    (typeof EFORMSIGN_DISPATCH_INTENT_STATUS)[keyof typeof EFORMSIGN_DISPATCH_INTENT_STATUS];

export type EformsignDispatchAction = "create" | "finalize";

const EFORMSIGN_DISPATCH_ACTIONS: ReadonlySet<string> = new Set(["create", "finalize"]);
const EFORMSIGN_DISPATCH_INTENT_STATUSES: ReadonlySet<string> = new Set(
    Object.values(EFORMSIGN_DISPATCH_INTENT_STATUS),
);
const EFORMSIGN_DISPATCH_RECONCILIATION_OUTCOMES: ReadonlySet<string> = new Set([
    "delivered",
    "not_delivered",
]);

export interface EformsignDispatchIntentProps {
    id: string;
    branchId: string;
    clientId: number | null;
    localDocumentId: number | null;
    assignmentId: number | null;
    providerDocumentId: string | null;
    templateId: string | null;
    action: EformsignDispatchAction;
    generation: string;
    businessKey: string;
    fingerprint: string;
    status: EformsignDispatchIntentStatus;
    attemptCount: number;
    startedAt: Date | null;
    providerAcceptedAt: Date | null;
    uncertainAt: Date | null;
    uncertainReason: string | null;
    providerReceipt: unknown | null;
    reconciledAt: Date | null;
    reconciledOutcome: "delivered" | "not_delivered" | null;
    reconciledByUserId: string | null;
    reconciliationReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export class EformsignDispatchIntentEntity implements EformsignDispatchIntentProps {
    readonly id!: string;
    readonly branchId!: string;
    readonly clientId!: number | null;
    readonly localDocumentId!: number | null;
    readonly assignmentId!: number | null;
    readonly providerDocumentId!: string | null;
    readonly templateId!: string | null;
    readonly action!: EformsignDispatchAction;
    readonly generation!: string;
    readonly businessKey!: string;
    readonly fingerprint!: string;
    readonly status!: EformsignDispatchIntentStatus;
    readonly attemptCount!: number;
    readonly startedAt!: Date | null;
    readonly providerAcceptedAt!: Date | null;
    readonly uncertainAt!: Date | null;
    readonly uncertainReason!: string | null;
    readonly providerReceipt!: unknown | null;
    readonly reconciledAt!: Date | null;
    readonly reconciledOutcome!: "delivered" | "not_delivered" | null;
    readonly reconciledByUserId!: string | null;
    readonly reconciliationReason!: string | null;
    readonly createdAt!: Date;
    readonly updatedAt!: Date;

    constructor(props: EformsignDispatchIntentProps) {
        if (!props.id?.trim()) throw new Error("EformsignDispatchIntentEntity: id is required");
        if (!props.branchId?.trim()) throw new Error("EformsignDispatchIntentEntity: branchId is required");
        if (!props.generation?.trim()) throw new Error("EformsignDispatchIntentEntity: generation is required");
        if (!props.businessKey?.trim()) throw new Error("EformsignDispatchIntentEntity: businessKey is required");
        if (!props.fingerprint?.trim()) throw new Error("EformsignDispatchIntentEntity: fingerprint is required");
        if (!EFORMSIGN_DISPATCH_ACTIONS.has(props.action)) {
            throw new Error("EformsignDispatchIntentEntity: action is invalid");
        }
        if (!EFORMSIGN_DISPATCH_INTENT_STATUSES.has(props.status)) {
            throw new Error("EformsignDispatchIntentEntity: status is invalid");
        }
        if (!Number.isInteger(props.attemptCount) || props.attemptCount < 0) {
            throw new Error("EformsignDispatchIntentEntity: attemptCount must be a non-negative integer");
        }
        if (
            props.reconciledOutcome !== null
            && !EFORMSIGN_DISPATCH_RECONCILIATION_OUTCOMES.has(props.reconciledOutcome)
        ) {
            throw new Error("EformsignDispatchIntentEntity: reconciledOutcome is invalid");
        }
        if (
            props.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            && props.reconciledOutcome !== "delivered"
        ) {
            throw new Error("EformsignDispatchIntentEntity: delivered reconciliation is inconsistent");
        }
        if (
            props.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED
            && props.reconciledOutcome !== "not_delivered"
        ) {
            throw new Error("EformsignDispatchIntentEntity: non-delivery reconciliation is inconsistent");
        }
        if (
            props.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
            && !props.providerDocumentId?.trim()
        ) {
            throw new Error("EformsignDispatchIntentEntity: accepted intent requires providerDocumentId");
        }
        Object.assign(this, props);
    }
}
