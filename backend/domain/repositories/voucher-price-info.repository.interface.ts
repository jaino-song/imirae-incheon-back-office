import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";

export interface IVoucherPriceInfoRepository {
    findById(id: number): Promise<VoucherPriceInfoEntity | null>;
    findByType(type: string): Promise<VoucherPriceInfoEntity | null>;
    create(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity>;
    update(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity>;
    delete(id: number): Promise<void>;
    findAll(): Promise<VoucherPriceInfoEntity[]>;
}

export const VOUCHER_PRICE_INFO_REPOSITORY = 'VOUCHER_PRICE_INFO_REPOSITORY';