import { Module } from "@nestjs/common";
import {
    CreateBankAccountInfoUsecase,
    FindBankAccountInfoByAreaUsecase,
    UpdateBankAccountInfoUsecase,
    DeleteBankAccountInfoUsecase,
} from "application/usecases/bank-account-info";
import {
    SbBankAccountInfoRepository,
} from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { BankAccountInfoController } from "interface/controllers/bank-account-info.controller";
import { BANK_ACCOUNT_INFO_REPOSITORY } from "domain/repositories/bank-account-info.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    controllers: [BankAccountInfoController],
    providers: [
        CreateBankAccountInfoUsecase,
        FindBankAccountInfoByAreaUsecase,
        UpdateBankAccountInfoUsecase,
        DeleteBankAccountInfoUsecase,
        BankAccountInfoService,
        PrismaService,
        {
            provide: BANK_ACCOUNT_INFO_REPOSITORY,
            useClass: SbBankAccountInfoRepository,
        },
    ],
    exports: [BankAccountInfoService],
})
export class BankAccountInfoModule {}