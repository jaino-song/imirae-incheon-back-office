import { Prisma } from "@prisma/client";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

const RECIPIENT_PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

export class PrepareAdminServiceRecordLinkDto {
    @IsOptional()
    @IsString()
    @Matches(RECIPIENT_PHONE_PATTERN, {
        message: "수신 전화번호 형식이 올바르지 않습니다.",
    })
    recipientPhone?: string;
}

export class SendAdminServiceRecordLinkDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    @Matches(/^efl_[A-Za-z0-9_-]{40,64}$/, {
        message: "준비된 제공기록지 링크 형식이 올바르지 않습니다.",
    })
    preparedLinkToken?: string;

    @IsOptional()
    @IsString()
    @Matches(RECIPIENT_PHONE_PATTERN, {
        message: "수신 전화번호 형식이 올바르지 않습니다.",
    })
    recipientPhone?: string;
}

export interface AdminServiceRecordPreparedLinkDto {
    serviceRecordUrl: string;
    preparedLinkToken: string;
    expiresAt: Date;
}

export interface AdminServiceRecordResetLinkDto {
    serviceRecordUrl: string;
    expiresAt: Date;
}

export interface AdminServiceRecordHeaderEditLinkDto {
    serviceRecordUrl: string;
    expiresAt: Date;
}

export type AdminServiceRecordLinkStatus = "none" | "scheduled" | "sent" | "failed" | "canceled";
export type AdminServiceRecordTokenState = "active" | "expired" | "revoked" | null;

export interface AdminServiceRecordTokenDto {
    issuedAt: Date;
    verifiedAt: Date | null;
    expiresAt: Date;
    state: AdminServiceRecordTokenState;
}

export interface AdminServiceRecordLinkDto {
    status: AdminServiceRecordLinkStatus;
    scheduledFor: Date | null;
    sentCount: number;
    lastSentAt: Date | null;
    token: AdminServiceRecordTokenDto | null;
}

export interface AdminServiceRecordEmployeeDto {
    id: number;
    name: string;
    phone: string;
}

export interface AdminServiceRecordHeaderDto {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface AdminServiceRecordSessionDto {
    sessionIndex: number;
    serviceDate: Date;
    locked: boolean;
    submittedAt: Date | null;
    updatedAt: Date;
    answers: Prisma.JsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    hasMomApproval: boolean;
    employeeId: number | null;
    employeeName: string | null;
    formVersion: number;
}

export interface AdminServiceRecordSignatureDocDto {
    documentId: string;
    statusDetail: string;
    stepName: string;
    createdDate: Date;
    updatedDate: Date;
    snapshotVersion: number | null;
    snapshotChunkIndex: number | null;
    employeeScheduleId: number | null;
}

export interface AdminServiceRecordCaseDto {
    id: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    totalSessions: number;
    completedAt: Date | null;
    finalizationDueAt: Date | null;
    finalizedAt: Date | null;
    documentsCompletedAt: Date | null;
    lastError: string | null;
    header: AdminServiceRecordHeaderDto | null;
    sessions: AdminServiceRecordSessionDto[];
    signatureDocs: AdminServiceRecordSignatureDocDto[];
}

export interface AdminServiceRecordAssignmentDto {
    scheduleId: number;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    employee: AdminServiceRecordEmployeeDto;
    link: AdminServiceRecordLinkDto;
    header: AdminServiceRecordHeaderDto | null;
    totalSessions: number;
    sessions: AdminServiceRecordSessionDto[];
    signatureDoc: AdminServiceRecordSignatureDocDto | null;
}

export interface AdminServiceRecordOverviewDto {
    record: AdminServiceRecordCaseDto | null;
    assignments: AdminServiceRecordAssignmentDto[];
}
