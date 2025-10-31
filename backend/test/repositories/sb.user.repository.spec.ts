import { SbUserRepository } from "infrastructure/database/repositories/sb.user.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { UserEntity } from "domain/entities/user.entity";

describe("SbUserRepository", () => {
    const userModel = {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    const prisma = { user: userModel } as unknown as PrismaService;

    const repository = new SbUserRepository(prisma);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a user when findById finds a match", async () => {
        const now = new Date();
        const row = {
            id: "user-1",
            kakaoId: "kakao-1",
            email: "user@example.com",
            name: "Jane Doe",
            profile_image: "http://example.com/avatar.png",
            role: "admin",
            created_at: now,
        };
        userModel.findUnique.mockResolvedValue(row);

        const result = await repository.findById("user-1");

        expect(userModel.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
        expect(result).toBeInstanceOf(UserEntity);
        expect(result).toMatchObject({
            id: "user-1",
            kakaoId: "kakao-1",
            email: "user@example.com",
            name: "Jane Doe",
            profileImage: "http://example.com/avatar.png",
            role: "admin",
            createdAt: now,
        });
    });

    it("returns null when findById does not find a user", async () => {
        userModel.findUnique.mockResolvedValue(null);

        const result = await repository.findById("missing");

        expect(userModel.findUnique).toHaveBeenCalledWith({ where: { id: "missing" } });
        expect(result).toBeNull();
    });

    it("returns a user when findByKakaoId finds a match", async () => {
        const now = new Date();
        const row = {
            id: "user-2",
            kakaoId: "kakao-2",
            email: null,
            name: null,
            profile_image: null,
            role: null,
            created_at: now,
        };
        userModel.findUnique.mockResolvedValue(row);

        const result = await repository.findByKakaoId("kakao-2");

        expect(userModel.findUnique).toHaveBeenCalledWith({ where: { kakaoId: "kakao-2" } });
        expect(result).toBeInstanceOf(UserEntity);
        expect(result).toMatchObject({
            id: "user-2",
            kakaoId: "kakao-2",
            email: null,
            name: null,
            profileImage: null,
            role: "user",
            createdAt: now,
        });
    });

    it("creates a user using Prisma", async () => {
        const entity = new UserEntity(
            "",
            "kakao-3",
            "user3@example.com",
            "User Three",
            "http://example.com/3.png",
            "manager",
            new Date("2024-10-25T12:00:00.000Z"),
        );

        const createdRow = {
            id: "user-3",
            kakaoId: entity.kakaoId,
            email: entity.email,
            name: entity.name,
            profile_image: entity.profileImage,
            role: entity.role,
            created_at: entity.createdAt,
        };
        userModel.create.mockResolvedValue(createdRow);

        const result = await repository.create(entity);

        expect(userModel.create).toHaveBeenCalledWith({
            data: {
                kakaoId: "kakao-3",
                email: "user3@example.com",
                name: "User Three",
                profile_image: "http://example.com/3.png",
                role: "manager",
            },
        });
        expect(result).toMatchObject({
            id: "user-3",
            kakaoId: "kakao-3",
        });
    });

    it("updates a user using Prisma", async () => {
        const entity = new UserEntity(
            "user-4",
            "kakao-4",
            "user4@example.com",
            "User Four",
            "http://example.com/4.png",
            "manager",
            new Date("2024-09-01T00:00:00.000Z"),
        );

        const updatedRow = {
            id: "user-4",
            kakaoId: "kakao-4",
            email: "user4@example.com",
            name: "User Four",
            profile_image: "http://example.com/4.png",
            role: "manager",
            created_at: entity.createdAt,
        };
        userModel.update.mockResolvedValue(updatedRow);

        const result = await repository.update(entity);

        expect(userModel.update).toHaveBeenCalledWith({
            where: { id: "user-4" },
            data: {
                email: "user4@example.com",
                name: "User Four",
                profile_image: "http://example.com/4.png",
                role: "manager",
            },
        });
        expect(result).toMatchObject({
            id: "user-4",
            role: "manager",
        });
    });

    it("deletes a user by id", async () => {
        userModel.delete.mockResolvedValue(undefined);

        await repository.delete("user-5");

        expect(userModel.delete).toHaveBeenCalledWith({ where: { id: "user-5" } });
    });
});

