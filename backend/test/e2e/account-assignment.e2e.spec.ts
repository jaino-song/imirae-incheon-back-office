import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { UserModule } from "module/user.module";

/**
 * Account-assignment E2E — real controller, guards, service and PostgreSQL.
 *
 * This suite is intentionally disabled unless its dedicated runner sets
 * E2E_ACCOUNT_ASSIGNMENT=1 and points Prisma at a disposable database. The
 * runner creates and drops that database around this spec, so an ordinary
 * test command can never mutate a developer or shared environment.
 */

const OWNER_USER_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "10000000-0000-4000-8000-000000000002";
const BRANCH_A_ID = "20000000-0000-4000-8000-000000000001";
const BRANCH_B_ID = "20000000-0000-4000-8000-000000000002";
const SESSION_ID = "30000000-0000-4000-8000-000000000001";

const E2E_ENABLED = process.env["E2E_ACCOUNT_ASSIGNMENT"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

describeE2E("System-admin account assignment E2E", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let callerRole: "admin" | "owner";

    const ownerJwtGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = {
                userId: OWNER_USER_ID,
                role: callerRole,
            };
            return true;
        },
    };

    beforeAll(async () => {
        assertDisposableDatabaseTarget();

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TenantModule,
                UserModule,
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(ownerJwtGuard)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(
            new GlobalValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );
        await app.init();

        prisma = app.get(PrismaService);
        const now = new Date();

        await prisma.user.createMany({
            data: [
                {
                    id: OWNER_USER_ID,
                    email: "account-assignment-owner@babyjamjam.test",
                    name: "Account Assignment Owner",
                    role: "owner",
                    approvalStatus: "approved",
                    approvedAt: now,
                },
                {
                    id: TARGET_USER_ID,
                    email: "account-assignment-target@babyjamjam.test",
                    name: "Account Assignment Target",
                    role: "manager",
                    approvalStatus: "approved",
                    approvedAt: now,
                    approvedBy: OWNER_USER_ID,
                    requestedRole: "manager",
                },
            ],
        });
        await prisma.branch.createMany({
            data: [
                {
                    id: BRANCH_A_ID,
                    name: "Account Assignment A",
                    slug: "account-assignment-a",
                    ownerId: OWNER_USER_ID,
                    isActive: true,
                },
                {
                    id: BRANCH_B_ID,
                    name: "Account Assignment B",
                    slug: "account-assignment-b",
                    ownerId: OWNER_USER_ID,
                    isActive: true,
                },
            ],
        });
    });

    beforeEach(async () => {
        callerRole = "owner";
        await prisma.auth_session.deleteMany({ where: { userId: TARGET_USER_ID } });
        await prisma.user_branch.deleteMany({ where: { userId: TARGET_USER_ID } });
        await prisma.branch.updateMany({
            where: { id: { in: [BRANCH_A_ID, BRANCH_B_ID] } },
            data: { ownerId: OWNER_USER_ID },
        });
        await prisma.user.update({
            where: { id: TARGET_USER_ID },
            data: { role: "manager", tokenVersion: 0 },
        });
        await prisma.user_branch.create({
            data: {
                userId: TARGET_USER_ID,
                branchId: BRANCH_A_ID,
                role: "manager",
            },
        });
        await prisma.auth_session.create({
            data: {
                id: SESSION_ID,
                userId: TARGET_USER_ID,
                selectedBranchId: BRANCH_A_ID,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
        });
    });

    afterAll(async () => {
        if (prisma) {
            await prisma.auth_session.deleteMany({ where: { userId: TARGET_USER_ID } });
            await prisma.user_branch.deleteMany({ where: { userId: TARGET_USER_ID } });
            await prisma.branch.deleteMany({ where: { id: { in: [BRANCH_A_ID, BRANCH_B_ID] } } });
            await prisma.user.deleteMany({ where: { id: { in: [TARGET_USER_ID, OWNER_USER_ID] } } });
        }
        await app?.close();
    });

    it("updates the exact branch set and revokes active sessions", async () => {
        const response = await request(app.getHttpServer())
            .patch(`/users/${TARGET_USER_ID}/account-assignment`)
            .send({
                role: "manager",
                branchIds: [BRANCH_A_ID, BRANCH_B_ID],
                expectedRole: "manager",
                expectedBranchIds: [BRANCH_A_ID],
            });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            id: TARGET_USER_ID,
            role: "manager",
            tokenVersion: 1,
        });

        const [target, memberships, session] = await Promise.all([
            prisma.user.findUniqueOrThrow({ where: { id: TARGET_USER_ID } }),
            prisma.user_branch.findMany({
                where: { userId: TARGET_USER_ID },
                orderBy: { branchId: "asc" },
            }),
            prisma.auth_session.findUniqueOrThrow({ where: { id: SESSION_ID } }),
        ]);
        expect(target.tokenVersion).toBe(1);
        expect(memberships.map(({ branchId, role }) => ({ branchId, role }))).toEqual([
            { branchId: BRANCH_A_ID, role: "manager" },
            { branchId: BRANCH_B_ID, role: "manager" },
        ]);
        expect(session.revokedAt).not.toBeNull();
        expect(session.revokedReason).toBe("account_assignment_changed");
    });

    it("preserves retained per-branch roles when the global role changes", async () => {
        await prisma.user_branch.create({
            data: {
                userId: TARGET_USER_ID,
                branchId: BRANCH_B_ID,
                role: "admin",
            },
        });

        const response = await request(app.getHttpServer())
            .patch(`/users/${TARGET_USER_ID}/account-assignment`)
            .send({
                role: "user",
                branchIds: [BRANCH_A_ID, BRANCH_B_ID],
                expectedRole: "manager",
                expectedBranchIds: [BRANCH_A_ID, BRANCH_B_ID],
            });

        expect(response.status).toBe(200);
        const memberships = await prisma.user_branch.findMany({
            where: { userId: TARGET_USER_ID },
            orderBy: { branchId: "asc" },
            select: { branchId: true, role: true },
        });
        expect(memberships).toEqual([
            { branchId: BRANCH_A_ID, role: "manager" },
            { branchId: BRANCH_B_ID, role: "admin" },
        ]);
    });

    it("rejects a stale admin-demotion snapshot with no durable residue", async () => {
        await prisma.user.update({
            where: { id: TARGET_USER_ID },
            data: { role: "admin" },
        });
        await prisma.user_branch.updateMany({
            where: { userId: TARGET_USER_ID },
            data: { role: "admin" },
        });
        await prisma.branch.update({
            where: { id: BRANCH_A_ID },
            data: { ownerId: TARGET_USER_ID },
        });
        const before = await readTargetState(prisma);

        const response = await request(app.getHttpServer())
            .patch(`/users/${TARGET_USER_ID}/account-assignment`)
            .send({
                role: "user",
                branchIds: [BRANCH_B_ID],
                expectedRole: "admin",
                expectedBranchIds: [BRANCH_B_ID],
            });

        expect(response.status).toBe(409);
        expect(await readTargetState(prisma)).toEqual(before);
    });

    it("rejects a non-owner caller with no durable residue", async () => {
        callerRole = "admin";
        const before = await readTargetState(prisma);

        const response = await request(app.getHttpServer())
            .patch(`/users/${TARGET_USER_ID}/account-assignment`)
            .send({
                role: "user",
                branchIds: [BRANCH_B_ID],
                expectedRole: "manager",
                expectedBranchIds: [BRANCH_A_ID],
            });

        expect(response.status).toBe(403);
        expect(await readTargetState(prisma)).toEqual(before);
    });

    it("treats an identical assignment as a semantic no-op", async () => {
        const before = await readTargetState(prisma);

        const response = await request(app.getHttpServer())
            .patch(`/users/${TARGET_USER_ID}/account-assignment`)
            .send({
                role: "manager",
                branchIds: [BRANCH_A_ID],
                expectedRole: "manager",
                expectedBranchIds: [BRANCH_A_ID],
            });

        expect(response.status).toBe(200);
        expect(response.body.tokenVersion).toBe(0);
        expect(await readTargetState(prisma)).toEqual(before);
    });

    it("rejects a malformed target id before touching account state", async () => {
        const before = await readTargetState(prisma);

        const response = await request(app.getHttpServer())
            .patch("/users/not-a-uuid/account-assignment")
            .send({
                role: "manager",
                branchIds: [BRANCH_A_ID],
                expectedRole: "manager",
                expectedBranchIds: [BRANCH_A_ID],
            });

        expect(response.status).toBe(400);
        expect(await readTargetState(prisma)).toEqual(before);
    });
});

async function readTargetState(prisma: PrismaService) {
    const [target, memberships, session, branches] = await Promise.all([
        prisma.user.findUniqueOrThrow({
            where: { id: TARGET_USER_ID },
            select: { role: true, tokenVersion: true },
        }),
        prisma.user_branch.findMany({
            where: { userId: TARGET_USER_ID },
            orderBy: { branchId: "asc" },
            select: { branchId: true, role: true },
        }),
        prisma.auth_session.findUniqueOrThrow({
            where: { id: SESSION_ID },
            select: { revokedAt: true, revokedReason: true },
        }),
        prisma.branch.findMany({
            where: { id: { in: [BRANCH_A_ID, BRANCH_B_ID] } },
            orderBy: { id: "asc" },
            select: { id: true, ownerId: true },
        }),
    ]);

    return { target, memberships, session, branches };
}

function assertDisposableDatabaseTarget(): void {
    const expectedDatabaseName = process.env["E2E_ACCOUNT_ASSIGNMENT_DB_NAME"];
    if (
        !expectedDatabaseName
        || !/^bjj_account_assignment_e2e_[0-9]+_[0-9a-f]{12}$/.test(expectedDatabaseName)
    ) {
        throw new Error("Refusing account-assignment E2E without a valid disposable database name");
    }

    for (const variableName of ["DATABASE_URL", "DIRECT_URL"] as const) {
        const rawUrl = process.env[variableName];
        if (!rawUrl) {
            throw new Error(`Refusing account-assignment E2E without ${variableName}`);
        }

        const parsedUrl = new URL(rawUrl);
        const actualDatabaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
        if (
            parsedUrl.protocol !== "postgresql:"
            || parsedUrl.hostname !== "localhost"
            || parsedUrl.port !== "5432"
            || parsedUrl.username !== "postgres"
            || actualDatabaseName !== expectedDatabaseName
        ) {
            throw new Error(
                `Refusing account-assignment E2E against unsafe ${variableName} target`,
            );
        }
    }
}
