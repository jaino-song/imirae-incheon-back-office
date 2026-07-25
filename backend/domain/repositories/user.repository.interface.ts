import { UserEntity } from "../entities/user.entity";

export interface IUserRepository {
    findById(id: string): Promise<UserEntity | null>;
    findByIdInBranch(id: string, branchId: string): Promise<UserEntity | null>;
    findByKakaoId(kakaoId: string): Promise<UserEntity | null>;
    findByEmail(email: string): Promise<UserEntity | null>;
    findByRoles(roles: string[]): Promise<UserEntity[]>;
    findNotificationRecipientsByBranchId(branchId: string): Promise<UserEntity[]>;
    create(user: UserEntity): Promise<UserEntity>;
    update(user: UserEntity): Promise<UserEntity>;
    updateInBranch(
        user: UserEntity,
        branchId: string,
        branchRole?: string,
    ): Promise<UserEntity | null>;
    delete(id: string): Promise<void>;
    deleteMembership(id: string, branchId: string): Promise<boolean>;
    clearBranchOwnerships(
        userId: string,
        membershipRole: "admin" | "manager" | "user",
    ): Promise<void>;
}

export const USER_REPOSITORY = 'USER_REPOSITORY';
