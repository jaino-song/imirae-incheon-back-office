import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

export type UpdateVoucherPriceInfoParams = {
    type?: string | null;
    duration?: bigint | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
};

@Injectable()
export class UpdateVoucherPriceInfoUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    async execute(id: number, updates: UpdateVoucherPriceInfoParams): Promise<VoucherPriceInfoEntity> {
        const voucherPriceInfo = await this.voucherPriceInfoRepository.findById(id);
        if (!voucherPriceInfo) {
            throw new NotFoundException(`Voucher price info with id ${id} not found`);
        }

        if (updates.type !== undefined) {
            voucherPriceInfo.type = updates.type;
        }
        if (updates.duration !== undefined) {
            voucherPriceInfo.duration = updates.duration;
        }
        if (updates.fullPrice !== undefined) {
            voucherPriceInfo.fullPrice = updates.fullPrice;
        }
        if (updates.grant !== undefined) {
            voucherPriceInfo.grant = updates.grant;
        }
        if (updates.actualPrice !== undefined) {
            voucherPriceInfo.actualPrice = updates.actualPrice;
        }

        return this.voucherPriceInfoRepository.update(voucherPriceInfo);
    }
}

