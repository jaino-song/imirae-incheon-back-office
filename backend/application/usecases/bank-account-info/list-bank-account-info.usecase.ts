import { Inject, Injectable } from "@nestjs/common";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class ListBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    execute(branchId: string): Promise<BankAccountInfoEntity[]> {
        return this.bankAccountInfoRepository.findAll(branchId);
    }

    executeForBranch(branchId: string): Promise<BankAccountInfoEntity[]> {
        return this.bankAccountInfoRepository.findAll(branchId);
    }
}
