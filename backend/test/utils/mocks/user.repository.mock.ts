import { UserEntity } from "domain/entities/user.entity";
import { IUserRepository } from "domain/repositories/user.repository.interface";

/**
 * 테스트용 Mock User Repository
 * In-memory 저장소로 동작하며, 테스트 간 독립성 보장
 */
export class MockUserRepository implements IUserRepository {
    private users: Map<string, UserEntity> = new Map();
    private userIdCounter: number = 1;
    clearBranchOwnershipsCalls: Array<{
        userId: string;
        membershipRole: "admin" | "manager" | "user";
    }> = [];

    /**
     * 테스트 데이터 초기화
     */
    reset(): void {
        this.users.clear();
        this.userIdCounter = 1;
        this.clearBranchOwnershipsCalls = [];
    }

    /**
     * 테스트 데이터 직접 설정
     */
    setData(users: UserEntity[]): void {
        this.users.clear();
        users.forEach(user => {
            this.users.set(user.id, user);
        });
    }

    /**
     * 저장된 모든 데이터 조회 (테스트 검증용)
     */
    getAllData(): UserEntity[] {
        return Array.from(this.users.values());
    }

    async findById(id: string): Promise<UserEntity | null> {
        return this.users.get(id) ?? null;
    }

    async findByIdInBranch(id: string, _branchId: string): Promise<UserEntity | null> {
        return this.findById(id);
    }

    async findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        return (
            Array.from(this.users.values()).find(
                user => user.kakaoId === kakaoId,
            ) ?? null
        );
    }

    async findByEmail(email: string): Promise<UserEntity | null> {
        return (
            Array.from(this.users.values()).find(
                user => user.email === email,
            ) ?? null
        );
    }

    async create(user: UserEntity): Promise<UserEntity> {
        // ID가 없으면 자동 생성
        const id = user.id || `user_test_${this.userIdCounter++}`;
        const newUser = UserEntity.reconstitute(
            id,
            user.kakaoId,
            user.email,
            user.name,
            user.profileImage,
            user.role,
            user.createdAt,
            user.passwordHash,
            user.emailVerified,
            user.emailVerifiedAt,
            user.authProvider,
        );
        this.users.set(id, newUser);
        return newUser;
    }

    async update(user: UserEntity): Promise<UserEntity> {
        if (!this.users.has(user.id)) {
            throw new Error(`User with id ${user.id} not found`);
        }
        this.users.set(user.id, user);
        return user;
    }

    async updateInBranch(
        user: UserEntity,
        _branchId: string,
        _branchRole?: string,
    ): Promise<UserEntity | null> {
        return this.update(user);
    }

    async delete(id: string): Promise<void> {
        if (!this.users.has(id)) {
            throw new Error(`User with id ${id} not found`);
        }
        this.users.delete(id);
    }

    async deleteMembership(id: string, _branchId: string): Promise<boolean> {
        return this.users.has(id);
    }

    async clearBranchOwnerships(
        userId: string,
        membershipRole: "admin" | "manager" | "user",
    ): Promise<void> {
        this.clearBranchOwnershipsCalls.push({ userId, membershipRole });
    }

    async findByRoles(roles: string[]): Promise<UserEntity[]> {
        return Array.from(this.users.values()).filter(
            user => user.role !== null && roles.includes(user.role),
        );
    }

    async findNotificationRecipientsByBranchId(_branchId: string): Promise<UserEntity[]> {
        return Array.from(this.users.values());
    }
}
