import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class DeleteBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    async execute(area: string, branchId: string): Promise<void> {
        // The delete statement itself is branch-pinned in the repository
        // (deleteMany keyed on areaId + area.branchId), so ownership is
        // enforced atomically — no TOCTOU between a lookup and the delete.
        // count 0 means the row does not exist in this branch: 404 either way.
        const deleted = await this.bankAccountInfoRepository.delete(area, branchId);
        if (deleted !== 1) {
            throw new NotFoundException(`Bank account info with area ${area} not found`);
        }
    }
}

