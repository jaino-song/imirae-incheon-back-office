import { NotFoundException } from "@nestjs/common";
import { ChangeEmployeeOpenStatusUsecase } from "application/usecases/employee/change-employee-open-status.usecase";
import { EmployeeTargetVersionMismatchError } from "application/usecases/employee/update-employee.usecase";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ChangeEmployeeOpenStatusUsecase", () => {
    let usecase: ChangeEmployeeOpenStatusUsecase;
    let mockRepository: MockEmployeeRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ChangeEmployeeOpenStatusUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should change status from true to false", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(branchId, 1, false);

            // Assert
            expect(result.openToNextWork).toBe(false);
        });

        it("should change status from false to true", async () => {
            // Arrange
            const employee = EmployeeFactory.createUnavailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(branchId, 1, true);

            // Assert
            expect(result.openToNextWork).toBe(true);
        });

        it("should persist the status change", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            await usecase.execute(branchId, 1, false);

            // Assert - verify persistence
            const persisted = await mockRepository.findById(branchId, 1);
            expect(persisted?.openToNextWork).toBe(false);
        });

        it("should throw NotFoundException when employee not found", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(branchId, 999, true)).rejects.toThrow(
                NotFoundException,
            );
        });

        it("should throw NotFoundException with correct message", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(branchId, 42, false)).rejects.toThrow(
                "Employee with id 42 not found",
            );
        });

        it("should not affect other employee fields", async () => {
            // Arrange
            const employee = EmployeeFactory.create({
                id: 1,
                name: "원본 이름",
                grade: "프리미엄",
                openToNextWork: true,
            });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(branchId, 1, false);

            // Assert
            expect(result.name).toBe("원본 이름");
            expect(result.grade).toBe("프리미엄");
            expect(result.openToNextWork).toBe(false);
        });

        it("should allow toggling status multiple times", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act & Assert
            let result = await usecase.execute(branchId, 1, false);
            expect(result.openToNextWork).toBe(false);

            result = await usecase.execute(branchId, 1, true);
            expect(result.openToNextWork).toBe(true);

            result = await usecase.execute(branchId, 1, false);
            expect(result.openToNextWork).toBe(false);
        });
    });

    describe("executeApprovedTarget", () => {
        it("uses the repository compare-and-set boundary", async () => {
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            const result = await usecase.executeApprovedTarget(
                branchId,
                1,
                false,
                employeeAgentTargetVersion(employee),
            );

            expect(result.openToNextWork).toBe(false);
        });

        it("returns a conflict without changing availability when the target changed", async () => {
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            await expect(usecase.executeApprovedTarget(
                branchId,
                1,
                false,
                "stale-target-version",
            )).rejects.toBeInstanceOf(EmployeeTargetVersionMismatchError);
            expect((await mockRepository.findById(branchId, 1))?.openToNextWork).toBe(true);
        });
    });
});
