import { Inject, Injectable } from "@nestjs/common";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

@Injectable()
export class CreateVoucherPriceInfoUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    execute(type: string, duration: bigint, fullPrice: string, grant: string, actualPrice: string): Promise<VoucherPriceInfoEntity> {
        const voucherPriceInfo = VoucherPriceInfoEntity.create(type, duration, fullPrice, grant, actualPrice);
        return this.voucherPriceInfoRepository.create(voucherPriceInfo);
    }
}

