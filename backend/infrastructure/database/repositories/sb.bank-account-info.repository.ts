import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { Injectable } from "@nestjs/common";
import { BankAccountInfoMapper } from "../mapper/bank-account-info.mapper";

@Injectable()
export class SbBankAccountInfoRepository implements IBankAccountInfoRepository {
    constructor(private prismaService: PrismaService) {}

    async findByArea(area: string): Promise<BankAccountInfoEntity | null> {
        const bankAccountInfo = await this.prismaService.bankAccountInfo.findUnique({
            where: { area },
        });
        return bankAccountInfo ? BankAccountInfoMapper.toDomain(bankAccountInfo) : null;
    }

    async create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity> {
        const created = await this.prismaService.bankAccountInfo.create({
            data: BankAccountInfoMapper.toPrismaCreate(bankAccountInfo),
        });
        return BankAccountInfoMapper.toDomain(created);
    }

    async update(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity> {
        const updated = await this.prismaService.bankAccountInfo.update({
            where: { area: bankAccountInfo.area },
            data: BankAccountInfoMapper.toPrismaUpdate(bankAccountInfo),
        });
        return BankAccountInfoMapper.toDomain(updated);
    }

    async delete(area: string): Promise<void> {
        await this.prismaService.bankAccountInfo.delete({
            where: { area },
        });
    }
}