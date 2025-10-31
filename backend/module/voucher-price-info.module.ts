import { Module } from "@nestjs/common";
import {
    CreateVoucherPriceInfoUsecase,
    DeleteVoucherPriceInfoUsecase,
    FindVoucherPriceInfoByIdUsecase,
    FindVoucherPriceInfoByTypeUsecase,
    ListVoucherPriceInfoUsecase,
    UpdateVoucherPriceInfoUsecase,
} from "application/usecases/voucher-price-info";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbVoucherPriceInfoRepository } from "infrastructure/database/repositories/sb.voucher-price-info.repository";
import { VoucherPriceInfoController } from "interface/controllers/voucher-price-info.controller";

@Module({
    controllers: [VoucherPriceInfoController],
    providers: [
        CreateVoucherPriceInfoUsecase,
        DeleteVoucherPriceInfoUsecase,
        FindVoucherPriceInfoByIdUsecase,
        FindVoucherPriceInfoByTypeUsecase,
        ListVoucherPriceInfoUsecase,
        UpdateVoucherPriceInfoUsecase,
        VoucherPriceInfoService,
        PrismaService,
        {
            provide: VOUCHER_PRICE_INFO_REPOSITORY,
            useClass: SbVoucherPriceInfoRepository,
        },
    ],
    exports: [VoucherPriceInfoService],
})
export class VoucherPriceInfoModule {}

