import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { ContractDataDto } from "application/dto/contract.dto";
import {
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
} from "domain/entities/eformsign-document-job.entity";
import {
    EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
    EformsignDocumentJobList,
    EformsignDocumentJobSummary,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { assertRequiredPhone, invalidPhoneFieldMessage, InvalidPhoneError } from "application/utils/normalize-phone";

export interface EnqueueCreateDocumentParams {
    branchId: string;
    clientId: number;
    contractData: ContractDataDto;
    requestKey: string;
    source?: EformsignDocumentJobSource;
    progressId?: string;
    force?: boolean;
    createdByUserId?: string | null;
}

export interface EnqueueFinalizeDocumentParams {
    branchId: string;
    documentId: string;
    requestKey: string;
    prefillEndDate?: string;
    progressId?: string;
    source: EformsignDocumentJobSource;
    createdByUserId?: string | null;
}

export interface EnqueueDocumentJobResult {
    job: Awaited<ReturnType<IEformsignDocumentJobRepository["enqueue"]>>["job"];
    existing: boolean;
}

function assertContractDataPhones(contractData: ContractDataDto): void {
    const fields: Array<[string, unknown, boolean]> = [
        ["customerContact", contractData.customerContact, true],
        ["caretaker1Contact", contractData.caretaker1Contact, true],
        ["issuerPhone", contractData.issuerPhone, false],
    ];

    for (const [field, value, required] of fields) {
        if (!required && (value === undefined || value === null)) continue;
        try {
            assertRequiredPhone(value as string | null | undefined);
        } catch (error) {
            if (error instanceof InvalidPhoneError) {
                throw new BadRequestException(invalidPhoneFieldMessage(field));
            }
            throw error;
        }
    }
}

/**
 * Application boundary for durable eformsign work.
 *
 * The job table intentionally stores only resume input. Credentials, provider
 * responses, and the request body are never written to logs by this service.
 */
@Injectable()
export class EformsignDocumentJobService {
    constructor(
        @Inject(EFORMSIGN_DOCUMENT_JOB_REPOSITORY)
        private readonly repository: IEformsignDocumentJobRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async enqueueCreateDocument(
        params: EnqueueCreateDocumentParams,
    ): Promise<EnqueueDocumentJobResult> {
        const client = await this.clientRepository.findById(params.branchId, params.clientId);
        if (!client) throw new Error("EFORMSIGN_DOCUMENT_JOB_CLIENT_NOT_FOUND");
        // Validate the durable payload before inserting a resumable job. The
        // controller DTO normally performs this check, but this service is
        // also called by internal retry/repair paths and must not persist an
        // identity value that cannot be canonicalized.
        assertContractDataPhones(params.contractData);
        const payload: EformsignDocumentJobPayload = {
            clientId: params.clientId,
            contractData: params.contractData,
            ...(params.progressId ? { progressId: params.progressId } : {}),
            ...(params.force === true ? { force: true } : {}),
        };

        return this.repository.enqueue({
            branchId: params.branchId,
            clientId: params.clientId,
            jobType: "create_document",
            source: params.source ?? "staff",
            requestKey: params.requestKey,
            activeKey: `create:${params.branchId}:${params.clientId}`,
            payload,
            payloadFingerprint: sha256CanonicalJson(payload),
            createdByUserId: params.createdByUserId,
        });
    }

    async enqueueFinalizeDocument(
        params: EnqueueFinalizeDocumentParams,
    ): Promise<EnqueueDocumentJobResult> {
        const document = await this.eformsignDocRepository.findByDocumentId(
            params.branchId,
            params.documentId,
        );
        if (!document) throw new Error("EFORMSIGN_DOCUMENT_JOB_DOCUMENT_NOT_FOUND");
        const payload: EformsignDocumentJobPayload = {
            documentId: params.documentId,
            ...(params.prefillEndDate ? { prefillEndDate: params.prefillEndDate } : {}),
            ...(params.progressId ? { progressId: params.progressId } : {}),
        };

        return this.repository.enqueue({
            branchId: params.branchId,
            documentId: params.documentId,
            jobType: "finalize_document",
            source: params.source,
            requestKey: params.requestKey,
            activeKey: `finalize:${params.documentId}`,
            payload,
            payloadFingerprint: sha256CanonicalJson(payload),
            createdByUserId: params.createdByUserId,
        });
    }

    async getSummary(branchId: string): Promise<EformsignDocumentJobSummary> {
        return this.repository.getSummary(branchId);
    }

    async listForBranch(
        branchId: string,
        terminalSince = new Date(0),
        terminalLimit?: number,
    ): Promise<EformsignDocumentJobList> {
        return this.repository.listForBranch(branchId, terminalSince, terminalLimit);
    }
}

export function sha256CanonicalJson(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalize(value)))
        .digest("hex");
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonicalize(nested)]),
        );
    }
    return value;
}
