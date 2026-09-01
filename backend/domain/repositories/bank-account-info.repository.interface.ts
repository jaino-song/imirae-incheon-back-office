import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

// branchId is REQUIRED on every read/write reachable from HTTP: an optional
// parameter here would make the branch scoping fail open by signature — a
// caller that forgets the argument silently gets an unscoped query.
export interface IBankAccountInfoRepository {
    findAll(branchId: string): Promise<BankAccountInfoEntity[]>;
    findByArea(area: string, branchId: string): Promise<BankAccountInfoEntity | null>;
    /** Ownership check for create: does this area belong to this branch? */
    areaBelongsToBranch(area: string, branchId: string): Promise<boolean>;
    create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    /** Branch-pinned update; null when no row in this branch matched. */
    update(bankAccountInfo: BankAccountInfoEntity, branchId: string): Promise<BankAccountInfoEntity | null>;
    /** Branch-pinned delete; returns the number of rows removed (0 or 1). */
    delete(area: string, branchId: string): Promise<number>;
}

export const BANK_ACCOUNT_INFO_REPOSITORY = 'BANK_ACCOUNT_INFO_REPOSITORY';
