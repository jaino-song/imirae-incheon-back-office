export class BankAccountInfoEntity {
    constructor(
        public readonly area: string,
        public bankName: string | null,
        public accNum: string | null,
    ) {}

    isComplete(): boolean {
        return !!this.bankName && !!this.accNum;
    }

    static create(area: string, bankName: string, accNum: string): BankAccountInfoEntity {
        return new BankAccountInfoEntity(area, bankName, accNum);
    }

    static fromPrisma(prismaData: { area: string, bankName: string | null, accNum: string | null }): BankAccountInfoEntity {
        return new BankAccountInfoEntity(prismaData.area, prismaData.bankName, prismaData.accNum);
    }

    toPrisma(): { area: string, bankName: string | null, accNum: string | null } {
        return {
            area: this.area,
            bankName: this.bankName,
            accNum: this.accNum,
        };
    }
}