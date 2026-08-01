import { Inject, Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export type EformsignDocWithContractEndDate = ReturnType<EformsignDocEntity["toJSON"]> & {
    /** YYYY-MM-DD from the mirrored detail payload; null when not recoverable. */
    contractEndDate: string | null;
};

@Injectable()
export class FindEformsignDocsByClientIdUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.eformsignDocRepository.findByClientId(branchid, clientId);
    }

    /**
     * Same rows, carrying the contract end date parsed from the mirrored detail
     * payloads so the client panel can apply the shared 서명 완료/검토 필요 rule.
     */
    async executeWithContractEndDates(
        branchid: string,
        clientId: number,
    ): Promise<EformsignDocWithContractEndDate[]> {
        const docs = await this.execute(branchid, clientId);
        const endDates = docs.length > 0
            ? await this.eformsignDocRepository.findContractEndDatesByDocumentIds(
                docs.map((doc) => doc.documentId),
            )
            : new Map<string, string>();
        return docs.map((doc) => ({
            ...doc.toJSON(),
            contractEndDate: endDates.get(doc.documentId) ?? null,
        }));
    }
}


