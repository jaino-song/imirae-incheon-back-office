import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

export type UpdateBankAccountInfoParams = {
    bankName?: string | null;
    accNum?: string | null;
};

@Injectable()
export class UpdateBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    async execute(area: string, updates: UpdateBankAccountInfoParams): Promise<BankAccountInfoEntity> {
        const bankAccountInfo = await this.bankAccountInfoRepository.findByArea(area);
        if (!bankAccountInfo) {
            throw new NotFoundException(`Bank account info with area ${area} not found`);
        }

        if (updates.bankName !== undefined) {
            bankAccountInfo.bankName = updates.bankName;
        }
        if (updates.accNum !== undefined) {
            bankAccountInfo.accNum = updates.accNum;
        }

        return this.bankAccountInfoRepository.update(bankAccountInfo);
    }
}

