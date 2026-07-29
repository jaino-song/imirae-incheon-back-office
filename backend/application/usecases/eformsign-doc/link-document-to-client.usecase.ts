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

        const needsDocumentReassignment = doc.clientId !== client.id;
        const needsClientPointerUpdate = client.eDocId !== documentId;
        if (!needsDocumentReassignment && !needsClientPointerUpdate) {
            return;
        }

        const linked = await this.eformsignDocRepository.linkClientIfActive(
            branchid,
            documentId,
            client.id,
        );
        if (!linked) {
            this.logger.debug(
                `Skipping client contract link for inactive document ${documentId}`,
            );
            return;
        }

        if (needsDocumentReassignment) {
            this.logger.log(`Reassigned document ${documentId} to client ${client.id} by recipient phone`);
        }

        if (needsClientPointerUpdate) {
            client.update({ eDocId: documentId });
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
}
