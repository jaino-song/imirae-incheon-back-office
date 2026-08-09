import axios from "axios";
import { api } from "@/lib/api/client";
/**
 * Headless dispatch/finalize run a real browser against eformsign, so they blow
 * far past the 30s default on `api`. The three hops must stay ordered — backend
 * budget (≈160s worst case) < Next.js proxy (170s) < this — so the browser
 * always ends up holding the backend's own verdict (which carries
 * `fallbackHint`) instead of aborting first on an outcome it can't classify.
 */
const HEADLESS_DISPATCH_CLIENT_TIMEOUT_MS = 180_000;
import { safeStorageSetItem } from "@/lib/safe-storage";
import type { RegisterRequest } from "@babyjamjam/shared";
import { ContractDataDto } from '@/backend/application/dto/contract.dto';
import {
    EformsignApiListResponse,
    EformsignContractClientCandidateResponse,
    CreateEformsignDocRecordRequest,
    EformsignAuthStatusResponse,
    EformsignDeleteDocumentsResponse,
    EformsignDocClientSummary,
    EformsignDocumentsResponse,
    EformsignReRequestDocumentRequest,
    HeadlessDispatchResponse,
    HeadlessFinalizeResponse,
} from '@babyjamjam/shared/types/eformsign';
import type { EformsignStatusCountsResponse } from "@/lib/eformsign/types";
import type {
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
} from "@babyjamjam/shared/types/message";

const DEFAULT_EFORMSIGN_LIMIT = 100;
const DEFAULT_EFORMSIGN_SKIP = 0;

export interface ServiceRecordTemplateIdResponse {
    templateId: string | null;
    templateIds?: string[];
}

export interface LocalEformsignDocRecord {
    id?: number;
    documentId: string;
    createdDate: string;
    updatedDate: string;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: string;
    expired: boolean;
    clientId: number;
    documentKind: "contract" | "service_record_snapshot" | null;
    employeeScheduleId: number | null;
    templateId: string | null;
    /** YYYY-MM-DD, attached for provider-review docs; splits 서명 완료 vs 검토 필요. */
    contractEndDate?: string | null;
    /** Authoritative display status stamped by the backend at serve time. */
    displayStatus?: string | null;
}

export function normalizeDocumentListResponse(
    response: EformsignApiListResponse,
    params?: { limit?: number; skip?: number },
): EformsignDocumentsResponse {
    return {
        documents: response.documents ?? [],
        total_rows: response.total_rows ?? response.total_count ?? response.documents?.length ?? 0,
        limit: params?.limit ?? DEFAULT_EFORMSIGN_LIMIT,
        skip: params?.skip ?? DEFAULT_EFORMSIGN_SKIP,
    };
}

// Auth API response types
export interface AuthResponse {
    success: boolean;
    message?: string;
    code?: string;
    hasKakaoAccount?: boolean;
    errors?: string[];
}

export interface LoginResponse extends AuthResponse {
    accessToken?: string;
    refreshToken?: string;
    user?: string;
}

// Auth API
export const authApi = {
    kakaoLogin: () => {
        window.location.href = "/api/auth/kakao";
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
    // Authenticates and stores token in httpOnly cookie (returns { success: true })
    authenticate: async (executionTime: number, memberEmail?: string): Promise<{ success: boolean }> => {
        const { data } = await api.post('/access-token', { executionTime, memberEmail });
        return data;
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
    getDocument: async (documentId: string) => {
        const { data } = await api.get(`/eformsign/documents/${documentId}`);
        return data;
    },
    getDocumentClientCandidate: async (documentId: string) => {
        const { data } = await api.get(
            `/eformsign/documents/${encodeURIComponent(documentId)}/client-candidate`
        );
        return data as EformsignContractClientCandidateResponse;
    },
    // Receipt = page 7 of the document PDF, extracted by the download_files BFF route.
    // Browser-navigable BFF URL (full /api path, used as href/download — NOT via the axios client).
    getDocumentReceiptDownloadUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document&page=7`,
    getLocalDocumentRecord: async (documentId: string) => {
        const { data } = await api.get(`/eformsign-docs/document-id`, {
            params: { documentId },
        });
        return data as { clientId?: number | null } | null;
    },
    generateDocument: async (contractData: ContractDataDto, clientId: number) => {
        const { data } = await api.post('/generate-document', { contractData, clientId });
        return data;
    },
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
    // Create eformsign doc record to track document in local DB
    createDocRecord: async (params: CreateEformsignDocRecordRequest) => {
        const { data } = await api.post('/eformsign-docs', params);
        return data;
    },
    // Documents APIs - token is read from httpOnly cookie on server
    // Note: eformsign routes use /eformsign prefix to avoid conflict with file storage /documents
    // Unified endpoint - fetches all documents in single request (more efficient)
    getAllDocuments: async (params?: { limit?: number; skip?: number; type?: string | null; templateId?: string; templateMatch?: "include" | "exclude"; search?: string; excludeDeleted?: boolean }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents', { params });
        return data;
    },
    getInProgressDocuments: async (params?: { limit?: number; skip?: number; templateId?: string; templateMatch?: "include" | "exclude"; search?: string }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/in-progress', { params });
        return normalizeDocumentListResponse(data, params);
    },
    getCompletedDocuments: async (params?: { limit?: number; skip?: number; templateId?: string; templateMatch?: "include" | "exclude"; search?: string }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/completed', { params });
        return normalizeDocumentListResponse(data, params);
    },
    getExpiredDocuments: async (params?: { limit?: number; skip?: number; templateId?: string; templateMatch?: "include" | "exclude"; search?: string }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get<EformsignApiListResponse>('/eformsign/documents/expired', { params });
        return normalizeDocumentListResponse(data, params);
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
    /**
     * BJJ-90: backend-driven creation dispatch. Drives the iframe gate
     * sequence (mode:"01") via headless Chromium so staff don't see the
     * iframe. Returns ok=false on any failure — the caller falls back to
     * the existing iframe modal.
     */
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
        }, { timeout: HEADLESS_DISPATCH_CLIENT_TIMEOUT_MS });
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
    /**
     * BJJ-90: backend-driven staff finalize (mode:"02"). Same fallback
     * contract — ok=false instructs the caller to open the iframe modal.
     */
    finalizeHeadless: async (
        documentId: string,
        prefillEndDate?: string,
        progressId?: string,
    ): Promise<HeadlessFinalizeResponse> => {
        const { data } = await api.post('/eformsign-docs/finalize-headless', {
            documentId,
            prefillEndDate,
            progressId,
        }, { timeout: HEADLESS_DISPATCH_CLIENT_TIMEOUT_MS });
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
    getDocumentsByClientId: async (clientId: number): Promise<LocalEformsignDocRecord[]> => {
        const { data } = await api.get('/eformsign-docs/client', {
            params: { clientId },
        });
        return data;
    },
    // 전체 탭 StatsBar 카운터용 원시 신호. 토큰은 프록시가 서버에서 주입.
    getDocumentStatusCounts: async (): Promise<EformsignStatusCountsResponse> => {
        const { data } = await api.get('/eformsign/documents/status-counts');
        return data;
    },
}

export async function withEformsignReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (!axios.isAxiosError(error)) throw error;

        const status = error.response?.status;
        if (status !== 401 && status !== 403) throw error;

        try {
            const executionTime = Date.now();
            await eformsignApi.authenticate(executionTime);
            safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
            return await fn();
        } catch {
            throw error;
        }
    }
}

export type MessageSenderApprovalStatus = "not_requested" | "pending" | "approved";

export interface MessageSenderApprovalResponse {
    approvalStatus: MessageSenderApprovalStatus;
    isApproved: boolean;
    canRequest: boolean;
    requestedAt: string | null;
    approvedAt: string | null;
}

export interface MessageAutomationPolicyRow {
    id: string;
    label: string;
    value: string;
}

export interface MessageAutomationPolicy {
    id: string;
    title: string;
    description: string;
    active: boolean;
    requiresApproval: boolean;
    rows: MessageAutomationPolicyRow[];
}

export interface MessageAutomationPastTriggerConfig {
    sendIntervalMinutes: number;
    ruleOrder: string[];
}

export interface ClientRegistrationPolicy {
    clientAutoRegistration: boolean;
    greetingOnAutoRegistration: boolean;
}

export type ClientRegistrationPolicyPatch = Partial<ClientRegistrationPolicy>;

export interface MessageAutomationPoliciesResponse {
    policies: MessageAutomationPolicy[];
    pastTriggerConfig: MessageAutomationPastTriggerConfig;
}

export interface NotificationPreferencesResponse {
    emailNotificationsEnabled: boolean;
    updatedAt?: string;
}

export type {
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
};

export interface RibbonConfig {
    enabled: boolean;
    message: string;
    backgroundColor: string;
    textColor: string;
    linkText: string;
    linkHref: string;
    linkColor: string;
}

export interface RibbonConfigResponse extends RibbonConfig {
    updatedAt?: string;
}

export interface ConsultationInquiry {
    id: string;
    branchId: string;
    publicBranchSlug: string;
    motherName: string;
    phone: string;
    address: string;
    dueDate: string;
    birthExperience: string;
    voucherType: string | null;
    preferredCaregiverName: string | null;
    referralSource: string;
    privacyAcceptedAt: string;
    selectedServices: ConsultationSelectedServices | null;
    additionalNotes: string | null;
    source: string;
    status: string;
    readAt: string | null;
    createdAt: string;
    updatedAt: string;
    branchName?: string;
}

export interface ConsultationSelectedServices {
    plan: {
        id: string;
        name: string;
        priceLabel: string;
        durationDays: number | null;
    } | null;
    addons: Array<{
        id: string;
        name: string;
        priceLabel: string;
        quantity: number;
        group: string | null;
    }>;
}

export interface ConsultationInquiryListResponse {
    data: ConsultationInquiry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface ConsultationInquiryListParams {
    page?: number;
    limit?: number;
    search?: string;
    phone?: string;
    status?: string;
    readState?: string;
}

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
    getMessageAutomationPolicies: async (): Promise<MessageAutomationPoliciesResponse> => {
        const { data } = await api.get("/settings/message-automation-policies");
        return data;
    },
    updateMessageAutomationPastTriggerConfig: async (
        config: MessageAutomationPastTriggerConfig,
    ): Promise<MessageAutomationPastTriggerConfig> => {
        const { data } = await api.put("/settings/message-automation-policies/past-trigger", config);
        return data;
    },
    requestMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.post("/settings/message-sender-approval/request");
        return data;
    },
    getNotificationPreferences: async (): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.get('/settings/notification-preferences');
        return data;
    },
    updateNotificationPreferences: async (emailNotificationsEnabled: boolean): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.put('/settings/notification-preferences', { emailNotificationsEnabled });
        return data;
    },
    getRibbonConfig: async (): Promise<RibbonConfigResponse> => {
        const { data } = await api.get('/settings/ribbon-config');
        return data;
    },
    updateRibbonConfig: async (config: RibbonConfig): Promise<RibbonConfigResponse> => {
        const { data } = await api.put('/settings/ribbon-config', config);
        return data;
    },
}

export const consultationInquiriesApi = {
    list: async (params: ConsultationInquiryListParams = {}): Promise<ConsultationInquiryListResponse> => {
        const { data } = await api.get("/consultation-inquiries", { params });
        return data;
    },
    markRead: async (id: string): Promise<ConsultationInquiry> => {
        const { data } = await api.patch(`/consultation-inquiries/${id}/read`);
        return data;
    },
};

export const messageDeliveryApi = {
    sendSms: async (
        payload: SendMessageDeliverySmsRequest
    ): Promise<SendMessageDeliverySmsResponse> => {
        try {
            const { data } = await api.post("/message-deliveries/sms", payload);
            return data;
        } catch (error) {
            if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
                const message =
                    error.response?.data?.error
                    || error.response?.data?.message
                    || error.message;
                throw new Error(message);
            }

            throw error;
        }
    },
};
