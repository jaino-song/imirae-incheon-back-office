import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UpdateClientUsecase } from "application/usecases/client/update-client.usecase";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("UpdateClientUsecase", () => {
    let usecase: UpdateClientUsecase;
    let mockRepository: MockClientRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new UpdateClientUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should update client name", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "기존 이름" });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, { name: "변경된 이름" });

            // Assert
            expect(result.name).toBe("변경된 이름");
        });

        it("should update multiple fields", async () => {
            // Arrange
            const existingClient = ClientFactory.create({
                id: 1,
                name: "고객",
                address: "기존 주소",
                phone: "010-0000-0000",
            });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, {
                address: "새 주소",
                phone: "010-1111-1111",
                serviceStatus: "completed",
            });

            // Assert
            expect(result.address).toBe("새 주소");
            expect(result.phone).toBe("010-1111-1111");
            expect(result.serviceStatus).toBe("completed");
            expect(result.name).toBe("고객"); // 변경 안 됨
        });

        it("should update dueDate", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "고객", dueDate: null });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, {
                dueDate: new Date("2024-03-01"),
            });

            // Assert
            expect(result.dueDate).toEqual(new Date("2024-03-01"));
        });

        it("should set birthDate", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "고객", birthDate: null });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, {
                birthDate: new Date("1995-03-15"),
            });

            // Assert
            expect(result.birthDate).toEqual(new Date("1995-03-15"));
        });

        it("should clear birthDate when explicitly set to null (tri-state, mirrors areaId)", async () => {
            // Arrange
            const existingClient = ClientFactory.create({
                id: 1,
                name: "고객",
                birthDate: new Date("1995-03-15"),
            });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, { birthDate: null });

            // Assert
            expect(result.birthDate).toBeNull();
        });

        it("should leave birthDate untouched when omitted from the update", async () => {
            // Arrange
            const existingClient = ClientFactory.create({
                id: 1,
                name: "고객",
                birthDate: new Date("1995-03-15"),
            });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(branchId, 1, { name: "새 이름" });

            // Assert
            expect(result.birthDate).toEqual(new Date("1995-03-15"));
        });

        it.each([
            "address",
            "phone",
            "type",
            "fullPrice",
            "grant",
            "actualPrice",
            "startDate",
            "endDate",
            "careCenter",
            "birthday",
            "dueDate",
            "birthDate",
            "serviceStatus",
            "eDocId",
            "areaId",
        ])("should clear nullable %s only when null is explicitly supplied", async (field) => {
            const existingClient = ClientFactory.create({ id: 1, birthDate: new Date("1995-03-15") });
            mockRepository.setData([existingClient]);

            const result = await usecase.execute(branchId, 1, { [field]: null } as never);

            expect((result as unknown as Record<string, unknown>)[field]).toBeNull();
        });

        it("should reject clearing duration when the service period is complete", async () => {
            const existingClient = ClientFactory.create({ id: 1 });
            mockRepository.setData([existingClient]);

            await expect(usecase.execute(branchId, 1, { duration: null }))
                .rejects.toThrow("duration cannot exceed the Korean business-day count (246)");

            expect(mockRepository.getAllData()[0]).toBe(existingClient);
            expect(mockRepository.getAllData()[0]?.duration).toBe(15);
        });

        it.each(["name", "voucherClient", "breastPump"])(
            "should reject null for non-nullable %s before repository mutation",
            async (field) => {
                const existingClient = ClientFactory.create({ id: 1 });
                mockRepository.setData([existingClient]);

                await expect(usecase.execute(branchId, 1, { [field]: null } as never))
                    .rejects.toBeInstanceOf(BadRequestException);

                expect(mockRepository.getAllData()[0]).toBe(existingClient);
            },
        );

        it("should throw NotFoundException when client not found", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(
                usecase.execute(branchId, 999, { name: "새 이름" }),
            ).rejects.toThrow(NotFoundException);
        });

        it("should throw NotFoundException with correct message", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(
                usecase.execute(branchId, 123, { name: "새 이름" }),
            ).rejects.toThrow("Client with id 123 not found");
        });

        it("should persist changes to repository", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "원본" });
            mockRepository.setData([existingClient]);

            // Act
            await usecase.execute(branchId, 1, { name: "수정됨" });

            // Assert - verify persistence
            const persisted = await mockRepository.findById(branchId, 1);
            expect(persisted?.name).toBe("수정됨");
        });
    });
});
