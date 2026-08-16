export const EFORMSIGN_DOCUMENT_JOB_TYPES = ["create_document", "finalize_document"] as const;
export const EFORMSIGN_DOCUMENT_JOB_SOURCES = ["staff", "auto_finalize"] as const;
export const EFORMSIGN_DOCUMENT_JOB_STATUSES = [
    "queued",
    "processing",
    "reconciling",
    "completed",
    "failed",
    "requires_attention",
] as const;

export type EformsignDocumentJobType = (typeof EFORMSIGN_DOCUMENT_JOB_TYPES)[number];
export type EformsignDocumentJobSource = (typeof EFORMSIGN_DOCUMENT_JOB_SOURCES)[number];
export type EformsignDocumentJobStatus = (typeof EFORMSIGN_DOCUMENT_JOB_STATUSES)[number];
export type EformsignDocumentJobPayload = Record<string, unknown>;

export interface EformsignDocumentJobProps {
    id: string;
    branchId: string;
    clientId: number | null;
    documentId: string | null;
    jobType: EformsignDocumentJobType;
    source: EformsignDocumentJobSource;
    status: EformsignDocumentJobStatus;
    requestKey: string;
    activeKey: string | null;
    payload: EformsignDocumentJobPayload | null;
    payloadFingerprint: string | null;
    progressStep: string | null;
    attempts: number;
    nextAttemptAt: Date;
    heartbeatAt: Date | null;
    leaseToken: string | null;
    autoFinalizeOutcomeRecordedAt: Date | null;
    autoFinalizeOutcomeAttempts: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    lastErrorCode: string | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export class EformsignDocumentJobEntity implements EformsignDocumentJobProps {
    constructor(props: EformsignDocumentJobProps) {
        Object.assign(this, props);
    }

    declare readonly id: string;
    declare readonly branchId: string;
    declare readonly clientId: number | null;
    declare readonly documentId: string | null;
    declare readonly jobType: EformsignDocumentJobType;
    declare readonly source: EformsignDocumentJobSource;
    declare readonly status: EformsignDocumentJobStatus;
    declare readonly requestKey: string;
    declare readonly activeKey: string | null;
    declare readonly payload: EformsignDocumentJobPayload | null;
    declare readonly payloadFingerprint: string | null;
    declare readonly progressStep: string | null;
    declare readonly attempts: number;
    declare readonly nextAttemptAt: Date;
    declare readonly heartbeatAt: Date | null;
    declare readonly leaseToken: string | null;
    declare readonly autoFinalizeOutcomeRecordedAt: Date | null;
    declare readonly autoFinalizeOutcomeAttempts: number | null;
    declare readonly startedAt: Date | null;
    declare readonly completedAt: Date | null;
    declare readonly lastErrorCode: string | null;
    declare readonly createdByUserId: string | null;
    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}
