import {
    EformsignDocumentJobEntity,
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
    EformsignDocumentJobType,
} from "domain/entities/eformsign-document-job.entity";

export interface EnqueueEformsignDocumentJobInput {
    branchId: string;
    clientId?: number | null;
    documentId?: string | null;
    jobType: EformsignDocumentJobType;
    source: EformsignDocumentJobSource;
    requestKey: string;
    activeKey: string;
    payload: EformsignDocumentJobPayload;
    payloadFingerprint: string;
    createdByUserId?: string | null;
}

export interface EformsignDocumentJobSummary {
    activeCount: number;
    requiresAttentionCount: number;
}

export interface EformsignDocumentJobList {
    active: EformsignDocumentJobEntity[];
    requiresAttention: EformsignDocumentJobEntity[];
    recent: EformsignDocumentJobEntity[];
}

export interface IEformsignDocumentJobRepository {
    enqueue(input: EnqueueEformsignDocumentJobInput): Promise<{ job: EformsignDocumentJobEntity; existing: boolean }>;
    claimDue(limit?: number): Promise<EformsignDocumentJobEntity[]>;
    updateProgress(id: string, leaseToken: string, progressStep: string, heartbeatAt?: Date): Promise<EformsignDocumentJobEntity | null>;
    scheduleRetry(id: string, leaseToken: string, nextAttemptAt: Date, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    markReconciling(id: string, leaseToken: string, progressStep?: string): Promise<EformsignDocumentJobEntity | null>;
    markCompleted(id: string, leaseToken: string, documentId?: string): Promise<EformsignDocumentJobEntity | null>;
    markFailed(id: string, leaseToken: string, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    markRequiresAttention(id: string, leaseToken: string, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    recoverStale(cutoff: Date): Promise<EformsignDocumentJobEntity[]>;
    getSummary(branchId: string): Promise<EformsignDocumentJobSummary>;
    listForBranch(branchId: string, terminalSince: Date, terminalLimit?: number): Promise<EformsignDocumentJobList>;
    deleteExpiredTerminal(cutoff: Date): Promise<number>;
}

export const EFORMSIGN_DOCUMENT_JOB_REPOSITORY = "EFORMSIGN_DOCUMENT_JOB_REPOSITORY";
