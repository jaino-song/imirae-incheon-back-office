import { Inject, Injectable } from "@nestjs/common";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class CreateBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    execute(area: string, bankName: string, accNum: string): Promise<BankAccountInfoEntity> {
        const bankAccountInfo = BankAccountInfoEntity.create(area, bankName, accNum);
        return this.bankAccountInfoRepository.create(bankAccountInfo);
    }
}

