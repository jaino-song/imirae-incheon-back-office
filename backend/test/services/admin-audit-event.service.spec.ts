import { ConflictException } from "@nestjs/common";
import { redactAuditPayload } from "application/services/admin-audit-event.service";
import { UserService } from "application/services/user.service";
import { SystemAdminService } from "application/services/system-admin.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("admin authority invariants and audit ledger", () => {
    it("redacts credentials and personal fields before they reach the ledger", () => {
        const redacted = redactAuditPayload({
            id: "user-1",
            role: "admin",
            passwordHash: "hash",
            providerToken: "token",
            accountNumber: "1234",
            phone: "010-0000-0000",
            nested: { address: "private", ownerId: "user-1" },
        });

        expect(redacted).toEqual({
            id: "user-1",
            role: "admin",
            passwordHash: "[REDACTED]",
            providerToken: "[REDACTED]",
            accountNumber: "[REDACTED]",
            phone: "[REDACTED]",
            nested: { address: "[REDACTED]", ownerId: "user-1" },
        });
        expect(JSON.stringify(redacted)).not.toContain("hash");
        expect(JSON.stringify(redacted)).not.toContain("1234");
    });

    it("refuses deletion of the final global owner before deleting or auditing", async () => {
        const prisma = createUserPrisma({
            target: {
                id: "owner-1",
                role: "owner",
                approvalStatus: "approved",
                ownedBranches: [],
            },
            owners: [{ id: "owner-1" }],
        });
        const audit = { append: jest.fn() };
        const service = createUserService(prisma, audit);

        await expect(service.delete("owner-1", undefined, {
            userId: "owner-1",
            globalRole: "owner",
        })).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(audit.append).not.toHaveBeenCalled();
    });

    it("requires an independently authenticated successor for owner self-deletion", async () => {
        const prisma = createUserPrisma({
            target: {
                id: "owner-1",
                role: "owner",
                approvalStatus: "approved",
                ownedBranches: [],
            },
            owners: [{ id: "owner-1" }, { id: "owner-2" }],
        });
        const audit = { append: jest.fn() };
        const service = createUserService(prisma, audit);

        await expect(service.delete("owner-1", undefined, {
            userId: "owner-1",
            globalRole: "owner",
        })).rejects.toThrow("독립적으로 인증된 successor");

        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(audit.append).not.toHaveBeenCalled();
    });

    it("permits a non-final owner deletion only after the target has no branch authority", async () => {
        const prisma = createUserPrisma({
            target: {
                id: "owner-1",
                role: "owner",
                approvalStatus: "approved",
                ownedBranches: [],
            },
            owners: [{ id: "owner-1" }, { id: "owner-2" }],
        });
        const audit = { append: jest.fn().mockResolvedValue(undefined) };
        const service = createUserService(prisma, audit);

        await service.delete("owner-1", undefined, {
            userId: "owner-2",
            globalRole: "owner",
        });

        expect(audit.append).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "user.deleted",
                outcome: "success",
                targetId: "owner-1",
            }),
        );
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "owner-1" } });
    });

    it("refuses branch owner membership downgrade and removal", async () => {
        const prisma = createMembershipPrisma({ ownerId: "owner-1", membershipRole: "admin" });
        const audit = { append: jest.fn() };
        const service = createUserService(prisma, audit);
        const actor = { userId: "owner-2", globalRole: "owner", branchRole: "admin" };

        await expect(service.update("owner-1", {
            branchId: "branch-1",
            branchRole: "manager",
            callerRole: "owner",
            actor,
        })).rejects.toThrow("소유권을 먼저");
        await expect(service.delete("owner-1", "branch-1", actor)).rejects.toThrow("소유권을 먼저");

        expect(prisma.user_branch.updateMany).not.toHaveBeenCalled();
        expect(prisma.user_branch.deleteMany).not.toHaveBeenCalled();
        expect(audit.append).not.toHaveBeenCalled();
    });

    it("couples an allowed branch membership role change to one audit event", async () => {
        const user = completeUserRow({ id: "member-1", role: "manager" });
        const prisma = createMembershipPrisma({ ownerId: "owner-1", membershipRole: "manager", user });
        const audit = { append: jest.fn().mockResolvedValue(undefined) };
        const service = createUserService(prisma, audit);

        await service.update("member-1", {
            branchId: "branch-1",
            branchRole: "admin",
            callerRole: "owner",
            actor: { userId: "owner-1", globalRole: "owner", branchRole: "owner" },
        });

        expect(prisma.user_branch.updateMany).toHaveBeenCalledWith({
            where: { userId: "member-1", branchId: "branch-1" },
            data: { role: "admin" },
        });
        expect(audit.append).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: "user.membership_role.updated", outcome: "success" }),
        );
    });

    it("fails the authority mutation when audit persistence fails", async () => {
        const prisma = createMembershipPrisma({ ownerId: null, membershipRole: "manager" });
        const audit = { append: jest.fn().mockRejectedValue(new Error("audit unavailable")) };
        const service = createUserService(prisma, audit);

        await expect(service.update("member-1", {
            branchId: "branch-1",
            branchRole: "admin",
            callerRole: "owner",
            actor: { userId: "owner-1", globalRole: "owner", branchRole: "owner" },
        })).rejects.toThrow("audit unavailable");
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("serializes branch owner replacement through a row-lock query and membership upsert", async () => {
        const branch = {
            id: "branch-1",
            ownerId: "owner-1",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const prisma = createSystemAdminPrisma(branch);
        const audit = { append: jest.fn().mockResolvedValue(undefined) };
        const service = new SystemAdminService(prisma, audit as never);

        await service.updateBranch("branch-1", { ownerId: "owner-2" }, {
            userId: "owner-1",
            globalRole: "owner",
        });

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            'SELECT "id" FROM "branch" WHERE "id" = $1 FOR UPDATE',
            "branch-1",
        );
        expect(prisma.user_branch.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_branchId: { userId: "owner-2", branchId: "branch-1" } },
            update: { role: "admin" },
        }));
        expect(audit.append).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: "branch.owner_transferred", outcome: "success" }),
        );
    });
});

function completeUserRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "member-1",
        kakaoId: null,
        email: null,
        name: null,
        profileImage: null,
        role: "manager",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        passwordHash: null,
        emailVerified: true,
        emailVerifiedAt: null,
        authProvider: "email",
        ...overrides,
    };
}

function createUserService(prisma: Record<string, unknown>, audit: { append: jest.Mock }) {
    return new UserService(
        { execute: jest.fn() } as never,
        { execute: jest.fn() } as never,
        { execute: jest.fn() } as never,
        { execute: jest.fn() } as never,
        { execute: jest.fn() } as never,
        prisma as unknown as PrismaService,
        audit as never,
    );
}

function createUserPrisma(options: {
    target: Record<string, unknown>;
    owners: Array<{ id: string }>;
}) {
    const user = {
        findUnique: jest.fn()
            .mockResolvedValueOnce(options.target)
            .mockResolvedValue(options.target),
        findMany: jest.fn().mockResolvedValue(options.owners),
        delete: jest.fn().mockResolvedValue(undefined),
    };
    const prisma: any = {
        user,
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    return prisma;
}

function createMembershipPrisma(options: {
    ownerId: string | null;
    membershipRole: string;
    user?: Record<string, unknown>;
}) {
    const prisma: any = {
        branch: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: options.ownerId }),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue(options.user ?? completeUserRow()),
        },
        user_branch: {
            findUnique: jest.fn().mockResolvedValue({ role: options.membershipRole }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function createSystemAdminPrisma(branch: any) {
    const prisma: any = {
        branch: {
            findUnique: jest.fn()
                .mockResolvedValueOnce({ ownerId: branch.ownerId })
                .mockResolvedValue({
                    ...branch,
                    owner: null,
                    smsSenderApprovalStatus: "not_requested",
                    smsSenderApprovalRequestedAt: null,
                    smsSenderApprovalApprovedAt: null,
                    smsSenderApprovalRequestedBy: null,
                }),
            update: jest.fn().mockResolvedValue({ id: branch.id }),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        user: {
            findFirst: jest.fn().mockResolvedValue({ id: "owner-2", role: "manager" }),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user_branch: {
            upsert: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    return prisma as unknown as PrismaService & { $queryRawUnsafe: jest.Mock };
}
