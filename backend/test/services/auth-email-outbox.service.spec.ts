import { AuthEmailOutboxService } from "application/services/auth-email-outbox.service";
import { AuthEmailTokenService } from "application/services/auth-email-token.service";
import { EmailPort } from "domain/ports/email.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

const OUTBOX_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN_ID = "22222222-2222-2222-2222-222222222222";
const IDEMPOTENCY_KEY = "auth-email:attempt-key";

type ClaimedEmailFixture = {
    id: string;
    auth_token_id: string;
    kind: string;
    recipient: string;
    name: string | null;
    attempts: number;
    attempt_version: number;
    provider_idempotency_key: string;
};

const claimedEmail = (overrides: Partial<ClaimedEmailFixture> = {}): ClaimedEmailFixture => ({
    id: OUTBOX_ID,
    auth_token_id: TOKEN_ID,
    kind: "email_verification",
    recipient: "member@example.com",
    name: "Member",
    attempts: 1,
    attempt_version: 1,
    provider_idempotency_key: IDEMPOTENCY_KEY,
    ...overrides,
});

describe("AuthEmailOutboxService provider boundary", () => {
    const prisma = {
        $transaction: jest.fn(),
        $executeRaw: jest.fn(),
        $queryRaw: jest.fn(),
        auth_email_outbox: {
            updateMany: jest.fn(),
        },
    };
    const email = {
        send: jest.fn(),
        sendVerificationEmail: jest.fn(),
        sendPasswordResetEmail: jest.fn(),
    } satisfies jest.Mocked<EmailPort>;
    const tokens = {
        publicTokenForId: jest.fn().mockReturnValue("public-token.signature"),
    };
    let service: AuthEmailOutboxService;

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
        prisma.$executeRaw.mockResolvedValue(0);
        service = new AuthEmailOutboxService(
            prisma as unknown as PrismaService,
            tokens as unknown as AuthEmailTokenService,
            email,
            createSchedulerLeaseMock(),
        );
    });

    it("keeps an accepted provider result uncertain when local completion fails and does not resend after restart", async () => {
        const item = claimedEmail();
        prisma.$queryRaw
            .mockResolvedValueOnce([item])
            .mockResolvedValueOnce([{ id: item.id }])
            .mockResolvedValueOnce([]);
        email.sendVerificationEmail.mockResolvedValue("provider-message-1");
        prisma.auth_email_outbox.updateMany
            .mockRejectedValueOnce(new Error("local commit failed"))
            .mockResolvedValueOnce({ count: 1 });

        await service.deliverPending();

        expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
        expect(email.sendVerificationEmail).toHaveBeenCalledWith(
            item.recipient,
            item.name,
            expect.stringContaining("/verify-email?token="),
            { idempotencyKey: IDEMPOTENCY_KEY },
        );
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: expect.objectContaining({
                    id: OUTBOX_ID,
                    status: "started",
                    attemptVersion: 1,
                    providerIdempotencyKey: IDEMPOTENCY_KEY,
                }),
                data: expect.objectContaining({ status: "accepted" }),
            }),
        );
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: expect.objectContaining({
                    id: OUTBOX_ID,
                    status: "started",
                    attemptVersion: 1,
                    providerIdempotencyKey: IDEMPOTENCY_KEY,
                }),
                data: expect.objectContaining({
                    status: "uncertain",
                    providerMessageId: "provider-message-1",
                    errorCode: "provider_uncertain",
                }),
            }),
        );

        await service.deliverPending();

        expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it("cannot complete a stale attempt after a newer attempt owns the row", async () => {
        const staleAttempt = claimedEmail({ attempt_version: 1 });
        prisma.$queryRaw.mockResolvedValueOnce([{ id: staleAttempt.id }]);
        prisma.auth_email_outbox.updateMany.mockResolvedValue({ count: 0 });
        email.sendVerificationEmail.mockResolvedValue("provider-message-a");

        await (service as unknown as {
            deliver(item: ClaimedEmailFixture): Promise<void>;
        }).deliver(staleAttempt);

        expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: "started",
                    attemptVersion: 1,
                    providerIdempotencyKey: IDEMPOTENCY_KEY,
                }),
                data: expect.objectContaining({ status: "accepted" }),
            }),
        );
    });

    it("loses CAS when attempt A returns after attempt B has been reclaimed", async () => {
        const attemptA = claimedEmail({ attempt_version: 1 });
        const attemptB = claimedEmail({ attempt_version: 2 });
        let currentAttemptVersion = 1;
        let resolveProviderA!: () => void;
        let providerAStarted!: () => void;
        const providerAReleased = new Promise<void>((resolve) => {
            resolveProviderA = resolve;
        });
        const providerAStartedPromise = new Promise<void>((resolve) => {
            providerAStarted = resolve;
        });

        prisma.$queryRaw.mockResolvedValue([{ id: attemptA.id }]);
        email.sendVerificationEmail
            .mockImplementationOnce(async () => {
                providerAStarted();
                await providerAReleased;
                return "provider-message-a";
            })
            .mockResolvedValueOnce("provider-message-b");
        prisma.auth_email_outbox.updateMany.mockImplementation(async ({
            where,
        }: { where: { attemptVersion: number } }) => {
            if (where.attemptVersion === attemptB.attempt_version) {
                currentAttemptVersion = attemptB.attempt_version;
            }
            return { count: where.attemptVersion === currentAttemptVersion ? 1 : 0 };
        });

        const attemptAPromise = (service as unknown as {
            deliver(item: ClaimedEmailFixture): Promise<void>;
        }).deliver(attemptA);
        await providerAStartedPromise;

        // Simulate the lease owner reclaiming the row with a new CAS version
        // while attempt A is still waiting on the provider.
        await (service as unknown as {
            deliver(item: ClaimedEmailFixture): Promise<void>;
        }).deliver(attemptB);
        resolveProviderA();
        await attemptAPromise;

        expect(email.sendVerificationEmail).toHaveBeenCalledTimes(2);
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: OUTBOX_ID,
                    status: "started",
                    attemptVersion: attemptA.attempt_version,
                    providerIdempotencyKey: IDEMPOTENCY_KEY,
                }),
                data: expect.objectContaining({ status: "accepted" }),
            }),
        );
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: OUTBOX_ID,
                    status: "started",
                    attemptVersion: attemptB.attempt_version,
                    providerIdempotencyKey: IDEMPOTENCY_KEY,
                }),
                data: expect.objectContaining({ status: "accepted" }),
            }),
        );
    });

    it("retries a known pre-send token failure without calling the provider", async () => {
        const item = claimedEmail();
        prisma.$queryRaw
            .mockResolvedValueOnce([item])
            .mockResolvedValueOnce([]);
        prisma.auth_email_outbox.updateMany.mockResolvedValue({ count: 1 });

        await service.deliverPending();

        expect(email.sendVerificationEmail).not.toHaveBeenCalled();
        expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: OUTBOX_ID,
                    status: "started",
                    attemptVersion: 1,
                }),
                data: expect.objectContaining({
                    status: "prepared",
                    errorCode: "auth_token_invalid",
                }),
            }),
        );
    });

    it("reconciles an uncertain row by CAS without invoking the provider", async () => {
        prisma.auth_email_outbox.updateMany.mockResolvedValue({ count: 1 });

        await expect(service.reconcile({
            id: OUTBOX_ID,
            attemptVersion: 3,
            outcome: "accepted",
            providerMessageId: "provider-message-3",
            reason: "provider lookup confirmed acceptance",
        })).resolves.toBe(true);

        expect(email.sendVerificationEmail).not.toHaveBeenCalled();
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: OUTBOX_ID,
                    status: "uncertain",
                    attemptVersion: 3,
                },
                data: expect.objectContaining({
                    status: "accepted",
                    providerMessageId: "provider-message-3",
                }),
            }),
        );
    });

    it("skips the run when the scheduler lease is not held", async () => {
        service = new AuthEmailOutboxService(
            prisma as unknown as PrismaService,
            tokens as unknown as AuthEmailTokenService,
            email,
            createSchedulerLeaseMock(false),
        );

        await service.deliverPending();

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
