import { NotFoundException } from "@nestjs/common";

import { CreateBankAccountInfoUsecase } from "application/usecases/bank-account-info/create-bank-account-info.usecase";
import { DeleteBankAccountInfoUsecase } from "application/usecases/bank-account-info/delete-bank-account-info.usecase";
import { UpdateBankAccountInfoUsecase } from "application/usecases/bank-account-info/update-bank-account-info.usecase";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

/**
 * The branch-ownership gates on bank_account_info, tested in BOTH directions.
 *
 * A denial-only suite cannot tell a working gate from one that rejects
 * everything: making `areaBelongsToBranch` return a constant `false` — which
 * 404s every legitimate create in every branch — left the whole backend suite
 * green (305 suites / 4119 tests) when these cases did not exist. The
 * cross-branch denials themselves live in test/auth-e2e/transitive-tenant-isolation.spec.ts,
 * which needs docker and therefore only runs in CI; these are the runnable half.
 */
describe("bank_account_info branch-ownership gates", () => {
    const BRANCH_A = "branch-a";
    const OWN_AREA = "area-in-branch-a";
    const FOREIGN_AREA = "area-in-branch-b";

    let repository: jest.Mocked<IBankAccountInfoRepository>;

    beforeEach(() => {
        repository = {
            findAll: jest.fn(),
            findByArea: jest.fn(),
            areaBelongsToBranch: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        } as unknown as jest.Mocked<IBankAccountInfoRepository>;
    });

    describe("create", () => {
        let usecase: CreateBankAccountInfoUsecase;

        beforeEach(() => {
            usecase = new CreateBankAccountInfoUsecase(repository);
        });

        it("writes the row when the target area belongs to the caller's branch", async () => {
            repository.areaBelongsToBranch.mockResolvedValue(true);
            const created = new BankAccountInfoEntity(OWN_AREA, "K-Bank", "123-456");
            repository.create.mockResolvedValue(created);

            const result = await usecase.execute(OWN_AREA, "K-Bank", "123-456", BRANCH_A);

            expect(repository.areaBelongsToBranch).toHaveBeenCalledWith(OWN_AREA, BRANCH_A);
            expect(repository.create).toHaveBeenCalledTimes(1);
            expect(result).toBe(created);
        });

        it("refuses, and never writes, when the area belongs to another branch", async () => {
            repository.areaBelongsToBranch.mockResolvedValue(false);

            await expect(
                usecase.execute(FOREIGN_AREA, "K-Bank", "123-456", BRANCH_A),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(repository.create).not.toHaveBeenCalled();
        });

        it("reports 404 rather than 403, so the response does not confirm the foreign area exists", async () => {
            repository.areaBelongsToBranch.mockResolvedValue(false);

            await expect(
                usecase.execute(FOREIGN_AREA, "K-Bank", "123-456", BRANCH_A),
            ).rejects.toThrow(`Area ${FOREIGN_AREA} not found`);
        });
    });

    describe("delete", () => {
        let usecase: DeleteBankAccountInfoUsecase;

        beforeEach(() => {
            usecase = new DeleteBankAccountInfoUsecase(repository);
        });

        it("succeeds when the branch-pinned delete removed the caller's own row", async () => {
            repository.delete.mockResolvedValue(1);

            await expect(usecase.execute(OWN_AREA, BRANCH_A)).resolves.toBeUndefined();

            expect(repository.delete).toHaveBeenCalledWith(OWN_AREA, BRANCH_A);
        });

        it("reports 404 when the branch-pinned delete matched nothing", async () => {
            repository.delete.mockResolvedValue(0);

            await expect(usecase.execute(FOREIGN_AREA, BRANCH_A)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        // A count above 1 means the predicate was wider than one row — the shape a
        // dropped `undefined` areaId filter produces. Treat it as a failure, never
        // as success, so a future widening cannot report 200 over a multi-row wipe.
        it("reports 404 when the delete somehow matched more than one row", async () => {
            repository.delete.mockResolvedValue(3);

            await expect(usecase.execute(OWN_AREA, BRANCH_A)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe("update", () => {
        let usecase: UpdateBankAccountInfoUsecase;

        beforeEach(() => {
            usecase = new UpdateBankAccountInfoUsecase(repository);
        });

        it("applies the change when the row is in the caller's branch", async () => {
            const existing = new BankAccountInfoEntity(OWN_AREA, "K-Bank", "123-456");
            repository.findByArea.mockResolvedValue(existing);
            repository.update.mockImplementation(async (entity) => entity);

            const result = await usecase.execute(OWN_AREA, { bankName: "Shinhan" }, BRANCH_A);

            expect(repository.update).toHaveBeenCalledWith(
                expect.objectContaining({ area: OWN_AREA, bankName: "Shinhan" }),
                BRANCH_A,
            );
            expect(result.bankName).toBe("Shinhan");
        });

        it("reports 404 when the row is not visible in the caller's branch", async () => {
            repository.findByArea.mockResolvedValue(null);

            await expect(
                usecase.execute(FOREIGN_AREA, { bankName: "Shinhan" }, BRANCH_A),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(repository.update).not.toHaveBeenCalled();
        });

        // The ownership read and the write are two statements; the row can be
        // deleted or re-parented in between. The branch-pinned write returns null
        // in that case and must surface as 404, not as a success that did not happen.
        it("reports 404 when the branch-pinned write loses a race with the ownership read", async () => {
            repository.findByArea.mockResolvedValue(new BankAccountInfoEntity(OWN_AREA, "K-Bank", "1"));
            repository.update.mockResolvedValue(null);

            await expect(
                usecase.execute(OWN_AREA, { bankName: "Shinhan" }, BRANCH_A),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
