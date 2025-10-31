import { Injectable } from "@nestjs/common";
import {
    CreateBankAccountInfoUsecase,
    FindBankAccountInfoByAreaUsecase,
    UpdateBankAccountInfoUsecase,
    DeleteBankAccountInfoUsecase,
} from "application/usecases/bank-account-info";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

@Injectable()
export class BankAccountInfoService {
    constructor(
        private readonly createBankAccountInfoUsecase: CreateBankAccountInfoUsecase,
        private readonly findBankAccountInfoByAreaUsecase: FindBankAccountInfoByAreaUsecase,
        private readonly updateBankAccountInfoUsecase: UpdateBankAccountInfoUsecase,
        private readonly deleteBankAccountInfoUsecase: DeleteBankAccountInfoUsecase,
    ) {}

    create(params: { area: string, bankName: string, accNum: string }): Promise<BankAccountInfoEntity> {
        return this.createBankAccountInfoUsecase.execute(params.area, params.bankName, params.accNum);
    }
    
    findByArea(area: string): Promise<BankAccountInfoEntity | null> {
        return this.findBankAccountInfoByAreaUsecase.execute(area);
    }

    update(area: string, params: { bankName?: string | null, accNum?: string | null }): Promise<BankAccountInfoEntity> {
        return this.updateBankAccountInfoUsecase.execute(area, params);
    }

    delete(area: string) {
        return this.deleteBankAccountInfoUsecase.execute(area);
    }
}