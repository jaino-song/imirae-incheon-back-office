import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

import { TERMINAL_STATUS_CODES } from "./eformsign-doc-status.constants";

export interface UpdateEformsignDocStatusParams {
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepType?: string;
    stepIndex?: string;
    stepName?: string;
    expired?: boolean;
    sourceUpdatedDate?: Date;
    documentName?: string;
    templateName?: string;
}

export interface UpdateEformsignDocStatusResult {
    document: EformsignDocEntity;
    applied: boolean;
}

@Injectable()
export class UpdateEformsignDocStatusUsecase {
    private readonly logger = new Logger(UpdateEformsignDocStatusUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        branchid: string,
        params: UpdateEformsignDocStatusParams
    ): Promise<EformsignDocEntity> {
        return (await this.executeWithOutcome(branchid, params)).document;
    }

    async executeWithOutcome(
        branchid: string,
        params: UpdateEformsignDocStatusParams,
    ): Promise<UpdateEformsignDocStatusResult> {
        const existing = await this.eformsignDocRepository.findByDocumentId(
            branchid,
            params.documentId
        );
        if (!existing) {
            throw new NotFoundException(`EformsignDoc with documentId ${params.documentId} not found`);
        }

        // P1-11 guard: once a document has reached a terminal status (completed,
        // or rejected/expired), never let a stale/out-of-order webhook downgrade
        // it back to a non-terminal status. Terminal -> terminal transitions
        // (e.g. completed -> rejected) remain allowed.
        if (TERMINAL_STATUS_CODES.has(existing.statusType) && !TERMINAL_STATUS_CODES.has(params.statusType)) {
            this.logger.log(`ignoring stale downgrade ${params.statusType} for ${params.documentId}`);
            return { document: existing, applied: false };
        }

        if (
            params.sourceUpdatedDate
            && params.sourceUpdatedDate.getTime() <= existing.updatedDate.getTime()
            && params.statusType !== existing.statusType
        ) {
            this.logger.log(`ignoring stale timestamp ${params.statusType} for ${params.documentId}`);
            return { document: existing, applied: false };
        }

        const updatedDate = params.sourceUpdatedDate ?? existing.updatedDate;

        // Reconstitute entity with updated fields
        const updated = EformsignDocEntity.reconstitute({
            id: existing.id,
            documentId: existing.documentId,
            documentName: params.documentName?.trim() || existing.documentName,
            documentNumber: existing.documentNumber,
            templateName: params.templateName?.trim() || existing.templateName,
            customerName: existing.customerName,
            creatorName: existing.creatorName,
            lastEditorName: existing.lastEditorName,
            stepRecipientTypes: existing.stepRecipientTypes,
            createdDate: existing.createdDate,
            updatedDate,
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType ?? existing.stepType,
            stepIndex: params.stepIndex ?? existing.stepIndex,
            stepName: params.stepName ?? existing.stepName,
            stepRecipientType: existing.stepRecipientType,
            stepRecipientName: existing.stepRecipientName,
            stepRecipientSms: existing.stepRecipientSms,
            expiredDate: existing.expiredDate,
            expired: params.expired ?? existing.expired,
            clientId: existing.clientId,
            documentKind: existing.documentKind,
            employeeScheduleId: existing.employeeScheduleId,
            templateId: existing.templateId,
        });

        if (params.sourceUpdatedDate) {
            return this.eformsignDocRepository.updateIfSourceNewer(branchid, updated);
        }
        return {
            document: await this.eformsignDocRepository.update(branchid, updated),
            applied: true,
        };
    }
}
