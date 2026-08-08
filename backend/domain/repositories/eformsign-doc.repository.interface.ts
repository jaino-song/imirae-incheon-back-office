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
    sourceUpdatedDate?: Date;
    documentName?: string;
    templateName?: string;
}

export type EformsignDocCompletionClaimResult = "claimed" | "duplicate" | "missing" | "stale";

export interface EformsignDocConditionalUpdateResult {
    document: EformsignDocEntity;
    applied: boolean;
}

export interface UpsertUnassignedEformsignDocOptions {
    allowAssignedUpdate?: boolean;
    updateListDisplayFields?: boolean;
    /**
     * Atomically withdraw a completed list projection before detail/PDF mirroring starts.
     * The mirror service republishes it only after both required PDFs reach ready.
     */
    markMirrorPending?: boolean;
    updateExpired?: boolean;
    /**
     * The list endpoint carries no status detail, so a caller working from it only has a
     * value derived from the step name. Set false there: a new row still needs something,
     * but overwriting a stored detail — "만료", "거부" — with the derived one loses it.
     */
    updateStatusDetail?: boolean;
    /**
     * Same reasoning as `updateStatusDetail`: the list endpoint carries no `expired_date`,
     * so a caller working from it only has a fallback guess. Set false there rather than
     * overwriting a real stored expiry with it.
     */
    updateExpiredDate?: boolean;
    /**
     * Creation time is the list's sort key, and rows written by the create and adopt paths
     * carry the moment we wrote them rather than the moment eformsign created the
     * document — a contract adopted today sorts as today's. Reconciling from a response
     * that actually carries `created_date` repairs that; a caller that had to invent one
     * sets this false rather than replacing a stored value with its own guess.
     */
    updateCreatedDate?: boolean;
}

export interface UpsertEformsignDocByDocumentIdOptions {
    /**
     * Adoption may assign branch/client ownership to a row whose detail/PDF
     * generation is already ready. Keep that existing vendor projection intact
     * until the mirror service has fetched and fenced the replacement generation.
     * A newly inserted row still receives the complete projection and starts pending.
     */
    preserveExistingMirrorProjection?: boolean;
}

/**
 * A maternity contract sitting at the provider-review stage (070), with the
 * auto-finalize bookkeeping the nightly scheduler and the dashboard both read.
 * `contractEndDate` is parsed from the mirrored detail payload (YYYY-MM-DD) and
 * null when the stored detail carries no recoverable end date.
 */
export interface ReviewStageContract {
    documentId: string;
    branchId: string | null;
    customerName: string | null;
    contractEndDate: string | null;
    autoFinalizeAttempts: number;
    autoFinalizeLastAttemptAt: Date | null;
    autoFinalizeLastError: string | null;
}

export interface IEformsignDocRepository {
    findById(branchid: string, id: number): Promise<EformsignDocEntity | null>;
    findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null>;
    /** Ownership-only lookup used to retry an already pending permanent purge. */
    findByDocumentIdIncludingPurgePending(
        branchid: string,
        documentId: string,
    ): Promise<EformsignDocEntity | null>;
    findByDocumentIdUnscoped(documentId: string): Promise<EformsignDocUnscopedResult | null>;
    findBranchIdByDocumentId(documentId: string): Promise<string | null>;
    claimCompletionStatus(
        branchid: string,
        params: EformsignDocCompletionClaimParams,
    ): Promise<EformsignDocCompletionClaimResult>;
    findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]>;
    findAll(branchid: string): Promise<EformsignDocEntity[]>;
    /**
     * Rows safe to expose through the local-only mirror list. Completed documents stay
     * hidden until their detail and required PDFs reach the ready generation.
     */
    findAllVisibleInMirror(branchid: string): Promise<EformsignDocEntity[]>;
    /**
     * Every document the headquarters list may show: ours plus the ones no branch has
     * claimed. Deliberately not "all rows minus other branches" done in memory — that is
     * the same rule, but expressed where the database can apply it.
     */
    findAllForHeadquarters(branchid: string): Promise<EformsignDocEntity[]>;
    /**
     * Headquarters equivalent of `findAllVisibleInMirror`, including unclaimed rows but
     * applying the same completed-ready publication gate.
     */
    findAllVisibleInMirrorForHeadquarters(branchid: string): Promise<EformsignDocEntity[]>;
    findDocumentIdsForOtherBranches(branchid: string): Promise<string[]>;
    findDisplayFieldsByDocumentIds(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]>;
    findClientNamesByBranch(branchid: string): Promise<EformsignDocClientSummary[]>;
    /**
     * Contract end dates (YYYY-MM-DD) parsed from the mirrored detail payloads of the
     * given documents. Documents without a stored detail or a recoverable end date are
     * simply absent from the map.
     */
    findContractEndDatesByDocumentIds(documentIds: string[]): Promise<Map<string, string>>;
    /** All provider-review-stage (070) contracts, unscoped — the nightly auto-finalize pool and the dashboard card share this. */
    findReviewStageContracts(): Promise<ReviewStageContract[]>;
    /**
     * Records one failed auto-finalize attempt and returns the new attempt count,
     * so the caller can tell exactly when the retry budget was exhausted.
     */
    recordAutoFinalizeFailure(documentId: string, error: string): Promise<number>;
    create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    update(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<EformsignDocEntity>;
    /** Atomically applies a vendor projection only when its generation is strictly newer. */
    updateIfSourceNewer(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<EformsignDocConditionalUpdateResult>;
    /**
     * Atomically assigns the live document to the client and updates the client's
     * contract pointer. Returns false when the document was purged/deleted or the
     * client disappeared before the transaction obtained the document row lock.
     */
    linkClientIfActive(
        branchid: string,
        documentId: string,
        clientId: number,
    ): Promise<boolean>;
    upsertByDocumentId(
        branchid: string,
        doc: EformsignDocEntity,
        options?: UpsertEformsignDocByDocumentIdOptions,
    ): Promise<EformsignDocEntity>;
    upsertUnassignedByDocumentId(
        doc: EformsignDocEntity,
        options?: UpsertUnassignedEformsignDocOptions,
    ): Promise<EformsignDocEntity>;
    delete(branchid: string, id: number): Promise<void>;
    deleteByDocumentId(branchid: string, documentId: string): Promise<void>;
}

export const EFORMSIGN_DOC_REPOSITORY = "EFORMSIGN_DOC_REPOSITORY";
