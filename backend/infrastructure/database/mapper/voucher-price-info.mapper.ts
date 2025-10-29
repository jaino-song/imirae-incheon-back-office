import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";

type VoucherPriceInfoRow = {
    id: number;
    type: string | null;
    duration: bigint | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
};

export class VoucherPriceInfoMapper {
    static toDomain(row: VoucherPriceInfoRow): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            row.id,
            row.type,
            row.duration,
            row.fullPrice,
            row.grant,
            row.actualPrice,
        );
    }

    static toPrismaCreate(entity: VoucherPriceInfoEntity) {
        return {
            id: entity.id,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
    }

    static toPrismaUpdate(entity: VoucherPriceInfoEntity) {
        return {
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
    }
}


