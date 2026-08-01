import { api } from "@/lib/api/client";
import { PUBLIC_BACKEND_BASE_URL } from "@/lib/env";
import {
    CreateEformsignDocRecordRequest,
    EformsignApiListResponse,
    EformsignAuthStatusResponse,
    EformsignDeleteDocumentsResponse,
    EformsignDocClientSummary,
    EformsignDocumentsResponse,
    EformsignReRequestDocumentRequest,
    FinalizeHeadlessResponse,
    HeadlessDispatchResponse,
} from "@babyjamjam/shared/types/eformsign";
import type {
    MessageSenderApprovalResponse,
    MessageSenderApprovalStatus,
} from "@babyjamjam/shared/types/message";
import type { RegisterRequest } from "@babyjamjam/shared";
import { safeStorageSetItem } from "@/lib/safe-storage";
import { isAxiosError } from "axios";

export interface ContractDataDto {
  customerName: string;
  customerContact: string;
  customerDOB: string;
  customerAddress: string;
  caretaker1Name: string;
  caretaker1Contact: string;
  type: string;
  days: string;
  area: string;
  contractDuration: string;
  startYear: string;
  startMonth: string;
  startDay: string;
  startDate: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  endDate: string;
  paymentYear: string;
  paymentMonth: string;
  paymentDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

export interface ServiceRecordTemplateIdResponse {
    templateId: string | null;
    templateIds?: string[];
}

const HEADLESS_DISPATCH_TIMEOUT_MS = 180_000;
const HEADLESS_FINALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_EFORMSIGN_LIMIT = 100;
const DEFAULT_EFORMSIGN_SKIP = 0;
const MAX_EFORMSIGN_AUTH_5XX_ATTEMPTS = 3;
const EFORMSIGN_AUTH_5XX_BACKOFF_MS = 30_000;
// Review finding: a permanent stop stranded read-only document views for the
// tab lifetime (only contract write actions force-reset). The stop is now a
// cooldown so background auth resumes on its own once the vendor recovers.
const EFORMSIGN_AUTH_STOP_COOLDOWN_MS = 5 * 60_000;

let consecutiveEformsignAuthServerFailures = 0;
let automaticEformsignAuthStoppedUntil = 0;
let nextAutomaticEformsignAuthAttemptAt = 0;

export class EformsignAuthAutoRetryStoppedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EformsignAuthAutoRetryStoppedError";
    }
}

function isServerErrorStatus(status?: number): status is number {
    return typeof status === "number" && status >= 500 && status < 600;
}

function resetEformsignAuthFailureState(): void {
    consecutiveEformsignAuthServerFailures = 0;
    automaticEformsignAuthStoppedUntil = 0;
    nextAutomaticEformsignAuthAttemptAt = 0;
}

function assertAutomaticEformsignAuthAllowed(force = false): void {
    if (force) {
        return;
    }

    const now = Date.now();

    if (now < automaticEformsignAuthStoppedUntil) {
        throw new EformsignAuthAutoRetryStoppedError(
            "Eformsign authentication auto-retries are paused after repeated server errors.",
        );
    }

    if (now < nextAutomaticEformsignAuthAttemptAt) {
        throw new EformsignAuthAutoRetryStoppedError(
            "Eformsign authentication is backing off after a recent server error.",
        );
    }
}

function recordEformsignAuthFailure(error: unknown): void {
    if (!isAxiosError(error) || !isServerErrorStatus(error.response?.status)) {
        return;
    }

    consecutiveEformsignAuthServerFailures += 1;
    nextAutomaticEformsignAuthAttemptAt = Date.now() + EFORMSIGN_AUTH_5XX_BACKOFF_MS;

    if (consecutiveEformsignAuthServerFailures >= MAX_EFORMSIGN_AUTH_5XX_ATTEMPTS) {
        // Pause (not permanently stop) automatic attempts; a later failure
        // after the cooldown re-arms the pause, a success clears everything.
        automaticEformsignAuthStoppedUntil = Date.now() + EFORMSIGN_AUTH_STOP_COOLDOWN_MS;
        consecutiveEformsignAuthServerFailures = MAX_EFORMSIGN_AUTH_5XX_ATTEMPTS - 1;
    }
}

function normalizeDocumentListResponse(
    response: EformsignApiListResponse,
    params?: { limit?: number; skip?: number },
): EformsignDocumentsResponse {
    return {
        documents: response.documents ?? [],
        total_rows: response.total_count ?? response.documents?.length ?? 0,
        limit: params?.limit ?? DEFAULT_EFORMSIGN_LIMIT,
        skip: params?.skip ?? DEFAULT_EFORMSIGN_SKIP,
    };
}

/**
 * Status buckets the backend document list endpoints accept as `statusCategory`.
 * Mirrors `DocumentStatusCategory` in backend/interface/controllers/eformsign.controller.ts.
 */
export type EformsignStatusCategoryParam =
    | "drafting"
    | "in-progress"
    | "completed"
    | "expired"
    | "unknown";

export type EformsignTemplateMatchParam = "include" | "exclude";

export interface GetAllDocumentsParams {
    limit?: number;
    skip?: number;
    templateId?: string;
    templateMatch?: EformsignTemplateMatchParam;
    /** Server-side status bucket filter, applied before the limit/skip slice. */
    statusCategory?: EformsignStatusCategoryParam;
    /** Server-side (chosung-aware) name/title search, applied before the slice. */
    search?: string;
    /** Drops deleted (047/049) documents before the slice. Sent as "true" only when enabled. */
    excludeDeleted?: boolean;
}

/** Raw status signal for one document, as returned by GET /eformsign/documents/status-counts. */
export interface EformsignStatusSignal {
    status_type: string | null;
    step_type: string | null;
    step_name: string | null;
    step_recipient_types: Array<string | null>;
    /** YYYY-MM-DD when known; splits the 서명 완료/검토 필요 counters. */
    contract_end_date?: string | null;
    /** Authoritative display status stamped by the backend at serve time. */
    display_status?: string | null;
}

export interface EformsignStatusCountsResponse {
    documents: EformsignStatusSignal[];
}

/**
 * Serializes document-list params for the Next.js proxy route.
 * Undefined/blank values are omitted so the backend keeps its own defaults, and
 * `excludeDeleted` is sent as the string the backend compares against ("true").
 */
function buildDocumentListParams(
    params?: GetAllDocumentsParams,
): Record<string, string | number> | undefined {
    if (!params) return undefined;

    const query: Record<string, string | number> = {};
    if (params.limit !== undefined) query.limit = params.limit;
    if (params.skip !== undefined) query.skip = params.skip;
    if (params.templateId) query.templateId = params.templateId;
    if (params.templateMatch) query.templateMatch = params.templateMatch;
    if (params.statusCategory) query.statusCategory = params.statusCategory;

    const search = params.search?.trim();
    if (search) query.search = search;
    if (params.excludeDeleted) query.excludeDeleted = "true";

    return query;
}

export interface AuthResponse {
    success: boolean;
    message?: string;
    code?: string;
    hasKakaoAccount?: boolean;
    errors?: string[];
}

export interface EformsignAuthRequestOptions {
    force?: boolean;
}

export interface LoginResponse extends AuthResponse {
    accessToken?: string;
    refreshToken?: string;
    user?: string;
}

// Auth API
export const authApi = {
    kakaoLogin: () => {
        // client=mobile tells the backend to return to the mobile domain (m.staff.*)
        // after the Kakao round-trip; it is carried through the OAuth `state` param.
        window.location.href = `${PUBLIC_BACKEND_BASE_URL}/auth/kakao?client=mobile`;
    },

    // Email authentication
    register: async (params: RegisterRequest): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/register', params);
        return data;
    },

    getBranches: async (): Promise<{ id: string; name: string }[]> => {
        const { data } = await api.get('/auth/branches/all');
        return data;
    },

    checkEmailExists: async (email: string): Promise<{ exists: boolean; linkable: boolean }> => {
        const { data } = await api.get('/auth/check-email', {
            params: { email },
        });
        return {
            exists: data?.exists === true,
            linkable: data?.linkable === true,
        };
    },

    login: async (email: string, password: string): Promise<LoginResponse> => {
        const { data } = await api.post('/auth/login', { email, password });
        return data;
    },

    verifyEmail: async (token: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/verify-email', { token });
        return data;
    },

    forgotPassword: async (email: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/forgot-password', { email });
        return data;
    },

    resetPassword: async (token: string, newPassword: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/reset-password', { token, newPassword });
        return data;
    },

    resendVerification: async (email: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/resend-verification', { email });
        return data;
    },

    linkPassword: async (password: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/link-password', { password });
        return data;
    },
};

// eformsign APIs
// Note: axios client baseURL is '/api', so paths here should NOT include '/api/' prefix
export const eformsignApi = {
    generateSignature: async (executionTime: number) => {
        const { data } = await api.post('/generate-signature', { executionTime });
        return data;
    },
    // Authenticates and stores token in httpOnly cookie (returns { success: true }).
    // After repeated upstream 5xx responses, background callers back off and then stop
    // retrying until a user-driven flow forces a fresh attempt.
    authenticate: async (
        executionTime: number,
        memberEmail?: string,
        options?: EformsignAuthRequestOptions,
    ): Promise<{ success: boolean }> => {
        assertAutomaticEformsignAuthAllowed(options?.force === true);

        try {
            const { data } = await api.post('/access-token', { executionTime, memberEmail });
            resetEformsignAuthFailureState();
            return data;
        } catch (error) {
            recordEformsignAuthFailure(error);
            throw error;
        }
    },
    getAuthStatus: async (): Promise<EformsignAuthStatusResponse> => {
        const { data } = await api.get('/eformsign/auth-status');
        return data;
    },
    refreshAccessToken: async (executionTime: number) => {
        const { data } = await api.post('/refresh-access-token', { executionTime });
        return data;
    },
    reRequestDocument: async (
        documentId: string,
        params: EformsignReRequestDocumentRequest
    ): Promise<{ status?: string; code?: string; message?: string }> => {
        const { data } = await api.post(`/eformsign/documents/${documentId}/re-request`, params);
        return data;
    },
    generateDocument: async (contractData: ContractDataDto, clientId: number) => {
        const { data } = await api.post('/generate-document', { contractData, clientId });
        return data;
    },
    // BJJ-90: backend-driven creation dispatch. Drives the eformsign iframe gate sequence
    // (mode:"01") via headless Chromium so staff don't see the iframe. Returns ok:false
    // with reason on any failure so the caller can fall back to the legacy iframe modal.
    dispatchHeadless: async (
        contractData: ContractDataDto,
        clientId: number,
        progressId?: string,
        force?: boolean,
    ): Promise<Omit<HeadlessDispatchResponse, "fallbackHint"> & { remoteDocumentId?: string; existingDocumentId?: string; fallbackHint?: "iframe" | "adopt" | "manual_check" | "adopt-or-manual" }> => {
        const { data } = await api.post('/eformsign-docs/dispatch-headless', {
            contractData,
            clientId,
            progressId,
            force,
        }, {
            timeout: HEADLESS_DISPATCH_TIMEOUT_MS,
        });
        return data;
    },
    adoptDocument: async (
        documentId: string,
        clientId?: number,
    ): Promise<{
        id?: number;
        documentId: string;
        warnings?: Array<"client_link_failed" | "mirror_sync_failed">;
    }> => {
        const { data } = await api.post('/eformsign-docs/adopt', { documentId, clientId });
        return data;
    },
    // Staff completion (mode:"02") — builds iframe options for the staff finalize step.
    generateStaffDocument: async (
        documentId: string,
        accessToken?: string,
        refreshToken?: string,
        prefillEndDate?: string,
    ) => {
        const { data } = await api.post('/generate-staff-document', {
            documentId,
            accessToken,
            refreshToken,
            prefillEndDate,
        });
        return data;
    },
    // BJJ-90: backend-driven finalize. Drives the mode:"02" iframe gate sequence
    // via headless Chromium. Falls back to iframe (generateStaffDocument) on ok:false.
    finalizeHeadless: async (
        documentId: string,
        prefillEndDate?: string,
        progressId?: string,
    ): Promise<FinalizeHeadlessResponse> => {
        const { data } = await api.post('/eformsign-docs/finalize-headless', {
            documentId,
            prefillEndDate,
            progressId,
        }, {
            timeout: HEADLESS_FINALIZE_TIMEOUT_MS,
        });
        return data;
    },
    // Create eformsign doc record to track document in local DB
    createDocRecord: async (params: CreateEformsignDocRecordRequest) => {
        const { data } = await api.post('/eformsign-docs', params);
        return data;
    },
    getDocumentClientNames: async (): Promise<EformsignDocClientSummary[]> => {
        const { data } = await api.get('/eformsign-docs/client-names');
        return data;
    },
    getServiceRecordTemplateId: async (): Promise<ServiceRecordTemplateIdResponse> => {
        const { data } = await api.get('/eformsign-docs/feedback-template-id');
        return data;
    },
    // Documents APIs - token is read from httpOnly cookie on server
    // Note: eformsign routes use /eformsign prefix to avoid conflict with file storage /documents
    // Unified endpoint - server applies filters BEFORE slicing, so limit/skip paginate
    // the filtered set (see backend eformsign.controller.ts document list handlers).
    getAllDocuments: async (params?: GetAllDocumentsParams): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents', {
            params: buildDocumentListParams(params),
        });
        return data;
    },
    // Raw per-document status signals with the same pre-slice filters as the list.
    // Used to fold filter-pill counts client-side without fetching full documents.
    getStatusCounts: async (
        params?: Pick<GetAllDocumentsParams, "templateId" | "templateMatch" | "search" | "excludeDeleted">,
    ): Promise<EformsignStatusCountsResponse> => {
        const { data } = await api.get('/eformsign/documents/status-counts', {
            params: buildDocumentListParams(params),
        });
        return data;
    },
    getDocument: async (documentId: string): Promise<EformsignDocumentsResponse["documents"][number]> => {
        const { data } = await api.get(`/eformsign/documents/${documentId}`);
        return data;
    },
    getDocumentDownloadUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document`,
    getDocumentReceiptDownloadUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document&page=7`,
    getDocumentPreviewUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document`,
    getInProgressDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/in-progress');
        return normalizeDocumentListResponse(data);
    },
    getCompletedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/completed');
        return normalizeDocumentListResponse(data);
    },
    getRejectedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/rejected');
        return normalizeDocumentListResponse(data);
    },
    // A delete cancels the document at eformsign and purges the local copy. There is no
    // permanence choice any more, so is_permanent is no longer sent.
    deleteDocuments: async (
        documentIds: string[]
    ): Promise<EformsignDeleteDocumentsResponse> => {
        const { data } = await api.delete('/eformsign/documents', {
            data: { document_ids: documentIds },
        });
        return data;
    },
    deleteDocument: async (
        documentId: string
    ): Promise<EformsignDeleteDocumentsResponse> => {
        return eformsignApi.deleteDocuments([documentId]);
    },
    // Legacy alias
    getDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents');
        return data;
    },
}

/**
 * Wraps an eformsign API call with automatic re-authentication on 401/403.
 * 
 * Flow:
 * 1. Execute the API call
 * 2. If it fails with 401/403 (after axios interceptor's token refresh also failed),
 *    attempt a full re-authentication from scratch
 * 3. Retry the original call once with the fresh token
 * 4. If re-auth or retry fails, throw the original error
 */
export async function withEformsignReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (!isAxiosError(error)) throw error;

        const status = error.response?.status;
        if (status === 401 || status === 403) {
            try {
                const executionTime = Date.now();
                await eformsignApi.authenticate(executionTime);
                safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
                return await fn();
            } catch {
                throw error;
            }
        }
        throw error;
    }
}

export type {
    MessageSenderApprovalResponse,
    MessageSenderApprovalStatus,
};

export interface ClientRegistrationPolicy {
    clientAutoRegistration: boolean;
    greetingOnAutoRegistration: boolean;
}

export type ClientRegistrationPolicyPatch = Partial<ClientRegistrationPolicy>;

export const settingsApi = {
    getClientRegistrationPolicy: async (): Promise<ClientRegistrationPolicy> => {
        const { data } = await api.get("/settings/client-registration-policy");
        return data;
    },
    updateClientRegistrationPolicy: async (
        patch: ClientRegistrationPolicyPatch,
    ): Promise<ClientRegistrationPolicy> => {
        const { data } = await api.put("/settings/client-registration-policy", patch);
        return data;
    },
    getMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.get("/settings/message-sender-approval");
        return data;
    },
    requestMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.post("/settings/message-sender-approval", {});
        return data;
    },
}
