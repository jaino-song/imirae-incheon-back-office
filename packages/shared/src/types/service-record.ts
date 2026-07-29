import type { MessageTriggerJobStatus } from "./message";

export type ServiceRecordLinkStatus = "none" | "scheduled" | "sent" | "failed" | "canceled";
export type ServiceRecordTokenState = "active" | "expired" | "revoked" | null;

export interface ServiceRecordToken {
    issuedAt: string;
    verifiedAt: string | null;
    expiresAt: string;
    state: ServiceRecordTokenState;
}

export interface ServiceRecordLink {
    status: ServiceRecordLinkStatus;
    scheduledFor: string | null;
    sentCount: number;
    lastSentAt: string | null;
    token: ServiceRecordToken | null;
}

export interface ServiceRecordHeader {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ServiceRecordSession {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    submittedAt: string | null;
    updatedAt: string;
    answers: Record<string, unknown>;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    hasMomApproval: boolean;
    employeeId?: number | null;
    employeeName?: string | null;
    formVersion?: number;
}

export interface SignatureDocStatus {
    documentId: string;
    statusDetail: string;
    stepName: string;
    createdDate: string;
    updatedDate: string;
    snapshotVersion?: number | null;
    snapshotChunkIndex?: number | null;
    employeeScheduleId?: number | null;
}

export interface ServiceRecordCase {
    id: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    totalSessions: number;
    completedAt: string | null;
    finalizationDueAt: string | null;
    finalizedAt: string | null;
    documentsCompletedAt: string | null;
    lastError: string | null;
    header: ServiceRecordHeader | null;
    sessions: ServiceRecordSession[];
    signatureDocs: SignatureDocStatus[];
}

export interface ServiceRecordAssignment {
    scheduleId: number;
    startDate: string;
    endDate: string;
    replaced: boolean;
    employee: {
        id: number;
        name: string;
        phone: string;
    };
    link: ServiceRecordLink;
    header: ServiceRecordHeader | null;
    totalSessions: number;
    sessions: ServiceRecordSession[];
    signatureDoc: SignatureDocStatus | null;
}

export interface ServiceRecordOverview {
    record?: ServiceRecordCase | null;
    assignments: ServiceRecordAssignment[];
}

export interface SendServiceRecordLinkResponse {
    ok: boolean;
    jobId: string;
    status: MessageTriggerJobStatus;
    scheduledFor: string;
}

export interface PrepareServiceRecordLinkResponse {
    serviceRecordUrl: string;
    preparedLinkToken: string;
    expiresAt: string;
}

export interface ResetServiceRecordLinkResponse {
    serviceRecordUrl: string;
    expiresAt: string;
}

export interface CreateServiceRecordHeaderEditLinkResponse {
    serviceRecordUrl: string;
    expiresAt: string;
}

export interface ServiceScheduleChangePreviewResponse {
    sessionIndex: number;
    fromDate: string;
    minimumDate: string;
}

export interface ApplyServiceScheduleChangeRequest {
    toDate: string;
}

export interface ApplyServiceScheduleChangeResponse {
    id: string;
    scheduleId: number;
    clientId: number;
    sessionIndex: number;
    fromDate: string;
    toDate: string;
    oldEndDate: string;
    newEndDate: string;
    status: "approved";
}

export interface PrepareServiceRecordLinkRequest {
    recipientPhone?: string;
}

export interface SendServiceRecordLinkRequest {
    preparedLinkToken?: string;
    recipientPhone?: string;
}
