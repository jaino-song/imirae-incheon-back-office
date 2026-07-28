/**
 * Raw API response types from eformsign API
 */
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
    created_date: number; // epoch ms
    updated_date: number; // epoch ms
    current_status: {
        status_type: string;
        status_doc_type: string;
        status_doc_detail: string;
        step_type: string;
        step_index: string;
        step_name: string;
        step_recipients: Array<{
            recipient_type: string;
            id: string;
            name: string;
        }>;
        step_group: number;
        expired_date: number; // epoch ms
        _expired: boolean;
    };
    fields?: Array<{
        id: string;
        value: string;
        type: string;
    }>;
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
    total_count: number;
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
    documentName: string;
    prefillFields: Array<{ id: string; value: string }>;
    /** Legacy participant recipient (contract flow: step 2 participant receives by SMS). */
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
}

/**
 * Repository interface for calling eformsign external API
 * (NOT for local DB persistence — use IEformsignDocRepository for that)
 */
export interface IEformsignClientRepository {
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse>;
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse>;
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
