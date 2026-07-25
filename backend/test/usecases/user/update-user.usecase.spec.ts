import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { UpdateUserUsecase } from "application/usecases/user/update-user.usecase";
import { MockUserRepository, UserFactory } from "../../utils";

describe("UpdateUserUsecase", () => {
    let usecase: UpdateUserUsecase;
    let mockRepository: MockUserRepository;

    beforeEach(() => {
        mockRepository = new MockUserRepository();
        usecase = new UpdateUserUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should throw NotFoundException when the user does not exist", async () => {
            await expect(
                usecase.execute("missing-user", { name: "New Name" }),
            ).rejects.toThrow(NotFoundException);
        });

        it("should update non-role fields regardless of caller role", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "user" });
            mockRepository.setData([existingUser]);

            const result = await usecase.execute("user_1", {
                name: "Updated Name",
                email: "updated@example.com",
                callerRole: "admin",
            });

            expect(result.name).toBe("Updated Name");
            expect(result.email).toBe("updated@example.com");
            expect(result.role).toBe("user");
        });

        it("should allow an owner to change a user's role", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "user" });
            mockRepository.setData([existingUser]);

            const result = await usecase.execute("user_1", {
                role: "admin",
                callerRole: "owner",
            });

            expect(result.role).toBe("admin");
        });

        it("should throw ForbiddenException when a non-owner (admin) attempts to change role", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "user" });
            mockRepository.setData([existingUser]);

            await expect(
                usecase.execute("user_1", { role: "admin", callerRole: "admin" }),
            ).rejects.toThrow(ForbiddenException);

            const persisted = await mockRepository.findById("user_1");
            expect(persisted?.role).toBe("user");
        });

        it("should throw ForbiddenException when callerRole is missing and role is being changed", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "user" });
            mockRepository.setData([existingUser]);

            await expect(
                usecase.execute("user_1", { role: "admin" }),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw ForbiddenException when a non-owner attempts to clear the role (set to null)", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "admin" });
            mockRepository.setData([existingUser]);

            await expect(
                usecase.execute("user_1", { role: null, callerRole: "admin" }),
            ).rejects.toThrow(ForbiddenException);
        });

        it("should throw ForbiddenException when the target user's role is 'owner'", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "owner" });
            mockRepository.setData([existingUser]);

            await expect(
                usecase.execute("user_1", { role: "manager", callerRole: "owner" }),
            ).rejects.toThrow(ForbiddenException);

            expect(mockRepository.clearBranchOwnershipsCalls).toEqual([]);
        });

        it.each(["manager", "user"])(
            "should clear branch ownerships when an owner changes role to '%s'",
            async (role) => {
                const existingUser = UserFactory.create({ id: "user_1", role: "admin" });
                mockRepository.setData([existingUser]);

                await usecase.execute("user_1", { role, callerRole: "owner" });

                expect(mockRepository.clearBranchOwnershipsCalls).toEqual([{
                    userId: "user_1",
                    membershipRole: role,
                }]);
            },
        );

        it("should NOT call clearBranchOwnerships for non-role updates", async () => {
            const existingUser = UserFactory.create({ id: "user_1", role: "admin" });
            mockRepository.setData([existingUser]);

            await usecase.execute("user_1", {
                name: "Updated Name",
                callerRole: "owner",
            });

            expect(mockRepository.clearBranchOwnershipsCalls).toEqual([]);
        });
    });
});
