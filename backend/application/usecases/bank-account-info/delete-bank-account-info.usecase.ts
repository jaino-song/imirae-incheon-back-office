import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class DeleteBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    async execute(area: string, branchId?: string): Promise<void> {
        // Verify the row belongs to the caller's branch before deleting it — the repository's
        // `delete` keys only on areaId, so ownership must be confirmed first via the same
        // branch-scoped nested-relation lookup used for reads.
        const existing = await this.bankAccountInfoRepository.findByArea(area, branchId);
        if (!existing) {
            throw new NotFoundException(`Bank account info with area ${area} not found`);
        }
        await this.bankAccountInfoRepository.delete(area);
    }
}

