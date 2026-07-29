import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { extractPhoneCandidates } from "application/utils/normalize-phone";
import {
    EFORMSIGN_DOCUMENT_KIND,
    EformsignDocEntity,
} from "domain/entities/eformsign-doc.entity";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class LinkDocumentToClientUsecase {
    private readonly logger = new Logger(LinkDocumentToClientUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchid: string, documentId: string): Promise<void> {
        const doc = await this.eformsignDocRepository.findByDocumentId(branchid, documentId);
        if (!doc) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }

        if (doc.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT) {
            this.logger.debug(`Skipping client contract link for service-record document ${documentId}`);
            return;
        }

        const client = await this.resolveClientByRecipientPhone(branchid, doc)
            ?? (doc.clientId === null
                ? null
                : await this.clientRepository.findById(branchid, doc.clientId));
        if (!client) {
            throw new NotFoundException(`Client for document ${documentId} not found`);
        }

        if (doc.clientId !== client.id) {
            await this.eformsignDocRepository.update(
                branchid,
                this.reassignDocumentToClient(doc, client.id),
            );
            this.logger.log(`Reassigned document ${documentId} to client ${client.id} by recipient phone`);
        }

        if (client.eDocId !== documentId) {
            client.update({ eDocId: documentId });
            await this.clientRepository.update(branchid, client);
            this.logger.log(`Linked document ${documentId} to client ${client.id}`);
        }
    }

    private async resolveClientByRecipientPhone(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<ClientEntity | null> {
        const candidatePhones = extractPhoneCandidates(doc.stepRecipientSms);

        for (const phone of candidatePhones) {
            const client = await this.clientRepository.findByPhone(branchid, phone);
            if (client) {
                return client;
            }
        }

        return null;
    }

    private reassignDocumentToClient(
        doc: EformsignDocEntity,
        clientId: number,
    ): EformsignDocEntity {
        return EformsignDocEntity.reconstitute({
            id: doc.id,
            documentId: doc.documentId,
            documentName: doc.documentName,
            documentNumber: doc.documentNumber,
            templateName: doc.templateName,
            customerName: doc.customerName,
            creatorName: doc.creatorName,
            lastEditorName: doc.lastEditorName,
            stepRecipientTypes: doc.stepRecipientTypes,
            createdDate: doc.createdDate,
            updatedDate: new Date(),
            statusType: doc.statusType,
            statusDetail: doc.statusDetail,
            stepType: doc.stepType,
            stepIndex: doc.stepIndex,
            stepName: doc.stepName,
            stepRecipientType: doc.stepRecipientType,
            stepRecipientName: doc.stepRecipientName,
            stepRecipientSms: doc.stepRecipientSms,
            expiredDate: doc.expiredDate,
            expired: doc.expired,
            clientId,
            documentKind: doc.documentKind,
            employeeScheduleId: doc.employeeScheduleId,
            templateId: doc.templateId,
        });
    }
}
