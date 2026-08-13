import { Type } from "class-transformer";
import {
    IsDateString,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";
import { ContractDataDto } from "application/dto/contract.dto";
import type {
    EformsignDocumentJobSource,
    EformsignDocumentJobStatus,
    EformsignDocumentJobType,
    EformsignDocumentJobEntity,
} from "domain/entities/eformsign-document-job.entity";

const EFORMSIGN_DOCUMENT_JOB_REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const EFORMSIGN_DOCUMENT_JOB_IDENTIFIER_PATTERN = /^\S+$/;
const EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH = 255;

/**
 * The subset of contract data required to resume a document-creation job.
 *
 * This is deliberately a separate class from the application interface so the
 * global validation pipe can reject undeclared nested fields as well as
 * undeclared top-level fields.
 */
export class EformsignDocumentJobContractDataDto implements ContractDataDto {
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    customerName!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    customerContact!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    customerDOB!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    customerAddress!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    caretaker1Name!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    caretaker1Contact!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    type!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    days!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    area!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    contractDuration!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    startYear!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    startMonth!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    startDay!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    startDate!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    endYear!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    endMonth!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    endDay!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    endDate!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    paymentYear!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    paymentMonth!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    paymentDay!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    fullPrice!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    grant!: string;
    @IsString() @IsNotEmpty() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    actualPrice!: string;
    @IsOptional() @IsString() @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    issuerPhone?: string;
}

/** Request for durable asynchronous eformsign document creation. */
export class CreateEformsignDocumentJobDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    @Matches(EFORMSIGN_DOCUMENT_JOB_REQUEST_KEY_PATTERN, {
        message: "requestKey must be a UUID-like non-blank key of at most 255 characters",
    })
    requestKey!: string;

    @IsInt()
    @Min(1)
    clientId!: number;

    @IsObject()
    @ValidateNested()
    @Type(() => EformsignDocumentJobContractDataDto)
    contractData!: EformsignDocumentJobContractDataDto;
}

/** Request for durable asynchronous eformsign document finalization. */
export class FinalizeEformsignDocumentJobDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    @Matches(EFORMSIGN_DOCUMENT_JOB_REQUEST_KEY_PATTERN, {
        message: "requestKey must be a UUID-like non-blank key of at most 255 characters",
    })
    requestKey!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(EFORMSIGN_DOCUMENT_JOB_TEXT_MAX_LENGTH)
    @Matches(EFORMSIGN_DOCUMENT_JOB_IDENTIFIER_PATTERN, {
        message: "documentId must not contain whitespace",
    })
    documentId!: string;

    @IsOptional()
    @IsDateString({}, { message: "prefillEndDate must be a valid ISO date" })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "prefillEndDate must match YYYY-MM-DD" })
    prefillEndDate?: string;
}

export interface EformsignDocumentJobResponseDto {
    jobId: string;
    jobType: EformsignDocumentJobType;
    source: EformsignDocumentJobSource;
    status: EformsignDocumentJobStatus;
    clientId: number | null;
    documentId: string | null;
    progressStep: string | null;
    attempts: number;
    nextAttemptAt: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface EnqueueEformsignDocumentJobResponseDto {
    jobId: string;
    status: EformsignDocumentJobStatus;
    existing: boolean;
}

export interface EformsignDocumentJobListResponseDto {
    active: EformsignDocumentJobResponseDto[];
    requiresAttention: EformsignDocumentJobResponseDto[];
    recent: EformsignDocumentJobResponseDto[];
}

/**
 * Keep response construction in one place so internal payload/fingerprint,
 * request keys, and provider error details cannot leak through the API.
 */
export const toEformsignDocumentJobResponse = (
    job: EformsignDocumentJobEntity,
): EformsignDocumentJobResponseDto => ({
    jobId: job.id,
    jobType: job.jobType,
    source: job.source,
    status: job.status,
    clientId: job.clientId,
    documentId: job.documentId,
    progressStep: job.progressStep,
    attempts: job.attempts,
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
});
