import { Inject, Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class FindEformsignDocByDocumentIdUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        return this.eformsignDocRepository.findByDocumentId(branchid, documentId);
    }

    executeIncludingPurgePending(
        branchid: string,
        documentId: string,
    ): Promise<EformsignDocEntity | null> {
        return this.eformsignDocRepository.findByDocumentIdIncludingPurgePending(
            branchid,
            documentId,
        );
    }
}

