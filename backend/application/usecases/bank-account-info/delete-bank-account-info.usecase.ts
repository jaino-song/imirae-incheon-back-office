import { Inject, Injectable } from "@nestjs/common";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class DeleteBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    async execute(area: string): Promise<void> {
        await this.bankAccountInfoRepository.delete(area);
    }
}

