import { Inject, Injectable } from "@nestjs/common";

import {
    EformsignDocDisplayFields,
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class ListEformsignDocDisplayFieldsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]> {
        return this.eformsignDocRepository.findDisplayFieldsByDocumentIds(
            branchid,
            documentIds,
        );
    }
}
