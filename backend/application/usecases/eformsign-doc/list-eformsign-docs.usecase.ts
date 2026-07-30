import { Inject, Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class ListEformsignDocsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string): Promise<EformsignDocEntity[]> {
        return this.eformsignDocRepository.findAll(branchid);
    }

    executeForHeadquarters(branchid: string): Promise<EformsignDocEntity[]> {
        return this.eformsignDocRepository.findAllForHeadquarters(branchid);
    }
}

