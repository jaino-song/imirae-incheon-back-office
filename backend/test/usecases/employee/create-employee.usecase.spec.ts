import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { MockEmployeeRepository } from "../../utils/mocks";

describe("CreateEmployeeUsecase", () => {
    let usecase: CreateEmployeeUsecase;
    let mockRepository: MockEmployeeRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new CreateEmployeeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should create a new employee with all fields", async () => {
            // Arrange
            const name = "테스트 직원";
            const workArea = ["인천 연수구", "인천 남동구"];
            const phone = "010-1234-5678";
            const grade = "프리미엄";
            const openToNextWork = true;
            const registeredDate = new Date("2024-01-15");

            // Act
            const result = await usecase.execute(
                branchId,
                name,
                workArea,
                phone,
                grade,
                openToNextWork,
                registeredDate,
            );

            // Assert
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe("테스트 직원");
            expect(result.workArea).toEqual(["인천 연수구", "인천 남동구"]);
            expect(result.phone).toBe("010-1234-5678");
            expect(result.grade).toBe("프리미엄");
            expect(result.openToNextWork).toBe(true);
        });

        it("should create employee without registeredDate (defaults to now)", async () => {
            // Arrange
            const name = "신규 직원";
            const workArea = ["서울 강남구"];
            const phone = "010-9999-8888";
            const grade = "베스트";
            const openToNextWork = false;

            // Act
            const result = await usecase.execute(
                branchId,
                name,
                workArea,
                phone,
                grade,
                openToNextWork,
            );

            // Assert
            expect(result).toBeDefined();
            expect(result.name).toBe("신규 직원");
            expect(result.registeredDate).toBeDefined();
        });

        it("should auto-increment employee id for multiple creates", async () => {
            // Arrange & Act
            const emp1 = await usecase.execute(branchId, "직원1", ["지역A"], "010-0000-0001", "프리미엄", true);
            const emp2 = await usecase.execute(branchId, "직원2", ["지역B"], "010-0000-0002", "베스트", false);
            const emp3 = await usecase.execute(branchId, "직원3", ["지역C"], "010-0000-0003", "스탠다드", true);

            // Assert
            expect(emp1.id).toBe(1);
            expect(emp2.id).toBe(2);
            expect(emp3.id).toBe(3);
        });

        it("should handle multiple work areas", async () => {
            // Arrange
            const workAreas = ["인천 연수구", "인천 남동구", "인천 미추홀구", "인천 서구"];

            // Act
            const result = await usecase.execute(
                branchId,
                "다지역 담당",
                workAreas,
                "010-1111-2222",
                "프리미엄",
                true,
            );

            // Assert
            expect(result.workArea).toHaveLength(4);
            expect(result.workArea).toContain("인천 연수구");
            expect(result.workArea).toContain("인천 서구");
        });

        it("forwards the transaction used by an action receipt to the repository", async () => {
            const transaction = {} as never;
            const createSpy = jest.spyOn(mockRepository, "create");

            await usecase.execute(
                branchId,
                "트랜잭션 직원",
                ["서울"],
                "010-1111-3333",
                "프리미엄",
                false,
                undefined,
                undefined,
                transaction,
            );

            expect(createSpy).toHaveBeenCalledWith(branchId, expect.any(EmployeeEntity), transaction);
        });
    });
});
