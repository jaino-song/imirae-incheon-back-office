import { Inject, Injectable } from "@nestjs/common";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

@Injectable()
export class ListVoucherPriceInfoUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    execute(): Promise<VoucherPriceInfoEntity[]> {
        return this.voucherPriceInfoRepository.findAll();
    }
}

