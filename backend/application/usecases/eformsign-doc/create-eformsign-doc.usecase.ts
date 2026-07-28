import { Inject, Injectable, Logger } from "@nestjs/common";
import { extractPhoneCandidates } from "application/utils/normalize-phone";
import {
    EFORMSIGN_DOCUMENT_KIND,
    EformsignDocEntity,
    EformsignDocumentKind,
} from "domain/entities/eformsign-doc.entity";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

export interface CreateEformsignDocParams {
    documentId: string;
    documentName?: string | null;
    templateName?: string | null;
    customerName?: string | null;
    creatorName?: string | null;
    lastEditorName?: string | null;
    stepRecipientTypes?: string[] | null;
    clientId: number;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: Date;
    linkToClient?: boolean; // If true, also update client.e_doc_id
    documentKind?: EformsignDocumentKind | null;
    employeeScheduleId?: number | null;
    templateId?: string | null;
}

export type CreateEformsignDocResult = EformsignDocEntity & {
    warnings?: Array<"client_link_failed">;
};

@Injectable()
export class CreateEformsignDocUsecase {
    private readonly logger = new Logger(CreateEformsignDocUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(
        branchid: string,
        params: CreateEformsignDocParams
    ): Promise<CreateEformsignDocResult> {
        const now = new Date();
        const linkedClient = params.linkToClient
            ? await this.resolveLinkedClient(branchid, params)
            : null;
        const clientId = linkedClient?.id ?? params.clientId;

        const entity = EformsignDocEntity.create({
            documentId: params.documentId,
            documentName: params.documentName?.trim() || null,
            documentNumber: null,
            templateName: params.templateName?.trim() || null,
            customerName: params.customerName?.trim() || linkedClient?.name.trim() || null,
            creatorName: params.creatorName?.trim() || null,
            lastEditorName: params.lastEditorName?.trim() || null,
            stepRecipientTypes: params.stepRecipientTypes ?? null,
            clientId,
            createdDate: now,
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType,
            stepIndex: params.stepIndex,
            stepName: params.stepName,
            stepRecipientType: params.stepRecipientType,
            stepRecipientName: params.stepRecipientName,
            stepRecipientSms: params.stepRecipientSms,
            expiredDate: params.expiredDate,
            expired: false,
            documentKind: params.documentKind ?? (params.linkToClient ? EFORMSIGN_DOCUMENT_KIND.CONTRACT : null),
            employeeScheduleId: params.employeeScheduleId ?? null,
            templateId: params.templateId ?? null,
        });
        const createdDoc = await this.eformsignDocRepository.upsertByDocumentId(branchid, entity);
        const warnings: Array<"client_link_failed"> = [];

        // If linkToClient is true, also update client.e_doc_id to track this document
        if (params.linkToClient) {
            try {
                const client = linkedClient ?? await this.clientRepository.findById(branchid, clientId);
                if (client) {
                    client.update({ eDocId: params.documentId });
                    await this.clientRepository.update(branchid, client);
                    this.logger.log(`Linked document ${params.documentId} to client ${client.id}`);
                } else {
                    this.logger.warn(`Client ${clientId} not found, skipping e_doc_id update`);
                }
            } catch (error) {
                this.logger.error(`Failed to link document to client: ${error}`);
                warnings.push("client_link_failed");
            }
        }

        return Object.assign(createdDoc, warnings.length > 0 ? { warnings } : {});
    }

    private async resolveLinkedClient(
        branchid: string,
        params: CreateEformsignDocParams,
    ): Promise<ClientEntity | null> {
        const explicitClient = await this.clientRepository.findById(branchid, params.clientId);
        if (explicitClient) {
            return explicitClient;
        }

        const candidatePhones = extractPhoneCandidates(params.stepRecipientSms);

        for (const phone of candidatePhones) {
            const matchedClient = await this.clientRepository.findByPhone(branchid, phone);
            if (!matchedClient) continue;

            if (matchedClient.id !== params.clientId) {
                this.logger.log(
                    `Resolved document ${params.documentId} to client ${matchedClient.id} by recipient phone`,
                );
            }

            return matchedClient;
        }

        return null;
    }
}
