import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
    ReviewStageContract,
} from "domain/repositories/eformsign-doc.repository.interface";

/**
 * Provider-review-stage (070) contracts with their auto-finalize bookkeeping —
 * the dashboard's 검토 필요 계약서 card. Branch scoping is the caller's job:
 * the same pool feeds the (unscoped) nightly scheduler.
 */
@Injectable()
export class ListReviewStageContractsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(): Promise<ReviewStageContract[]> {
        return this.eformsignDocRepository.findReviewStageContracts();
    }
}
