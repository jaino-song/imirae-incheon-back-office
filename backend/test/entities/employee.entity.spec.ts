import { EmployeeEntity } from "domain/entities/employee.entity";

describe("EmployeeEntity", () => {
    // ============================================
    // Test Fixtures & Helpers
    // ============================================
    const defaultParams = {
        name: "테스트 직원",
        workArea: ["인천 연수구", "인천 남동구"],
        phone: "010-1234-5678",
        grade: "프리미엄",
        openToNextWork: true,
        registeredDate: new Date("2024-01-15"),
    };

    // ============================================
    // Constructor
    // ============================================
    describe("constructor", () => {
        it("should create an instance with all properties", () => {
            // Arrange & Act
            const employee = new EmployeeEntity(
                1,
                defaultParams.name,
                defaultParams.workArea,
                defaultParams.phone,
                defaultParams.grade,
                defaultParams.openToNextWork,
                defaultParams.registeredDate,
            );

            // Assert
            expect(employee.id).toBe(1);
            expect(employee.name).toBe("테스트 직원");
            expect(employee.workArea).toEqual(["인천 연수구", "인천 남동구"]);
            expect(employee.phone).toBe("010-1234-5678");
            expect(employee.grade).toBe("프리미엄");
            expect(employee.openToNextWork).toBe(true);
            expect(employee.registeredDate).toEqual(new Date("2024-01-15"));
        });

        it("should make id readonly", () => {
            // Arrange
            const employee = new EmployeeEntity(1, "Test", [], "", "", true, new Date());

            // Assert - TypeScript prevents reassignment at compile time
            // but we verify it's properly set
            expect(employee.id).toBe(1);
        });
    });

    // ============================================
    // Static Factory Methods
    // ============================================
    describe("create (factory method)", () => {
        it("should create entity with id = 0", () => {
            // Act
            const employee = EmployeeEntity.create(
                defaultParams.name,
                defaultParams.workArea,
                defaultParams.phone,
                defaultParams.grade,
                defaultParams.openToNextWork,
                defaultParams.registeredDate,
            );

            // Assert
            expect(employee).toBeDefined();
            expect(employee.id).toBe(0);
            expect(employee.name).toBe("테스트 직원");
        });

        it("should default an omitted registeredDate to the current Korean calendar date", () => {
            jest.useFakeTimers().setSystemTime(new Date("2026-08-27T23:30:00.000Z"));
            try {
                // Act
                const employee = EmployeeEntity.create(
                    "테스트 직원",
                    ["서울"],
                    "010-0000-0000",
                    "베스트",
                    false,
                );

                // Assert: PostgreSQL DATE values are represented at UTC midnight.
                expect(employee.registeredDate).toEqual(new Date("2026-08-28T00:00:00.000Z"));
            } finally {
                jest.useRealTimers();
            }
        });

        it("should use provided registeredDate when specified", () => {
            // Arrange
            const customDate = new Date("2023-06-15");

            // Act
            const employee = EmployeeEntity.create(
                "테스트 직원",
                ["서울"],
                "010-0000-0000",
                "베스트",
                false,
                customDate,
            );

            // Assert
            expect(employee.registeredDate).toEqual(customDate);
        });

        it("should handle empty workArea array", () => {
            // Act
            const employee = EmployeeEntity.create(
                "신입 직원",
                [],
                "010-1111-2222",
                "스탠다드",
                true,
            );

            // Assert
            expect(employee.workArea).toEqual([]);
        });

        it("should handle multiple work areas", () => {
            // Arrange
            const areas = ["인천 연수구", "인천 남동구", "인천 미추홀구", "인천 서구", "인천 중구"];

            // Act
            const employee = EmployeeEntity.create(
                "다지역 담당",
                areas,
                "010-3333-4444",
                "특급",
                true,
            );

            // Assert
            expect(employee.workArea).toHaveLength(5);
            expect(employee.workArea).toContain("인천 미추홀구");
        });
    });

    describe("reconstitute (factory method)", () => {
        it("should create entity with specified id", () => {
            // Act
            const employee = EmployeeEntity.reconstitute(
                42,
                defaultParams.name,
                defaultParams.workArea,
                defaultParams.phone,
                defaultParams.grade,
                defaultParams.openToNextWork,
                defaultParams.registeredDate,
            );

            // Assert
            expect(employee.id).toBe(42);
            expect(employee.name).toBe("테스트 직원");
        });

        it("should preserve all properties from persistence", () => {
            // Arrange
            const persistedData = {
                id: 100,
                name: "DB에서 복원된 직원",
                workArea: ["부산", "대구"],
                phone: "010-5555-6666",
                grade: "특급",
                openToNextWork: false,
                registeredDate: new Date("2022-03-20"),
            };

            // Act
            const employee = EmployeeEntity.reconstitute(
                persistedData.id,
                persistedData.name,
                persistedData.workArea,
                persistedData.phone,
                persistedData.grade,
                persistedData.openToNextWork,
                persistedData.registeredDate,
            );

            // Assert
            expect(employee.id).toBe(100);
            expect(employee.name).toBe("DB에서 복원된 직원");
            expect(employee.workArea).toEqual(["부산", "대구"]);
            expect(employee.phone).toBe("010-5555-6666");
            expect(employee.grade).toBe("특급");
            expect(employee.openToNextWork).toBe(false);
            expect(employee.registeredDate).toEqual(new Date("2022-03-20"));
        });

        it("should preserve a null registeredDate from legacy persistence", () => {
            const employee = EmployeeEntity.reconstitute(
                101,
                "레거시 직원",
                ["서울"],
                "010-0000-0000",
                "베스트",
                true,
                null,
            );

            expect(employee.registeredDate).toBeNull();
        });
    });

    // ============================================
    // Business Methods
    // ============================================
    describe("isOpenToNextWork", () => {
        it("should return true when employee is available", () => {
            // Arrange
            const employee = EmployeeEntity.create(
                "가용 직원",
                ["서울"],
                "010-0000-0000",
                "프리미엄",
                true,
            );

            // Act & Assert
            expect(employee.isOpenToNextWork()).toBe(true);
        });

        it("should return false when employee is not available", () => {
            // Arrange
            const employee = EmployeeEntity.create(
                "비가용 직원",
                ["서울"],
                "010-0000-0000",
                "프리미엄",
                false,
            );

            // Act & Assert
            expect(employee.isOpenToNextWork()).toBe(false);
        });
    });

    describe("updateOpenToNextWork", () => {
        it("should change status from true to false", () => {
            // Arrange
            const employee = EmployeeEntity.create(
                "직원",
                ["서울"],
                "010-0000-0000",
                "프리미엄",
                true,
            );
            expect(employee.openToNextWork).toBe(true);

            // Act
            employee.updateOpenToNextWork(false);

            // Assert
            expect(employee.openToNextWork).toBe(false);
            expect(employee.isOpenToNextWork()).toBe(false);
        });

        it("should change status from false to true", () => {
            // Arrange
            const employee = EmployeeEntity.create(
                "직원",
                ["서울"],
                "010-0000-0000",
                "프리미엄",
                false,
            );

            // Act
            employee.updateOpenToNextWork(true);

            // Assert
            expect(employee.openToNextWork).toBe(true);
        });

        it("should allow multiple status changes", () => {
            // Arrange
            const employee = EmployeeEntity.create(
                "직원",
                ["서울"],
                "010-0000-0000",
                "프리미엄",
                true,
            );

            // Act & Assert - toggle multiple times
            employee.updateOpenToNextWork(false);
            expect(employee.openToNextWork).toBe(false);

            employee.updateOpenToNextWork(true);
            expect(employee.openToNextWork).toBe(true);

            employee.updateOpenToNextWork(false);
            expect(employee.openToNextWork).toBe(false);
        });
    });

    describe("updateProfile", () => {
        describe("partial updates", () => {
            it("should update only name when provided", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "원래 이름",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile("새 이름");

                // Assert
                expect(employee.name).toBe("새 이름");
                expect(employee.workArea).toEqual(["서울"]);
                expect(employee.phone).toBe("010-1111-1111");
                expect(employee.grade).toBe("프리미엄");
                expect(employee.openToNextWork).toBe(true);
            });

            it("should update only workArea when provided", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(undefined, ["부산", "대구"]);

                // Assert
                expect(employee.name).toBe("직원");
                expect(employee.workArea).toEqual(["부산", "대구"]);
            });

            it("should update only phone when provided", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(undefined, undefined, "010-9999-8888");

                // Assert
                expect(employee.phone).toBe("010-9999-8888");
            });

            it("should update only grade when provided", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(undefined, undefined, undefined, "특급");

                // Assert
                expect(employee.grade).toBe("특급");
            });

            it("should update only openToNextWork when provided", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(undefined, undefined, undefined, undefined, false);

                // Assert
                expect(employee.openToNextWork).toBe(false);
            });
        });

        describe("full updates", () => {
            it("should update all fields at once", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "원래 이름",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(
                    "새 이름",
                    ["부산", "대구", "광주"],
                    "010-9999-0000",
                    "특급",
                    false,
                );

                // Assert
                expect(employee.name).toBe("새 이름");
                expect(employee.workArea).toEqual(["부산", "대구", "광주"]);
                expect(employee.phone).toBe("010-9999-0000");
                expect(employee.grade).toBe("특급");
                expect(employee.openToNextWork).toBe(false);
            });
        });

        describe("edge cases", () => {
            it("should not change anything when all params are undefined", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "원래 이름",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile();

                // Assert
                expect(employee.name).toBe("원래 이름");
                expect(employee.workArea).toEqual(["서울"]);
                expect(employee.phone).toBe("010-1111-1111");
                expect(employee.grade).toBe("프리미엄");
                expect(employee.openToNextWork).toBe(true);
            });

            it("should handle empty string for name", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "원래 이름",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act - empty string is truthy as a value
                employee.updateProfile("");

                // Assert - empty string should be set (not skipped)
                expect(employee.name).toBe("");
            });

            it("should handle empty array for workArea", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울", "부산"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile(undefined, []);

                // Assert
                expect(employee.workArea).toEqual([]);
            });
        });

        describe("id immutability", () => {
            it("should not change id after updateProfile", () => {
                // Arrange
                const employee = EmployeeEntity.reconstitute(
                    42,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    new Date("2024-01-01"),
                );

                // Act
                employee.updateProfile("새 이름", ["부산"], "010-9999-9999", "특급", false);

                // Assert
                expect(employee.id).toBe(42);
            });

            it("should not change registeredDate after updateProfile", () => {
                // Arrange
                const originalDate = new Date("2024-01-01");
                const employee = EmployeeEntity.reconstitute(
                    1,
                    "직원",
                    ["서울"],
                    "010-1111-1111",
                    "프리미엄",
                    true,
                    originalDate,
                );

                // Act
                employee.updateProfile("새 이름");

                // Assert
                expect(employee.registeredDate).toEqual(originalDate);
            });
        });
    });

    // ============================================
    // Value Equality and Identity
    // ============================================
    describe("entity identity", () => {
        it("should treat entities with same id as same identity", () => {
            // Arrange
            const employee1 = EmployeeEntity.reconstitute(
                1,
                "직원 A",
                ["서울"],
                "010-1111-1111",
                "프리미엄",
                true,
                new Date("2024-01-01"),
            );
            const employee2 = EmployeeEntity.reconstitute(
                1,
                "직원 B",
                ["부산"],
                "010-2222-2222",
                "베스트",
                false,
                new Date("2024-02-01"),
            );

            // Assert - same id means same identity
            expect(employee1.id).toBe(employee2.id);
        });

        it("should treat entities with different id as different identity", () => {
            // Arrange
            const employee1 = EmployeeEntity.reconstitute(
                1,
                "직원",
                ["서울"],
                "010-1111-1111",
                "프리미엄",
                true,
                new Date("2024-01-01"),
            );
            const employee2 = EmployeeEntity.reconstitute(
                2,
                "직원",
                ["서울"],
                "010-1111-1111",
                "프리미엄",
                true,
                new Date("2024-01-01"),
            );

            // Assert - different id means different identity
            expect(employee1.id).not.toBe(employee2.id);
        });
    });
});
