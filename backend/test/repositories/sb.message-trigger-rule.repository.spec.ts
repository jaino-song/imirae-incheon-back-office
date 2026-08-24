import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

describe("SbMessageTriggerRuleRepository", () => {
    type MockMessageTriggerRuleRow = {
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: string;
        offsetType: string;
        offsetDays: number;
        recipientType: string;
        templateKey: string;
        isDefault: boolean;
        jobsStale: boolean;
        createdAt: Date;
        updatedAt: Date;
    };

    const createMockPrismaMessageTriggerRule = () => ({
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
        $transaction: jest.fn(),
    });

    const createRow = (
        overrides: Partial<MockMessageTriggerRuleRow> = {},
    ): MockMessageTriggerRuleRow => ({
        id: "rule-1",
        branchId: "branch-1",
        name: "서비스 시작 7일 전 서비스 안내",
        isActive: false,
        eventType: MessageTriggerEventType.SERVICE_START,
        offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
        offsetDays: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        isDefault: true,
        jobsStale: false,
        createdAt: new Date("2026-07-08T00:00:00.000Z"),
        updatedAt: new Date("2026-07-08T01:00:00.000Z"),
        ...overrides,
    });

    const getSqlText = (value: unknown): string => {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) return strings.join("");
        }
        return String(value);
    };

    let messageTriggerRuleModel: ReturnType<typeof createMockPrismaMessageTriggerRule>;
    let repository: SbMessageTriggerRuleRepository;

    beforeEach(() => {
        messageTriggerRuleModel = createMockPrismaMessageTriggerRule();
        const prisma = {
            message_trigger_rule: messageTriggerRuleModel,
            $transaction: jest.fn(),
        };
        prisma.$transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(messageTriggerRuleModel));
        repository = new SbMessageTriggerRuleRepository({
            ...prisma,
        } as unknown as PrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("findInactiveDefaultRules queries inactive defaults oldest updated first with default limit", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([createRow()]);

        const result = await repository.findInactiveDefaultRules();

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith({
            where: {
                isDefault: true,
                isActive: false,
            },
            orderBy: { updatedAt: "asc" },
            take: 50,
        });
        expect(result[0]?.isDefault).toBe(true);
        expect(result[0]?.isActive).toBe(false);
    });

    it("findInactiveDefaultRules respects the provided limit", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([]);

        await repository.findInactiveDefaultRules(12);

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                take: 12,
            }),
        );
    });

    it("findActiveTemplateKeys returns only active shared-template keys across branches", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([
            { templateKey: MessageTriggerTemplateKey.SERVICE_INFO },
        ]);

        const result = await repository.findActiveTemplateKeys([
            MessageTriggerTemplateKey.SERVICE_INFO,
        ]);

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith({
            where: {
                isActive: true,
                templateKey: { in: [MessageTriggerTemplateKey.SERVICE_INFO] },
            },
            select: { templateKey: true },
            distinct: ["templateKey"],
        });
        expect(result).toEqual([MessageTriggerTemplateKey.SERVICE_INFO]);
    });

    it("markJobsStale sets jobsStale true for the rule id", async () => {
        messageTriggerRuleModel.updateMany.mockResolvedValue({ count: 1 });

        await repository.markJobsStale("rule-1");

        expect(messageTriggerRuleModel.updateMany).toHaveBeenCalledWith({
            where: { id: "rule-1" },
            data: { jobsStale: true },
        });
    });

    it("findStaleRules queries stale rules oldest updated first with limit", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([createRow({ jobsStale: true })]);

        const result = await repository.findStaleRules(7);

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith({
            where: { jobsStale: true },
            orderBy: { updatedAt: "asc" },
            take: 7,
        });
        expect(result[0]?.jobsStale).toBe(true);
    });

    it("clearJobsStaleIfUnchanged clears only when jobsStale and updatedAt still match", async () => {
        const readUpdatedAt = new Date("2026-07-08T01:00:00.000Z");
        messageTriggerRuleModel.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(
            repository.clearJobsStaleIfUnchanged("rule-1", readUpdatedAt),
        ).resolves.toBe(true);
        await expect(
            repository.clearJobsStaleIfUnchanged("rule-1", readUpdatedAt),
        ).resolves.toBe(false);

        expect(messageTriggerRuleModel.updateMany).toHaveBeenCalledWith({
            where: {
                id: "rule-1",
                jobsStale: true,
                updatedAt: readUpdatedAt,
            },
            data: { jobsStale: false, updatedAt: readUpdatedAt },
        });
    });

    it("updates and deletes only against the complete branch-scoped target snapshot", async () => {
        const createdAt = new Date("2026-07-08T00:00:00.000Z");
        const updatedAt = new Date("2026-07-08T01:00:00.000Z");
        const expected = MessageTriggerRuleEntity.reconstitute(
            "rule-1",
            "branch-1",
            "서비스 시작 7일 전 서비스 안내",
            false,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerOffsetType.BEFORE_DAYS,
            7,
            MessageTriggerRecipientType.CLIENT,
            MessageTriggerTemplateKey.SERVICE_INFO,
            createdAt,
            updatedAt,
            true,
            false,
        );
        const next = MessageTriggerRuleEntity.reconstitute(
            expected.id,
            expected.branchId,
            "변경된 규칙",
            expected.isActive,
            expected.eventType,
            expected.offsetType,
            expected.offsetDays,
            expected.recipientType,
            expected.templateKey,
            expected.createdAt,
            new Date("2026-07-08T02:00:00.000Z"),
            expected.isDefault,
            expected.jobsStale,
        );
        messageTriggerRuleModel.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
        messageTriggerRuleModel.deleteMany.mockResolvedValueOnce({ count: 1 });

        await expect(repository.updateIfTargetMatches("branch-1", expected, next)).resolves.toBe(next);
        await expect(repository.updateIfTargetMatches("branch-1", expected, next)).resolves.toBeNull();
        await expect(repository.deleteIfTargetMatches("branch-1", expected)).resolves.toBe(true);
        expect(messageTriggerRuleModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "rule-1", branchId: "branch-1", updatedAt }),
        }));
        expect(messageTriggerRuleModel.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "rule-1", branchId: "branch-1", updatedAt }),
        }));
    });

    it("atomically locks the rule, fences pending jobs, and sets jobsStale", async () => {
        const expected = MessageTriggerRuleEntity.reconstitute(
            "rule-atomic",
            "branch-1",
            "서비스 시작 7일 전 서비스 안내",
            true,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerOffsetType.BEFORE_DAYS,
            7,
            MessageTriggerRecipientType.CLIENT,
            MessageTriggerTemplateKey.SERVICE_INFO,
            new Date("2026-07-08T00:00:00.000Z"),
            new Date("2026-07-08T01:00:00.000Z"),
            false,
            false,
        );
        const next = MessageTriggerRuleEntity.reconstitute(
            expected.id,
            expected.branchId,
            "변경된 규칙",
            expected.isActive,
            expected.eventType,
            expected.offsetType,
            expected.offsetDays,
            expected.recipientType,
            expected.templateKey,
            expected.createdAt,
            expected.updatedAt,
            expected.isDefault,
            true,
        );
        const raw = (rule: MessageTriggerRuleEntity) => ({
            id: rule.id,
            branch_id: rule.branchId,
            name: rule.name,
            is_active: rule.isActive,
            event_type: rule.eventType,
            offset_type: rule.offsetType,
            offset_days: rule.offsetDays,
            recipient_type: rule.recipientType,
            template_key: rule.templateKey,
            is_default: rule.isDefault,
            jobs_stale: rule.jobsStale,
            created_at: rule.createdAt,
            updated_at: rule.updatedAt,
        });
        messageTriggerRuleModel.$queryRaw
            .mockResolvedValueOnce([raw(expected)])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([raw(next)]);
        messageTriggerRuleModel.$executeRaw.mockResolvedValue(1);

        await expect(repository.updateIfTargetMatchesAndFenceJobs(
            "branch-1",
            expected,
            next,
            "Rule updated",
        )).resolves.toEqual(expect.objectContaining({ name: "변경된 규칙", jobsStale: true }));
        expect(messageTriggerRuleModel.$queryRaw).toHaveBeenCalledTimes(3);
        expect(getSqlText(messageTriggerRuleModel.$queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        expect(getSqlText(messageTriggerRuleModel.$queryRaw.mock.calls[1][0])).toContain("message_trigger_job");
        expect(messageTriggerRuleModel.$executeRaw).toHaveBeenCalledTimes(1);

        messageTriggerRuleModel.$queryRaw.mockReset();
        messageTriggerRuleModel.$queryRaw.mockResolvedValueOnce([raw(expected)]).mockResolvedValueOnce([{ status: "processing" }]);
        await expect(repository.updateIfTargetMatchesAndFenceJobs(
            "branch-1",
            expected,
            next,
            "Rule updated",
        )).resolves.toBeNull();
        expect(messageTriggerRuleModel.$queryRaw).toHaveBeenCalledTimes(2);
        expect(messageTriggerRuleModel.$executeRaw).toHaveBeenCalledTimes(1);

        messageTriggerRuleModel.$queryRaw.mockReset();
        messageTriggerRuleModel.$queryRaw.mockResolvedValueOnce([raw(expected)]).mockResolvedValueOnce([{ status: "sent" }]);
        await expect(repository.updateIfTargetMatchesAndFenceJobs(
            "branch-1",
            expected,
            next,
            "Rule updated",
            new Date("2026-07-08T01:30:00.000Z"),
        )).resolves.toBeNull();
        expect(getSqlText(messageTriggerRuleModel.$queryRaw.mock.calls[1][0])).toContain("sent_at >=");
        expect(messageTriggerRuleModel.$executeRaw).toHaveBeenCalledTimes(1);
    });
});
