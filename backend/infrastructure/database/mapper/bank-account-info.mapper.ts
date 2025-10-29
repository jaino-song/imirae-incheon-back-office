import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

type BankAccountInfoRow = {
    area: string;
    bankName: string | null;
    accNum: string | null;
};

export class BankAccountInfoMapper {
    static toDomain(row: BankAccountInfoRow): BankAccountInfoEntity {
        return new BankAccountInfoEntity(row.area, row.bankName, row.accNum);
    }

    static toPrismaCreate(entity: BankAccountInfoEntity) {
        return {
            area: entity.area,
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }

    static toPrismaUpdate(entity: BankAccountInfoEntity) {
        return {
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }
}


