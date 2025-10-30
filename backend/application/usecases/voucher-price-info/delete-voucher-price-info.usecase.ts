import { Inject, Injectable } from "@nestjs/common";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

@Injectable()
export class DeleteVoucherPriceInfoUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    async execute(id: number): Promise<void> {
        await this.voucherPriceInfoRepository.delete(id);
    }
}

