import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";

describe("SbMessageLogRepository", () => {
    const createMockPrismaMessageLog = () => ({
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
    });

    let messageLogModel: ReturnType<typeof createMockPrismaMessageLog>;
    let prisma: PrismaService;
    let repository: SbMessageLogRepository;

    beforeEach(() => {
        messageLogModel = createMockPrismaMessageLog();
        prisma = {
            message_log: messageLogModel,
            $transaction: jest.fn(async (callback) => callback({ message_log: messageLogModel })),
        } as unknown as PrismaService;
        repository = new SbMessageLogRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findSentTriggerJobIds", () => {
        it("should return an empty set without querying when jobIds is empty", async () => {
            const result = await repository.findSentTriggerJobIds([]);

            expect(result).toEqual(new Set());
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });

        it("should query sent logs and return non-null trigger job ids", async () => {
            messageLogModel.findMany.mockResolvedValue([
                { triggerJobId: "job-1" },
                { triggerJobId: null },
                { triggerJobId: "job-3" },
            ]);

            const result = await repository.findSentTriggerJobIds(["job-1", "job-2", "job-3"]);

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    triggerJobId: { in: ["job-1", "job-2", "job-3"] },
                    status: "sent",
                },
                select: { triggerJobId: true },
            });
            expect(result).toEqual(new Set(["job-1", "job-3"]));
        });
    });

    describe("startRetryAttempt", () => {
        const source = MessageLogEntity.reconstitute(
            77,
            "11111111-1111-1111-1111-111111111111",
            "aligo_sms",
            "service_record_link_sms",
            "job-1",
            "01012345678",
            7,
            "message",
            {},
            "failed",
            null,
            "등록되지 않은 발신번호입니다.",
            1,
            new Date("2026-07-22T17:13:11.000Z"),
            new Date("2026-07-22T17:18:11.000Z"),
            new Date("2026-07-22T17:13:11.000Z"),
        );
        const retryDraft = MessageLogEntity.reconstitute(
            0,
            source.branchId,
            source.provider,
            source.templateKey,
            source.triggerJobId,
            source.receiver,
            source.clientId,
            source.messageBody,
            { retryOfLogId: "77", retryAttempt: "2" },
            "pending",
            null,
            null,
            1,
            null,
            new Date("2026-07-22T17:23:11.000Z"),
            new Date("2026-07-22T17:18:11.000Z"),
        );

        it("should clear only the source retry schedule and create a separate attempt", async () => {
            const claimedAt = new Date("2026-07-22T17:18:12.000Z");
            const nowSpy = jest.spyOn(Date, "now").mockReturnValue(claimedAt.getTime());
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            messageLogModel.create.mockResolvedValue({
                id: 78,
                branchId: retryDraft.branchId,
                provider: retryDraft.provider,
                templateKey: retryDraft.templateKey,
                triggerJobId: retryDraft.triggerJobId,
                receiver: retryDraft.receiver,
                clientId: retryDraft.clientId,
                recipientName: null,
                recipientPhone: retryDraft.receiver,
                messageBody: retryDraft.messageBody,
                variables: retryDraft.variables,
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 1,
                lastAttemptAt: null,
                nextRetryAt: retryDraft.nextRetryAt,
                createdAt: retryDraft.createdAt,
                updatedAt: retryDraft.createdAt,
            });

            const result = await repository.startRetryAttempt(source, retryDraft);

            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 77,
                    branchId: source.branchId,
                    status: "failed",
                    nextRetryAt: source.nextRetryAt,
                    updatedAt: source.updatedAt,
                },
                data: {
                    nextRetryAt: null,
                    updatedAt: claimedAt,
                },
            });
            expect(messageLogModel.create).toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({ id: 78, status: "pending" }));
            expect(source).toEqual(expect.objectContaining({
                id: 77,
                status: "failed",
                errorMessage: "등록되지 않은 발신번호입니다.",
            }));
            nowSpy.mockRestore();
        });

        it("should not create a duplicate attempt when the source was already claimed", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            await expect(repository.startRetryAttempt(source, retryDraft)).resolves.toBeNull();

            expect(messageLogModel.create).not.toHaveBeenCalled();
        });
    });

    describe("findByIdInBranch", () => {
        it("returns only a log owned by the requested branch", async () => {
            messageLogModel.findFirst.mockResolvedValue({
                id: 77,
                branchId: "branch-1",
                provider: "aligo_sms",
                templateKey: "service_record_link_sms",
                triggerJobId: "job-1",
                receiver: "01012345678",
                clientId: 3,
                recipientName: "나세정",
                recipientPhone: "01012345678",
                messageBody: "제공기록지 작성 링크",
                variables: {},
                status: "failed",
                aligoMid: null,
                errorMessage: "발송 실패",
                attempts: 1,
                lastAttemptAt: new Date("2026-07-23T02:20:00.000Z"),
                nextRetryAt: null,
                createdAt: new Date("2026-07-23T02:20:00.000Z"),
                updatedAt: new Date("2026-07-23T02:20:00.000Z"),
            });

            const result = await repository.findByIdInBranch("branch-1", 77);

            expect(messageLogModel.findFirst).toHaveBeenCalledWith({
                where: { id: 77, branchId: "branch-1" },
            });
            expect(result).toMatchObject({
                id: 77,
                branchId: "branch-1",
                status: "failed",
            });
        });
    });
});
