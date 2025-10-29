export class VoucherPriceInfoEntity {
    constructor(
        public readonly id: number,
        public type: string | null,
        public duration: bigint | null,
        public fullPrice: string | null,
        public grant: string | null,
        public actualPrice: string | null,
    ) {}

    static create(
        type: string,
        duration: bigint,
        fullPrice: string,
        grant: string,
        actualPrice: string,
    ): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            0,
            type,
            duration,
            fullPrice,
            grant,
            actualPrice,
        );
    }

    static fromPrisma(prismaData: { id: number, type: string | null, duration: bigint | null, fullPrice: string | null, grant: string | null, actualPrice: string | null }): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            prismaData.id,
            prismaData.type,
            prismaData.duration,
            prismaData.fullPrice,
            prismaData.grant,
            prismaData.actualPrice,
        );
    }

    // Prepare this entity into this shape to be saved to the database
    toPersistence(): { id: number, type: string | null, duration: bigint | null, fullPrice: string | null, grant: string | null, actualPrice: string | null } {
        return {
            id: this.id,
            type: this.type,
            duration: this.duration,
            fullPrice: this.fullPrice,
            grant: this.grant,
            actualPrice: this.actualPrice,
        };
    }
}
