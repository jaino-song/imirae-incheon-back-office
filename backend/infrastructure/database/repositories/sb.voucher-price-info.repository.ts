import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { Injectable } from "@nestjs/common";
import { VoucherPriceInfoMapper } from "../mapper/voucher-price-info.mapper";

@Injectable()
export class SbVoucherPriceInfoRepository implements IVoucherPriceInfoRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: number): Promise<VoucherPriceInfoEntity | null> {
        const voucherPriceInfo = await this.prismaService.voucherPriceInfo.findUnique({
            where: { id },
        });
        return voucherPriceInfo ? VoucherPriceInfoMapper.toDomain(voucherPriceInfo) : null;
    }

    async findByType(type: string): Promise<VoucherPriceInfoEntity | null> {
        const voucherPriceInfo = await this.prismaService.voucherPriceInfo.findFirst({
            where: { type: type },
        });
        return voucherPriceInfo ? VoucherPriceInfoMapper.toDomain(voucherPriceInfo) : null;
    }
    
    async create(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity> {
        const created = await this.prismaService.voucherPriceInfo.create({
            data: VoucherPriceInfoMapper.toPrismaCreate(voucherPriceInfo),
        });
        return VoucherPriceInfoMapper.toDomain(created);
    }

    async update(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity> {
        const updated = await this.prismaService.voucherPriceInfo.update({
            where: { id: voucherPriceInfo.id },
            data: VoucherPriceInfoMapper.toPrismaUpdate(voucherPriceInfo),
        });
        return VoucherPriceInfoMapper.toDomain(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.voucherPriceInfo.delete({
            where: { id },
        });
    }

    async findAll(): Promise<VoucherPriceInfoEntity[]> {
        const voucherPriceInfos = await this.prismaService.voucherPriceInfo.findMany();
        return voucherPriceInfos.map(row => VoucherPriceInfoMapper.toDomain(row));
    }
}