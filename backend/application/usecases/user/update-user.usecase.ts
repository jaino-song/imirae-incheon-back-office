import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";

export type UpdateUserParams = {
    name?: string | null;
    email?: string | null;
    profileImage?: string | null;
    role?: string | null;
    branchRole?: string;
    callerRole?: string;
    branchId?: string;
};

@Injectable()
export class UpdateUserUsecase {
    constructor(
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
    ) {}

    async execute(id: string, updates: UpdateUserParams): Promise<UserEntity> {
        const user = updates.branchId
            ? await this.userRepository.findByIdInBranch(id, updates.branchId)
            : await this.userRepository.findById(id);
        if (!user) {
            throw new NotFoundException("User not found");
        }

        if (updates.branchId && user.role === "owner" && updates.callerRole !== "owner") {
            throw new NotFoundException("User not found");
        }

        if (updates.name !== undefined) {
            user.name = updates.name;
        }
        if (updates.email !== undefined) {
            user.email = updates.email;
        }
        if (updates.profileImage !== undefined) {
            user.profileImage = updates.profileImage;
        }
        if (updates.role !== undefined) {
            if (updates.callerRole !== "owner") {
                throw new ForbiddenException("역할 변경은 소유자만 가능합니다.");
            }
            if (user.role === "owner") {
                throw new ForbiddenException("오너 계정의 역할은 변경할 수 없습니다.");
            }
            user.role = updates.role;
            const membershipRole = updates.role === "admin" || updates.role === "manager"
                ? updates.role
                : "user";
            await this.userRepository.clearBranchOwnerships(user.id, membershipRole);
        }

        if (updates.branchId) {
            const updated = await this.userRepository.updateInBranch(
                user,
                updates.branchId,
                updates.branchRole,
            );
            if (!updated) {
                throw new NotFoundException("User not found");
            }
            return updated;
        }

        return this.userRepository.update(user);
    }
}
