import { NotFoundException } from "@nestjs/common";
import { UpdateEmployeeUsecase } from "application/usecases/employee/update-employee.usecase";
import { EmployeeTargetVersionMismatchError } from "application/usecases/employee/update-employee.usecase";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("UpdateEmployeeUsecase", () => {
    let usecase: UpdateEmployeeUsecase;
    let mockRepository: MockEmployeeRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new UpdateEmployeeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Partial Updates
        // ============================================
        describe("partial updates", () => {
            it("should update only name", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    name: "원래 이름",
                    grade: "프리미엄",
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { name: "새 이름" });

                // Assert
                expect(result.name).toBe("새 이름");
                expect(result.grade).toBe("프리미엄");
            });

            it("should update only workArea", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    workArea: ["서울"],
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { workArea: ["부산", "대구"] });

                // Assert
                expect(result.workArea).toEqual(["부산", "대구"]);
            });

            it("should update only phone", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    phone: "010-0000-0000",
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { phone: "010-9999-8888" });

                // Assert
                expect(result.phone).toBe("010-9999-8888");
            });

            it("should update only grade", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    grade: "베스트",
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { grade: "특급" });

                // Assert
                expect(result.grade).toBe("특급");
            });

            it("should update only openToNextWork", async () => {
                // Arrange
                const employee = EmployeeFactory.createAvailable({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { openToNextWork: false });

                // Assert
                expect(result.openToNextWork).toBe(false);
            });
        });

        // ============================================
        // Full Updates
        // ============================================
        describe("full updates", () => {
            it("should update all fields at once", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                const updates = {
                    name: "완전 새 이름",
                    workArea: ["새 지역1", "새 지역2"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: false,
                };

                // Act
                const result = await usecase.execute(branchId, 1, updates);

                // Assert
                expect(result.name).toBe("완전 새 이름");
                expect(result.workArea).toEqual(["새 지역1", "새 지역2"]);
                expect(result.phone).toBe("010-1234-5678");
                expect(result.grade).toBe("특급");
                expect(result.openToNextWork).toBe(false);
            });
        });

        // ============================================
        // Persistence
        // ============================================
        describe("persistence", () => {
            it("should persist updates to repository", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1, name: "원래" });
                mockRepository.setData([employee]);

                // Act
                await usecase.execute(branchId, 1, { name: "업데이트됨" });

                // Assert - verify persistence
                const persisted = await mockRepository.findById(branchId, 1);
                expect(persisted?.name).toBe("업데이트됨");
            });

            it("should not affect other employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, name: "직원1" }),
                    EmployeeFactory.create({ id: 2, name: "직원2" }),
                    EmployeeFactory.create({ id: 3, name: "직원3" }),
                ];
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 2, { name: "수정된 직원2" });

                // Assert
                const emp1 = await mockRepository.findById(branchId, 1);
                const emp2 = await mockRepository.findById(branchId, 2);
                const emp3 = await mockRepository.findById(branchId, 3);

                expect(emp1?.name).toBe("직원1");
                expect(emp2?.name).toBe("수정된 직원2");
                expect(emp3?.name).toBe("직원3");
            });
        });

        // ============================================
        // Error Handling
        // ============================================
        describe("error handling", () => {
            it("should throw NotFoundException when employee not found", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 999, { name: "새 이름" })).rejects.toThrow(
                    NotFoundException,
                );
            });

            it("should throw NotFoundException with correct message", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 42, { name: "새 이름" })).rejects.toThrow(
                    "Employee with id 42 not found",
                );
            });

            it("should not modify repository when employee not found", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);
                const originalData = mockRepository.getAllData();

                // Act
                try {
                    await usecase.execute(branchId, 999, { name: "새 이름" });
                } catch {
                    // Expected
                }

                // Assert - repository unchanged
                expect(mockRepository.getAllData()).toEqual(originalData);
            });
        });

        // ============================================
        // Edge Cases
        // ============================================
        describe("edge cases", () => {
            it("should handle empty updates object", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    name: "원래 이름",
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, {});

                // Assert - nothing should change
                expect(result.name).toBe("원래 이름");
            });

            it("should handle updating to empty workArea", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    workArea: ["서울", "부산"],
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { workArea: [] });

                // Assert
                expect(result.workArea).toEqual([]);
            });

            it("should preserve id after update", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 42 });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 42, { name: "새 이름" });

                // Assert
                expect(result.id).toBe(42);
            });

            it("should preserve registeredDate after update", async () => {
                // Arrange
                const registeredDate = new Date("2024-01-15");
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate,
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1, { name: "새 이름" });

                // Assert
                expect(result.registeredDate).toEqual(registeredDate);
            });
        });
    });

    describe("executeApprovedTarget", () => {
        it("uses the repository compare-and-set boundary", async () => {
            const employee = EmployeeFactory.create({ id: 1, name: "원래" });
            mockRepository.setData([employee]);

            const result = await usecase.executeApprovedTarget(
                branchId,
                1,
                { name: "승인된 변경" },
                employeeAgentTargetVersion(employee),
            );

            expect(result.name).toBe("승인된 변경");
        });

        it("returns a conflict without an unlocked update when the target changed", async () => {
            const employee = EmployeeFactory.create({ id: 1, name: "다른 변경" });
            mockRepository.setData([employee]);

            await expect(usecase.executeApprovedTarget(
                branchId,
                1,
                { name: "에이전트 변경" },
                "stale-target-version",
            )).rejects.toBeInstanceOf(EmployeeTargetVersionMismatchError);
            expect((await mockRepository.findById(branchId, 1))?.name).toBe("다른 변경");
        });
    });
});
