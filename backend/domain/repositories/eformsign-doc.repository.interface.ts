import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

export interface EformsignDocClientSummary {
    documentId: string;
    clientId: number | null;
    clientName: string;
    clientPhone: string | null;
    providerName: string | null;
}

export interface EformsignDocDisplayFields {
    documentId: string;
    customerName: string | null;
}

export interface EformsignDocUnscopedResult {
    document: EformsignDocEntity;
    branchId: string | null;
}

export class EformsignDocMappingError extends Error {
    readonly originalError: unknown;

    constructor(documentId: string, originalError: unknown) {
        super(`Failed to map eformsign document ${documentId}`);
        this.name = EformsignDocMappingError.name;
        this.originalError = originalError;
    }
}

export class EformsignDocOwnershipConflictError extends Error {
    constructor(documentId: string) {
        super(`Eformsign document ${documentId} belongs to another branch`);
        this.name = EformsignDocOwnershipConflictError.name;
    }
}

/**
 * The row is still ours to write, but it already holds state at least as new as the
 * event we were given. Distinct from an ownership conflict because the caller must do
 * nothing at all here — retrying as branch-owned would apply a stale event.
 */
export class EformsignDocStaleUpdateError extends Error {
    constructor(documentId: string) {
        super(`Eformsign document ${documentId} already holds newer state`);
        this.name = EformsignDocStaleUpdateError.name;
    }
}

export interface EformsignDocCompletionClaimParams {
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    expired: boolean;
    documentName?: string;
    templateName?: string;
}

export type EformsignDocCompletionClaimResult = "claimed" | "duplicate" | "missing";

export interface UpsertUnassignedEformsignDocOptions {
    allowAssignedUpdate?: boolean;
    updateListDisplayFields?: boolean;
    updateExpired?: boolean;
}

export interface IEformsignDocRepository {
    findById(branchid: string, id: number): Promise<EformsignDocEntity | null>;
    findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null>;
    findByDocumentIdUnscoped(documentId: string): Promise<EformsignDocUnscopedResult | null>;
    findBranchIdByDocumentId(documentId: string): Promise<string | null>;
    claimCompletionStatus(
        branchid: string,
        params: EformsignDocCompletionClaimParams,
    ): Promise<EformsignDocCompletionClaimResult>;
    findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]>;
    findAll(branchid: string): Promise<EformsignDocEntity[]>;
    findDocumentIdsForOtherBranches(branchid: string): Promise<string[]>;
    findDisplayFieldsByDocumentIds(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]>;
    findClientNamesByBranch(branchid: string): Promise<EformsignDocClientSummary[]>;
    create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    update(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    upsertByDocumentId(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    upsertUnassignedByDocumentId(
        doc: EformsignDocEntity,
        options?: UpsertUnassignedEformsignDocOptions,
    ): Promise<EformsignDocEntity>;
    delete(branchid: string, id: number): Promise<void>;
    deleteByDocumentId(branchid: string, documentId: string): Promise<void>;
}

export const EFORMSIGN_DOC_REPOSITORY = "EFORMSIGN_DOC_REPOSITORY";
