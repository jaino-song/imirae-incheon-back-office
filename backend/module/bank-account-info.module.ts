import { Module } from "@nestjs/common";
import {
    CreateBankAccountInfoUsecase,
    FindBankAccountInfoByAreaUsecase,
    ListBankAccountInfoUsecase,
    UpdateBankAccountInfoUsecase,
    DeleteBankAccountInfoUsecase,
} from "application/usecases/bank-account-info";
import {
    SbBankAccountInfoRepository,
} from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { BankAccountInfoController } from "interface/controllers/bank-account-info.controller";
import { BANK_ACCOUNT_INFO_REPOSITORY } from "domain/repositories/bank-account-info.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { BankAccountAgentCapabilitiesProvider } from "application/usecases/bank-account-info/bank-account-agent-capabilities.provider";

@Module({
    imports: [DatabaseModule],
    controllers: [BankAccountInfoController],
    providers: [
        CreateBankAccountInfoUsecase,
        FindBankAccountInfoByAreaUsecase,
        ListBankAccountInfoUsecase,
        UpdateBankAccountInfoUsecase,
        DeleteBankAccountInfoUsecase,
        BankAccountInfoService,
        BankAccountAgentCapabilitiesProvider,
        {
            provide: BANK_ACCOUNT_INFO_REPOSITORY,
            useClass: SbBankAccountInfoRepository,
        },
    ],
    exports: [BankAccountInfoService],
})
export class BankAccountInfoModule {}
