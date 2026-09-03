import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { clearSchemaCapabilityCache } from "infrastructure/database/schema-capabilities";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("DeleteClientUsecase", () => {
    // ============================================
    // Basic contract (in-memory MockClientRepository)
    // ============================================
    describe("execute (against IClientRepository contract)", () => {
        let usecase: DeleteClientUsecase;
        let mockRepository: MockClientRepository;
        const branchId = "org-1";

        beforeEach(() => {
            mockRepository = new MockClientRepository();
            usecase = new DeleteClientUsecase(mockRepository);
        });

        afterEach(() => {
            mockRepository.reset();
        });

        it("should delete existing client", async () => {
            const existingClient = ClientFactory.create({ id: 1 });
            mockRepository.setData([existingClient]);

            await usecase.execute(branchId, 1);

            const result = await mockRepository.findById(branchId, 1);
            expect(result).toBeNull();
        });

        it("should throw NotFoundException when client not found", async () => {
            await expect(usecase.execute(branchId, 999)).rejects.toThrow(NotFoundException);
        });

        it("should throw NotFoundException with correct message", async () => {
            await expect(usecase.execute(branchId, 42)).rejects.toThrow(
                "고객을 찾을 수 없습니다. (id: 42)",
            );
        });

        it("should not affect other clients when deleting", async () => {
            const clients = ClientFactory.createMany(3);
            mockRepository.setData(clients);

            await usecase.execute(branchId, 2);

            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(2);
            expect(remaining.map((c) => c.id)).toEqual([1, 3]);
        });

        it("should allow deleting all clients one by one", async () => {
            const clients = ClientFactory.createMany(2);
            mockRepository.setData(clients);

            await usecase.execute(branchId, 1);
            await usecase.execute(branchId, 2);

            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(0);
        });
    });

    // ============================================
    // Physical client deletion preserves completed electronic-document history.
    // The database owns the SetNull behavior; the repository must not inspect or
    // delete service_record_case rows before deleting the tenant-scoped client.
    // ============================================
    describe("execute (against SbClientRepository + mocked PrismaService)", () => {
        const branchId = "org-1";
        const clientId = 5;

        let clientModel: { findFirst: jest.Mock; deleteMany: jest.Mock };
        let transactionQueryRaw: jest.Mock;
        let serviceRecordCaseModel: { findUnique: jest.Mock; delete: jest.Mock };
        let serviceRecordDayModel: { count: jest.Mock };
        let prisma: PrismaService;
        let repository: SbClientRepository;
        let usecase: DeleteClientUsecase;

        const clientRow = () => ({
            id: clientId,
            name: "Jane Doe",
            address: "Seoul",
            phone: "010-1111-2222",
            type: "A",
            duration: 15,
            fullPrice: "100000",
            grant: "50000",
            actualPrice: "50000",
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
            careCenter: true,
            voucherClient: false,
            birthday: "900101",
            serviceStatus: "completed",
            breastPump: true,
            eDocId: null,
            dueDate: null,
            branchId,
        });

        beforeEach(() => {
            clearSchemaCapabilityCache();

            clientModel = { findFirst: jest.fn(), deleteMany: jest.fn() };
            transactionQueryRaw = jest.fn()
                .mockResolvedValueOnce([{ id: clientId }])
                .mockResolvedValue([{ count: 0 }]);
            serviceRecordCaseModel = { findUnique: jest.fn(), delete: jest.fn() };
            serviceRecordDayModel = { count: jest.fn() };
            prisma = {
                client: clientModel,
                service_record_case: serviceRecordCaseModel,
                service_record_day: serviceRecordDayModel,
                $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
                $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
                    callback({ client: clientModel, $queryRaw: transactionQueryRaw })),
            } as unknown as PrismaService;

            repository = new SbClientRepository(prisma);
            usecase = new DeleteClientUsecase(repository);

            clientModel.findFirst.mockResolvedValue(clientRow());
        });

        it("deletes the client without touching its completed service-record case", async () => {
            clientModel.deleteMany.mockResolvedValue({ count: 1 });

            await usecase.execute(branchId, clientId);

            expect(clientModel.deleteMany).toHaveBeenCalledWith({
                where: { id: clientId, branchId },
            });
            expect(serviceRecordCaseModel.findUnique).not.toHaveBeenCalled();
            expect(serviceRecordCaseModel.delete).not.toHaveBeenCalled();
            expect(serviceRecordDayModel.count).not.toHaveBeenCalled();
        });

        it("deletes the client directly when it has no electronic-document history", async () => {
            clientModel.deleteMany.mockResolvedValue({ count: 1 });

            await usecase.execute(branchId, clientId);

            expect(clientModel.deleteMany).toHaveBeenCalledWith({
                where: { id: clientId, branchId },
            });
        });

        it("converts a residual P2003 foreign key violation into a coded safe 409", async () => {
            clientModel.deleteMany.mockRejectedValue(
                new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
                    code: "P2003",
                    clientVersion: "test",
                }),
            );

            const error = await usecase.execute(branchId, clientId).catch((caught) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getResponse()).toEqual({
                code: "CLIENT_RETENTION_BLOCKED",
                message: "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.",
            });
        });

        it("rethrows unrelated errors untouched", async () => {
            clientModel.deleteMany.mockRejectedValue(new Error("boom"));

            await expect(usecase.execute(branchId, clientId)).rejects.toThrow("boom");
        });
    });
});
