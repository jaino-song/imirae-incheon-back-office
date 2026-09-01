import { SbBankAccountInfoRepository } from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

describe("SbBankAccountInfoRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const BRANCH_ID = "branch-1";

    const createMockPrismaBankAccount = () => ({
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
    });

    const createMockPrismaBranch = () => ({
        findFirst: jest.fn(),
    });

    const createBankAccountRow = (overrides = {}) => ({
        areaId: "Seoul",
        bankName: "K-Bank",
        accNum: "123-456-7890",
        ...overrides,
    });

    let bankAccountModel: ReturnType<typeof createMockPrismaBankAccount>;
    let branchModel: ReturnType<typeof createMockPrismaBranch>;
    let prisma: PrismaService;
    let repository: SbBankAccountInfoRepository;

    beforeEach(() => {
        bankAccountModel = createMockPrismaBankAccount();
        branchModel = createMockPrismaBranch();
        prisma = { bank_account_info: bankAccountModel, branch: branchModel } as unknown as PrismaService;
        repository = new SbBankAccountInfoRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findAll — always branch-scoped via the nested relation filter
    // ============================================
    describe("findAll", () => {
        it("should query with the nested area.branchId filter", async () => {
            bankAccountModel.findMany.mockResolvedValue([createBankAccountRow()]);

            const result = await repository.findAll(BRANCH_ID);

            expect(bankAccountModel.findMany).toHaveBeenCalledWith({
                where: { area: { branchId: BRANCH_ID } },
            });
            expect(result).toHaveLength(1);
            expect(result[0]).toBeInstanceOf(BankAccountInfoEntity);
        });
    });

    // ============================================
    // findByArea — always branch-scoped via the nested relation filter
    // ============================================
    describe("findByArea", () => {
        describe("given a bank account exists for the specified area in the branch", () => {
            it("should return the mapped BankAccountInfoEntity", async () => {
                const row = createBankAccountRow();
                bankAccountModel.findFirst.mockResolvedValue(row);

                const result = await repository.findByArea("Seoul", BRANCH_ID);

                expect(bankAccountModel.findFirst).toHaveBeenCalledWith({
                    where: { areaId: "Seoul", area: { branchId: BRANCH_ID } },
                });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Seoul",
                    bankName: "K-Bank",
                    accNum: "123-456-7890",
                });
            });
        });

        describe("given no bank account exists for the specified area in the branch", () => {
            it("should return null", async () => {
                bankAccountModel.findFirst.mockResolvedValue(null);

                const result = await repository.findByArea("Busan", BRANCH_ID);

                expect(bankAccountModel.findFirst).toHaveBeenCalledWith({
                    where: { areaId: "Busan", area: { branchId: BRANCH_ID } },
                });
                expect(result).toBeNull();
            });
        });

        describe("given different area names", () => {
            it.each(["Seoul", "Incheon", "Busan", "Daegu", "Daejeon"])(
                "should query with area %s scoped to the branch",
                async (area) => {
                    bankAccountModel.findFirst.mockResolvedValue(null);

                    await repository.findByArea(area, BRANCH_ID);

                    expect(bankAccountModel.findFirst).toHaveBeenCalledWith({
                        where: { areaId: area, area: { branchId: BRANCH_ID } },
                    });
                }
            );
        });
    });

    // ============================================
    // areaBelongsToBranch — ownership check rooted at the non-tenant `branch`
    // model (a top-level `area` query would be blocked as http_no_tenant under
    // enforce from the controller's non-TenantGuard routes)
    // ============================================
    describe("areaBelongsToBranch", () => {
        it("returns true when the branch owns the area", async () => {
            branchModel.findFirst.mockResolvedValue({ id: BRANCH_ID });

            await expect(repository.areaBelongsToBranch("Seoul", BRANCH_ID)).resolves.toBe(true);

            expect(branchModel.findFirst).toHaveBeenCalledWith({
                where: { id: BRANCH_ID, areas: { some: { id: "Seoul" } } },
                select: { id: true },
            });
        });

        it("returns false when the area belongs to another branch (or does not exist)", async () => {
            branchModel.findFirst.mockResolvedValue(null);

            await expect(repository.areaBelongsToBranch("other-branch-area", BRANCH_ID)).resolves.toBe(false);
        });

        // `some: { id: undefined }` collapses to "this branch has ANY area",
        // which is true for every real branch — the ownership gate would answer
        // yes for a caller that supplied no area at all.
        it.each([undefined, "", null])("fails closed when area is %p", async (area) => {
            branchModel.findFirst.mockResolvedValue({ id: BRANCH_ID });

            await expect(
                repository.areaBelongsToBranch(area as unknown as string, BRANCH_ID),
            ).resolves.toBe(false);
            expect(branchModel.findFirst).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid BankAccountInfoEntity", () => {
            it("should persist bank account and return created entity", async () => {
                const entity = BankAccountInfoEntity.create("Incheon", "IBK", "987-654-3210");
                const createdRow = createBankAccountRow({
                    areaId: "Incheon",
                    bankName: "IBK",
                    accNum: "987-654-3210",
                });
                bankAccountModel.create.mockResolvedValue(createdRow);

                const result = await repository.create(entity);

                expect(bankAccountModel.create).toHaveBeenCalledWith({
                    data: {
                        areaId: "Incheon",
                        bankName: "IBK",
                        accNum: "987-654-3210",
                    },
                });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Incheon",
                    bankName: "IBK",
                    accNum: "987-654-3210",
                });
            });
        });

        describe("given different bank names", () => {
            it.each([
                ["K-Bank", "111-222-3333"],
                ["IBK", "444-555-6666"],
                ["Shinhan", "777-888-9999"],
                ["Hana Bank", "000-111-2222"],
            ])("should create with bankName %s and accNum %s", async (bankName, accNum) => {
                const entity = BankAccountInfoEntity.create("TestArea", bankName, accNum);
                const createdRow = createBankAccountRow({
                    areaId: "TestArea",
                    bankName: bankName,
                    accNum: accNum,
                });
                bankAccountModel.create.mockResolvedValue(createdRow);

                const result = await repository.create(entity);

                expect(bankAccountModel.create).toHaveBeenCalledWith({
                    data: {
                        areaId: "TestArea",
                        bankName: bankName,
                        accNum: accNum,
                    },
                });
                expect(result.bankName).toBe(bankName);
                expect(result.accNum).toBe(accNum);
            });
        });
    });

    // ============================================
    // update
    // ============================================
    // update — branch-pinned in the statement itself (updateMany), so a TOCTOU
    // between the caller's ownership read and this write cannot rewrite another
    // branch's row
    describe("update", () => {
        describe("given an existing BankAccountInfoEntity with changes", () => {
            it("should update through a branch-pinned updateMany, then read the row back", async () => {
                const entity = new BankAccountInfoEntity("Daegu", "Shinhan", "444-555-6666");
                const updatedRow = createBankAccountRow({
                    areaId: "Daegu",
                    bankName: "Shinhan",
                    accNum: "444-555-6666",
                });
                bankAccountModel.updateMany.mockResolvedValue({ count: 1 });
                bankAccountModel.findFirst.mockResolvedValue(updatedRow);

                const result = await repository.update(entity, BRANCH_ID);

                expect(bankAccountModel.updateMany).toHaveBeenCalledWith({
                    where: { areaId: "Daegu", area: { branchId: BRANCH_ID } },
                    data: {
                        bankName: "Shinhan",
                        accNum: "444-555-6666",
                    },
                });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Daegu",
                    bankName: "Shinhan",
                    accNum: "444-555-6666",
                });
            });
        });

        describe("given the row belongs to another branch", () => {
            it("should match nothing and return null without reading the row back", async () => {
                const entity = new BankAccountInfoEntity("Seoul", "Woori", "123-456-7890");
                bankAccountModel.updateMany.mockResolvedValue({ count: 0 });

                const result = await repository.update(entity, "branch-2");

                expect(result).toBeNull();
                expect(bankAccountModel.findFirst).not.toHaveBeenCalled();
            });
        });

        describe("given an absent area (an undefined query parameter)", () => {
            it("should refuse before Prisma sees a filter with a dropped key", async () => {
                const entity = new BankAccountInfoEntity(undefined as unknown as string, "Woori", "1");

                const result = await repository.update(entity, BRANCH_ID);

                expect(result).toBeNull();
                expect(bankAccountModel.updateMany).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // delete — branch-pinned in the statement itself (deleteMany), so a
    // cross-branch delete removes nothing regardless of any prior check
    // ============================================
    describe("delete", () => {
        it("should delete with the branch-pinned predicate and return the count", async () => {
            bankAccountModel.deleteMany.mockResolvedValue({ count: 1 });

            const deleted = await repository.delete("Daejeon", BRANCH_ID);

            expect(bankAccountModel.deleteMany).toHaveBeenCalledWith({
                where: { areaId: "Daejeon", area: { branchId: BRANCH_ID } },
            });
            expect(deleted).toBe(1);
        });

        it("should return 0 when the area's row belongs to another branch", async () => {
            bankAccountModel.deleteMany.mockResolvedValue({ count: 0 });

            const deleted = await repository.delete("other-branch-area", BRANCH_ID);

            expect(deleted).toBe(0);
        });

        // Prisma drops `undefined` where-keys, so an absent ?area= would turn
        // this statement into "delete every row in the branch". The repository
        // must refuse before the query is built, not rely on the caller.
        it.each([undefined, "", null])(
            "should delete nothing when area is %p",
            async (area) => {
                const deleted = await repository.delete(area as unknown as string, BRANCH_ID);

                expect(deleted).toBe(0);
                expect(bankAccountModel.deleteMany).not.toHaveBeenCalled();
            },
        );

        describe("given different areas", () => {
            it.each(["Seoul", "Incheon", "Busan", "Daegu"])(
                "should delete bank account for area %s scoped to the branch",
                async (area) => {
                    bankAccountModel.deleteMany.mockResolvedValue({ count: 1 });

                    await repository.delete(area, BRANCH_ID);

                    expect(bankAccountModel.deleteMany).toHaveBeenCalledWith({
                        where: { areaId: area, area: { branchId: BRANCH_ID } },
                    });
                }
            );
        });
    });
});
