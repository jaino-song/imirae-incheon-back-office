/** Normalized eformsign response exposed below the infrastructure boundary. */
export interface EformsignApiDocumentResponse {
    id: string;
    document_number: string;
    template: {
        id: string;
        name: string;
    };
    document_name: string;
    creator: {
        recipient_type: string;
        id: string;
        name: string;
    };
    last_editor?: {
        recipient_type?: string;
        id?: string;
        name?: string;
    };
    created_date: number; // epoch ms
    updated_date: number; // epoch ms
    current_status: {
        status_type: string;
        status_doc_type?: string; // detail responses only
        status_doc_detail?: string; // detail responses only
        step_type: string;
        step_index: string;
        step_name: string;
        step_recipients: Array<{
            recipient_type: string;
            id: string;
            name: string;
            sms?: string;
        }>;
        step_group: number;
        expired_date?: number; // remaining days; 0 means no expiry; detail responses only
        _expired?: boolean; // detail responses only
    };
    fields?: Array<{
        id: string;
        value: string;
        type: string;
    }>;
    detail_template_info?: unknown;
    histories?: unknown[];
    previous_status?: unknown[];
    recipients?: unknown[];
    next_status?: Array<{
        step_type: string;
        step_name?: string;
        step_recipients?: Array<{
            recipient_type?: string;
            id?: string;
            name?: string;
        }>;
        status_type?: string;
        step_group?: number;
        step_index?: string;
        step_seq?: string;
    }>;
}

export interface EformsignApiListResponse {
    documents: EformsignApiDocumentResponse[];
    total_rows: number;
}

export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
    api_key?: {
        company: {
            api_url: string;
        };
    };
}

/** A workflow step's pre-specified recipient (from the template's step settings). */
export interface EformsignReviewerMember {
    name: string;
    id: string; // eformsign member email
    phoneNumber?: string;
}

export interface CreateDocumentPayload {
    templateId: string;
    /** Stable action identity used by the provider to deduplicate a retried dispatch. */
    idempotencyKey?: string;
    /**
     * Omit for templates whose `title_change` is false — they generate the title from their
     * own pattern and reject an explicit name with 4000010. The generated title comes back
     * on CreateDocumentResponse.
     */
    documentName?: string;
    prefillFields: Array<{ id: string; value: string }>;
    /**
     * Participant recipient (contract flow: the step-2 participant receives by SMS).
     * Phone only — `client` carries no email, and eformsign accepts a member without one.
     */
    recipient?: {
        name: string;
        sms: string;
    };
    /**
     * Dispatch to a reviewer step whose recipient is pre-specified in the template
     * (service record flow). The member info must MIRROR the template's step settings exactly —
     * eformsign rejects mismatches with 4000012 — so obtain it via getTemplateReviewer().
     */
    reviewer?: EformsignReviewerMember;
}

export interface CreateDocumentResponse {
    documentId: string;
    status: string;
    /** Title eformsign assigned, present when the template generated it. */
    documentName?: string;
}

/**
 * Repository interface for calling eformsign external API
 * (NOT for local DB persistence — use IEformsignDocRepository for that)
 */
export interface IEformsignClientRepository {
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse>;
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse>;
    getInProgressDocuments(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiDocumentResponse[]>;
    getInProgressDocumentsPage(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiListResponse>;
    getCompletedDocuments(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiDocumentResponse[]>;
    getCompletedDocumentsPage(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiListResponse>;
    getRejectedDocuments(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiDocumentResponse[]>;
    getRejectedDocumentsPage(
        accessToken: string,
        limit?: number,
        skip?: number,
    ): Promise<EformsignApiListResponse>;
    getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]>;
    /** Narrow remote lookup used to reconcile an ambiguous document-creation attempt. */
    findDocumentsByTitle?(
        accessToken: string,
        title: string,
    ): Promise<EformsignApiDocumentResponse[]>;
    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse>;
    createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse>;
    /** Pre-specified recipient of the template's reviewer step, or null if the template has none. */
    getTemplateReviewer(accessToken: string, templateId: string): Promise<EformsignReviewerMember | null>;
}

export const EFORMSIGN_CLIENT_REPOSITORY = "EFORMSIGN_CLIENT_REPOSITORY";
