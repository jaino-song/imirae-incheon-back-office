import { CreateClientUsecase } from "application/usecases/client/create-client.usecase";
import { MockClientRepository } from "../../utils/mocks";

describe("CreateClientUsecase", () => {
    let usecase: CreateClientUsecase;
    let mockRepository: MockClientRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new CreateClientUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should create a new client with all fields", async () => {
            // Arrange
            const params = {
                name: "테스트 고객",
                address: "서울시 강남구",
                phone: "010-1234-5678",
                type: "A형",
                duration: 246,
                fullPrice: "1000000",
                grant: "500000",
                actualPrice: "500000",
                startDate: new Date("2024-01-01"),
                endDate: new Date("2024-12-31"),
                careCenter: false,
                voucherClient: true,
                birthday: "1990-01-01",
                dueDate: new Date("2024-03-01"),
                birthDate: null,
                serviceStatus: "active",
                breastPump: false,
                eDocId: null,
            };

            // Act
            const result = await usecase.execute(branchId, params);

            // Assert
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe("테스트 고객");
            expect(result.address).toBe("서울시 강남구");
            expect(result.phone).toBe("010-1234-5678");
            expect(result.voucherClient).toBe(true);
        });

        it("should accept a supplied duration smaller than the business-day count and persist it unchanged", async () => {
            const params = {
                name: "회차 수 고정 고객",
                address: null,
                phone: null,
                type: null,
                duration: 1,
                fullPrice: "1000",
                grant: "0",
                actualPrice: "1000",
                startDate: new Date("2024-01-02T00:00:00.000Z"),
                endDate: new Date("2024-01-05T00:00:00.000Z"),
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            const result = await usecase.execute(branchId, params);

            expect(result.duration).toBe(1);
        });

        it("should reject a complete-range duration that exceeds the business-day count before repository persistence", async () => {
            const params = {
                name: "기간 초과 고객",
                address: null,
                phone: null,
                type: null,
                duration: 5,
                fullPrice: "1000",
                grant: "0",
                actualPrice: "1000",
                startDate: new Date("2024-01-02T00:00:00.000Z"),
                endDate: new Date("2024-01-05T00:00:00.000Z"),
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            expect(() => usecase.execute(branchId, params)).toThrow(
                "duration cannot exceed the Korean business-day count (4)",
            );
            expect(mockRepository.getAllData()).toHaveLength(0);
        });

        it("should create client with minimal required fields", async () => {
            // Arrange
            const params = {
                name: "최소 정보 고객",
                address: null,
                phone: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                startDate: null,
                endDate: null,
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            // Act
            const result = await usecase.execute(branchId, params);

            // Assert
            expect(result).toBeDefined();
            expect(result.name).toBe("최소 정보 고객");
            expect(result.address).toBeNull();
        });

        it("should auto-increment client id for multiple creates", async () => {
            // Arrange
            const params1 = {
                name: "고객1",
                address: null,
                phone: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                startDate: null,
                endDate: null,
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };
            const params2 = { ...params1, name: "고객2" };

            // Act
            const client1 = await usecase.execute(branchId, params1);
            const client2 = await usecase.execute(branchId, params2);

            // Assert
            expect(client1.id).toBe(1);
            expect(client2.id).toBe(2);
        });
    });
});
