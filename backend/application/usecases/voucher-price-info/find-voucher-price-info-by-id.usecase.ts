import { Inject, Injectable } from "@nestjs/common";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

@Injectable()
export class FindVoucherPriceInfoByIdUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    execute(id: number): Promise<VoucherPriceInfoEntity | null> {
        return this.voucherPriceInfoRepository.findById(id);
    }
}

