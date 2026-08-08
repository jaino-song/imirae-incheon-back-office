import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches } from "class-validator";
import { ContractDataDto } from "application/dto/contract.dto";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { EFORMSIGN_DOCUMENT_KIND, type EformsignDocumentKind } from "domain/entities/eformsign-doc.entity";

/**
 * DTO for getting access token
 */
export class GetAccessTokenDto {
    @IsNumber()
    executionTime!: number;

    @IsOptional()
    @IsString()
    memberEmail?: string;
}

/**
 * DTO for refreshing access token
 */
export class RefreshAccessTokenDto {
    @IsNumber()
    executionTime!: number;

    @IsString()
    refreshToken!: string;
}

/**
 * DTO for fetching documents from API
 */
export class FetchDocumentsDto {
    @IsString()
    accessToken!: string;
}

/**
 * DTO for fetching a single document from API
 */
export class FetchDocumentByIdDto {
    @IsString()
    accessToken!: string;

    @IsString()
    documentId!: string;
}

export class SyncEformsignDocStatusDto {
    @IsString()
    accessToken!: string;

    @IsString()
    documentId!: string;
}

/**
 * DTO for creating a new eformsign doc record in local DB
 */
export class CreateEformsignDocLocalDto {
    @IsString()
    documentId!: string;

    @IsNumber()
    clientId!: number;

    @IsString()
    statusType!: string;

    @IsString()
    statusDetail!: string;

    @IsString()
    stepType!: string;

    @IsString()
    stepIndex!: string;

    @IsString()
    stepName!: string;

    @IsString()
    stepRecipientType!: string;

    @IsString()
    stepRecipientName!: string;

    @IsString()
    stepRecipientSms!: string;

    @IsDateString()
    expiredDate!: string; // ISO date string

    @IsOptional()
    @IsBoolean()
    linkToClient?: boolean; // If true, also update client.e_doc_id

    @IsOptional()
    @IsIn(Object.values(EFORMSIGN_DOCUMENT_KIND))
    documentKind?: EformsignDocumentKind | null;

    @IsOptional()
    @IsNumber()
    employeeScheduleId?: number | null;

    @IsOptional()
    @IsString()
    templateId?: string | null;
}

/**
 * DTO for headless dispatch (creation, mode:"01")
 */
export class DispatchHeadlessRequestDto {
    @IsObject()
    contractData!: ContractDataDto;

    @IsNumber()
    clientId!: number;

    @IsOptional()
    @IsString()
    progressId?: string;

    @IsOptional()
    @IsBoolean()
    force?: boolean;
}

export interface DispatchHeadlessResponseDto {
    ok: boolean;
    documentId?: string;
    remoteDocumentId?: string;
    existingDocumentId?: string;
    durationMs: number;
    reason?: string;
    failedStep?: EformsignHeadlessProgressStep;
    fallbackHint?: "iframe" | "adopt" | "manual_check" | "adopt-or-manual";
}

export class AdoptEformsignDocDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;

    @IsOptional()
    @IsNumber()
    clientId?: number;
}

/**
 * DTO for headless finalize (mode:"02")
 */
export class FinalizeHeadlessRequestDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "prefillEndDate must match YYYY-MM-DD" })
    prefillEndDate?: string;

    @IsOptional()
    @IsString()
    progressId?: string;
}

export interface ReviewNeededContractDto {
    documentId: string;
    customerName: string | null;
    contractEndDate: string | null;
    autoFinalizeAttempts: number;
    autoFinalizeLastError: string | null;
    autoFinalizeLastAttemptAt: string | null;
}

export interface FinalizeHeadlessResponseDto {
    ok: boolean;
    durationMs: number;
    reason?: string;
    fallbackHint?: "iframe" | "manual_check";
}
