import { SbBankAccountInfoRepository } from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

describe("SbBankAccountInfoRepository", () => {
    const bankAccountModel = {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    const prisma = { bankAccountInfo: bankAccountModel } as unknown as PrismaService;

    const repository = new SbBankAccountInfoRepository(prisma);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a bank account info when findByArea finds a match", async () => {
        const row = {
            area: "Seoul",
            bankName: "K-Bank",
            accNum: "123-456-7890",
        };
        bankAccountModel.findUnique.mockResolvedValue(row);

        const result = await repository.findByArea("Seoul");

        expect(bankAccountModel.findUnique).toHaveBeenCalledWith({ where: { area: "Seoul" } });
        expect(result).toBeInstanceOf(BankAccountInfoEntity);
        expect(result).toMatchObject(row);
    });

    it("returns null when findByArea finds nothing", async () => {
        bankAccountModel.findUnique.mockResolvedValue(null);

        const result = await repository.findByArea("Busan");

        expect(bankAccountModel.findUnique).toHaveBeenCalledWith({ where: { area: "Busan" } });
        expect(result).toBeNull();
    });

    it("creates a bank account info using Prisma", async () => {
        const entity = BankAccountInfoEntity.create("Incheon", "IBK", "987-654-3210");
        const createdRow = {
            area: entity.area,
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
        bankAccountModel.create.mockResolvedValue(createdRow);

        const result = await repository.create(entity);

        expect(bankAccountModel.create).toHaveBeenCalledWith({
            data: {
                area: "Incheon",
                bankName: "IBK",
                accNum: "987-654-3210",
            },
        });
        expect(result).toMatchObject(createdRow);
    });

    it("updates a bank account info using Prisma", async () => {
        const entity = new BankAccountInfoEntity("Daegu", "Hana Bank", "111-222-3333");
        const updatedRow = {
            area: entity.area,
            bankName: "Shinhan",
            accNum: "444-555-6666",
        };
        entity.bankName = updatedRow.bankName;
        entity.accNum = updatedRow.accNum;
        bankAccountModel.update.mockResolvedValue(updatedRow);

        const result = await repository.update(entity);

        expect(bankAccountModel.update).toHaveBeenCalledWith({
            where: { area: "Daegu" },
            data: {
                bankName: "Shinhan",
                accNum: "444-555-6666",
            },
        });
        expect(result).toMatchObject(updatedRow);
    });

    it("deletes bank account info by area", async () => {
        bankAccountModel.delete.mockResolvedValue(undefined);

        await repository.delete("Daejeon");

        expect(bankAccountModel.delete).toHaveBeenCalledWith({ where: { area: "Daejeon" } });
    });
});

