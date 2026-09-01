import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { Injectable } from "@nestjs/common";
import { BankAccountInfoMapper } from "../mapper/bank-account-info.mapper";

// bank_account_info has no branch_id column; its branch is the owning area's.
// Every query is scoped through the nested relation filter (`area: { branchId }`)
// rooted at bank_account_info — a NON-tenant model — because a direct top-level
// query on `area` from this controller's non-TenantGuard HTTP routes would
// throw http_no_tenant under TENANT_ISOLATION_MODE=enforce
// (infrastructure/database/tenant/tenant-isolation.extension.ts).
@Injectable()
export class SbBankAccountInfoRepository implements IBankAccountInfoRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(branchId: string): Promise<BankAccountInfoEntity[]> {
        const bankAccountInfos = await this.prismaService.bank_account_info.findMany({
            where: { area: { branchId } },
        });
        return bankAccountInfos.map(BankAccountInfoMapper.toDomain);
    }

    async findByArea(area: string, branchId: string): Promise<BankAccountInfoEntity | null> {
        const bankAccountInfo = await this.prismaService.bank_account_info.findFirst({
            where: { areaId: area, area: { branchId } },
        });
        return bankAccountInfo ? BankAccountInfoMapper.toDomain(bankAccountInfo) : null;
    }

    async areaBelongsToBranch(area: string, branchId: string): Promise<boolean> {
        // Fail closed on a non-string area: `some: { id: undefined }` collapses to
        // "has ANY area", which is true for every real branch — the ownership gate
        // would answer yes for a caller that supplied no area at all.
        if (typeof area !== "string" || area.length === 0) return false;
        // Rooted at `branch` (not a tenant model) so it is safe from
        // non-TenantGuard HTTP routes under enforce; a top-level `area` query
        // here would be blocked as http_no_tenant.
        const owned = await this.prismaService.branch.findFirst({
            where: { id: branchId, areas: { some: { id: area } } },
            select: { id: true },
        });
        return owned !== null;
    }

    async create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity> {
        const created = await this.prismaService.bank_account_info.create({
            data: BankAccountInfoMapper.toPrismaCreate(bankAccountInfo),
        });
        return BankAccountInfoMapper.toDomain(created);
    }

    async update(bankAccountInfo: BankAccountInfoEntity, branchId: string): Promise<BankAccountInfoEntity | null> {
        if (typeof bankAccountInfo.area !== "string" || bankAccountInfo.area.length === 0) return null;
        // Branch-pinned in the update statement itself (not only in the caller's
        // prior findByArea) so a TOCTOU between check and write cannot rewrite
        // another branch's row. updateMany rather than update because only the
        // many-form accepts the `area: { branchId }` relation filter.
        const result = await this.prismaService.bank_account_info.updateMany({
            where: { areaId: bankAccountInfo.area, area: { branchId } },
            data: BankAccountInfoMapper.toPrismaUpdate(bankAccountInfo),
        });
        if (result.count !== 1) return null;
        return this.findByArea(bankAccountInfo.area, branchId);
    }

    async delete(area: string, branchId: string): Promise<number> {
        // An `undefined` areaId would be dropped from the filter and turn this
        // into "delete every row in the branch" — fail closed before Prisma sees it.
        if (typeof area !== "string" || area.length === 0) return 0;
        // Branch-pinned in the delete statement itself (not only in a prior
        // ownership read) so a TOCTOU between check and delete cannot remove
        // another branch's row.
        const result = await this.prismaService.bank_account_info.deleteMany({
            where: { areaId: area, area: { branchId } },
        });
        return result.count;
    }
}
