// `chat-feedback.repository.ts` statically imports `nanoid` (v5, ESM-only — no CJS build),
// which ts-jest's CommonJS transform cannot require() at test-load time (confirmed: no other
// spec in this repo imports the real module for exactly that reason). Mock it here so Jest
// never evaluates the real file; the class reference below is still what NestJS DI matches
// against AdminFeedbackController's constructor parameter type.
jest.mock("infrastructure/database/repositories/chat-feedback.repository", () => ({
    ChatFeedbackRepository: class ChatFeedbackRepository {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AdminFeedbackController } from "interface/controllers/admin-feedback.controller";
import { ChatFeedbackRepository } from "infrastructure/database/repositories/chat-feedback.repository";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("AdminFeedbackController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const BRANCH_A = "branch-a-id";
    const BRANCH_B = "branch-b-id";

    let app: INestApplication;
    let feedbackRepository: jest.Mocked<ChatFeedbackRepository>;
    // Reassignable per-test so individual tests can simulate a different caller (a different
    // branch's admin, or a session missing branchId) without re-compiling the testing module —
    // same convention as bank-account-info.controller.integration.spec.ts.
    let currentUser: { userId: string; role: string; branchId?: string };

    type FeedbackRowOverrides = Partial<{
        id: string;
        type: "positive" | "negative";
        comment: string | null;
    }>;

    const createMockFeedbackRow = (overrides: FeedbackRowOverrides = {}) => ({
        id: overrides.id ?? "feedback-1",
        type: overrides.type ?? "positive",
        comment: overrides.comment ?? "great answer",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        user: { id: "user-1", name: "Test User", email: "user@example.com" },
        chatMessage: {
            id: "message-1",
            content: "hello",
            role: "user",
            timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
        chatSession: { id: "session-1", messages: [] },
    });

    beforeEach(async () => {
        currentUser = { userId: "owner-user-id", role: "owner", branchId: BRANCH_A };

        const mockFeedbackRepository = {
            create: jest.fn(),
            findById: jest.fn(),
            findBySession: jest.fn(),
            findManyWithPagination: jest.fn(),
            getStats: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [AdminFeedbackController],
            providers: [
                {
                    provide: ChatFeedbackRepository,
                    useValue: mockFeedbackRepository,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
                    const request = context.switchToHttp().getRequest();
                    request.user = currentUser;
                    return true;
                },
            })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        feedbackRepository = moduleFixture.get(ChatFeedbackRepository);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // GET /admin/feedback - List (scoped)
    // ============================================
    describe("GET /admin/feedback", () => {
        describe("given own-branch feedback exists", () => {
            it("returns it and threads the session branch to the repository", async () => {
                // Arrange
                const row = createMockFeedbackRow({ id: "feedback-own-branch" });
                feedbackRepository.findManyWithPagination.mockResolvedValue({ data: [row] as never, total: 1 });

                // Act
                const response = await request(app.getHttpServer())
                    .get("/admin/feedback")
                    .query({ limit: 20 });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body.data).toHaveLength(1);
                expect(response.body.data[0].id).toBe("feedback-own-branch");
                expect(feedbackRepository.findManyWithPagination).toHaveBeenCalledWith(
                    expect.objectContaining({ branchId: BRANCH_A }),
                );
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("passes that caller's actual branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                feedbackRepository.findManyWithPagination.mockResolvedValue({ data: [], total: 0 });

                // Act
                await request(app.getHttpServer())
                    .get("/admin/feedback")
                    .query({ limit: 20 });

                // Assert
                expect(feedbackRepository.findManyWithPagination).toHaveBeenCalledWith(
                    expect.objectContaining({ branchId: BRANCH_B }),
                );
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("returns 403 and never calls the repository", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .get("/admin/feedback")
                    .query({ limit: 20 });

                // Assert
                expect(response.status).toBe(403);
                expect(feedbackRepository.findManyWithPagination).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // GET /admin/feedback/stats - Stats (scoped)
    // ============================================
    describe("GET /admin/feedback/stats", () => {
        describe("given own-branch feedback exists", () => {
            it("returns stats scoped to the session branch", async () => {
                // Arrange
                feedbackRepository.getStats.mockResolvedValue({ positive: 3, negative: 1, total: 4 });

                // Act
                const response = await request(app.getHttpServer()).get("/admin/feedback/stats");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({ positive: 3, negative: 1, total: 4 });
                expect(feedbackRepository.getStats).toHaveBeenCalledWith(BRANCH_A);
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("passes that caller's actual branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                feedbackRepository.getStats.mockResolvedValue({ positive: 0, negative: 0, total: 0 });

                // Act
                await request(app.getHttpServer()).get("/admin/feedback/stats");

                // Assert
                expect(feedbackRepository.getStats).toHaveBeenCalledWith(BRANCH_B);
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("returns 403 and never calls the repository", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer()).get("/admin/feedback/stats");

                // Assert
                expect(response.status).toBe(403);
                expect(feedbackRepository.getStats).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // GET /admin/feedback/:id - Detail (scoped, cross-branch -> 404)
    // ============================================
    describe("GET /admin/feedback/:id", () => {
        describe("given the feedback belongs to the caller's own branch", () => {
            it("returns the detail (positive control)", async () => {
                // Arrange
                const row = createMockFeedbackRow({ id: "feedback-own" });
                feedbackRepository.findById.mockResolvedValue(row as never);

                // Act
                const response = await request(app.getHttpServer()).get("/admin/feedback/feedback-own");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body.id).toBe("feedback-own");
                expect(feedbackRepository.findById).toHaveBeenCalledWith("feedback-own", BRANCH_A);
            });
        });

        describe("given the feedback belongs to a different branch", () => {
            it("returns 404 (repository-level scoping denies it)", async () => {
                // Arrange — a branch-scoped repository query finds nothing for a cross-branch id.
                feedbackRepository.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer()).get("/admin/feedback/feedback-cross-branch");

                // Assert
                expect(response.status).toBe(404);
                expect(feedbackRepository.findById).toHaveBeenCalledWith("feedback-cross-branch", BRANCH_A);
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("returns 403 and never calls the repository", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer()).get("/admin/feedback/feedback-own");

                // Assert
                expect(response.status).toBe(403);
                expect(feedbackRepository.findById).not.toHaveBeenCalled();
            });
        });
    });
});
