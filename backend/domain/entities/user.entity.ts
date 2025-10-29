export class UserEntity {
    constructor(
        public readonly id: string,
        public readonly kakaoId: string,
        public email: string | null,
        public name: string | null,
        public profileImage: string | null,
        public role: string | null,
        public readonly createdAt: Date,
    ) {}

    isAdmin(): boolean {
        return this.role === "admin";
    }

    canManageDocuments(): boolean {
        return ['admin', 'manager'].includes(this.role);
    }

    updateProfile(name: string, email: string): void {
        this.name = name;
        this.email = email;
    }

    static create(kakaoId: string, name?: string, profileImage?: string, email?: string): UserEntity {
        return new UserEntity(
            '',
            kakaoId,
            email || null,
            name || null,
            profileImage || null,
            'user',
            new Date(),
        );
    }

    static fromPrisma(prismaData: { id: string, kakaoId: string, email: string | null, name: string | null, profile_image: string | null, role: string | null, created_at: Date }): UserEntity {
        return new UserEntity(
            prismaData.id,
            prismaData.kakaoId,
            prismaData.email,
            prismaData.name,
            prismaData.profile_image,
            prismaData.role || 'user',
            prismaData.created_at,
        );
    }

    toPrisma(): { id: string, kakaoId: string, email: string | null, name: string | null, profile_image: string | null, role: string | null, created_at: Date } {
        return {
            id: this.id,
            kakaoId: this.kakaoId,
            email: this.email,
            name: this.name,
            profile_image: this.profileImage,
            role: this.role,
            created_at: this.createdAt,
        };
    }
}