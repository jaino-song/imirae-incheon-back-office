import { Injectable } from "@nestjs/common";
import {
    CreateVoucherPriceInfoUsecase,
    DeleteVoucherPriceInfoUsecase,
    FindVoucherPriceInfoByIdUsecase,
    FindVoucherPriceInfoByTypeUsecase,
    ListVoucherPriceInfoUsecase,
    UpdateVoucherPriceInfoUsecase,
} from "application/usecases/voucher-price-info";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { UpdateVoucherPriceInfoParams } from "application/usecases/voucher-price-info/update-voucher-price-info.usecase";

export type CreateVoucherParams = {
    type: string;
    duration: bigint;
    fullPrice: string;
    grant: string;
    actualPrice: string;
};

@Injectable()
export class VoucherPriceInfoService {
    constructor(
        private readonly createVoucherPriceInfoUsecase: CreateVoucherPriceInfoUsecase,
        private readonly findVoucherPriceInfoByIdUsecase: FindVoucherPriceInfoByIdUsecase,
        private readonly findVoucherPriceInfoByTypeUsecase: FindVoucherPriceInfoByTypeUsecase,
        private readonly listVoucherPriceInfoUsecase: ListVoucherPriceInfoUsecase,
        private readonly updateVoucherPriceInfoUsecase: UpdateVoucherPriceInfoUsecase,
        private readonly deleteVoucherPriceInfoUsecase: DeleteVoucherPriceInfoUsecase,
    ) {}

    create(params: CreateVoucherParams): Promise<VoucherPriceInfoEntity> {
        return this.createVoucherPriceInfoUsecase.execute(
            params.type,
            params.duration,
            params.fullPrice,
            params.grant,
            params.actualPrice,
        );
    }

    findById(id: number): Promise<VoucherPriceInfoEntity | null> {
        return this.findVoucherPriceInfoByIdUsecase.execute(id);
    }

    findByType(type: string): Promise<VoucherPriceInfoEntity | null> {
        return this.findVoucherPriceInfoByTypeUsecase.execute(type);
    }

    list(): Promise<VoucherPriceInfoEntity[]> {
        return this.listVoucherPriceInfoUsecase.execute();
    }

    update(id: number, params: UpdateVoucherPriceInfoParams): Promise<VoucherPriceInfoEntity> {
        return this.updateVoucherPriceInfoUsecase.execute(id, params);
    }

    delete(id: number): Promise<void> {
        return this.deleteVoucherPriceInfoUsecase.execute(id);
    }
}

