import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { Injectable } from "@nestjs/common";
import { BankAccountInfoMapper } from "../mapper/bank-account-info.mapper";

@Injectable()
export class SbBankAccountInfoRepository implements IBankAccountInfoRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(branchId?: string): Promise<BankAccountInfoEntity[]> {
        const bankAccountInfos = branchId
            ? await this.prismaService.bank_account_info.findMany({ where: { area: { branchId } } })
            : await this.prismaService.bank_account_info.findMany();
        return bankAccountInfos.map(BankAccountInfoMapper.toDomain);
    }

    async findByArea(area: string, branchId?: string): Promise<BankAccountInfoEntity | null> {
        const bankAccountInfo = branchId
            ? await this.prismaService.bank_account_info.findFirst({
                where: { areaId: area, area: { branchId } },
            })
            : await this.prismaService.bank_account_info.findUnique({
                where: { areaId: area },
            });
        return bankAccountInfo ? BankAccountInfoMapper.toDomain(bankAccountInfo) : null;
    }

    async create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity> {
        const created = await this.prismaService.bank_account_info.create({
            data: BankAccountInfoMapper.toPrismaCreate(bankAccountInfo),
        });
        return BankAccountInfoMapper.toDomain(created);
    }

    async update(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity> {
        const updated = await this.prismaService.bank_account_info.update({
            where: { areaId: bankAccountInfo.area },
            data: BankAccountInfoMapper.toPrismaUpdate(bankAccountInfo),
        });
        return BankAccountInfoMapper.toDomain(updated);
    }

    async delete(area: string): Promise<void> {
        await this.prismaService.bank_account_info.delete({
            where: { areaId: area },
        });
    }
}
