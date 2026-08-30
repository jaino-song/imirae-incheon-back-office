import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

export interface IBankAccountInfoRepository {
    findAll(branchId?: string): Promise<BankAccountInfoEntity[]>;
    findByArea(area: string, branchId?: string): Promise<BankAccountInfoEntity | null>;
    create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    update(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    delete(area: string): Promise<void>;
}

export const BANK_ACCOUNT_INFO_REPOSITORY = 'BANK_ACCOUNT_INFO_REPOSITORY';
