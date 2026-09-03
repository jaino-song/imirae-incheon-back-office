import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("SbMessageTriggerRuleBranchOverrideRepository", () => {
    const createMockPrismaClient = () => ({
        message_trigger_rule_branch_override: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
        },
        message_trigger_job: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn(),
    });

    let prismaClient: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbMessageTriggerRuleBranchOverrideRepository;

    beforeEach(() => {
        prismaClient = createMockPrismaClient();
        prisma = prismaClient as unknown as PrismaService;
        (prisma.$transaction as unknown as jest.Mock).mockImplementation(
            (operations: Promise<unknown>[]) => Promise.all(operations),
        );
        repository = new SbMessageTriggerRuleBranchOverrideRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findOne", () => {
        it("looks up the override by the composite branchId+ruleId key", async () => {
            prismaClient.message_trigger_rule_branch_override.findUnique.mockResolvedValue({
                branchId: "branch-1",
                ruleId: "rule-1",
                isActive: false,
            });

            const result = await repository.findOne("branch-1", "rule-1");

            expect(prismaClient.message_trigger_rule_branch_override.findUnique).toHaveBeenCalledWith({
                where: { branchId_ruleId: { branchId: "branch-1", ruleId: "rule-1" } },
                select: { branchId: true, ruleId: true, isActive: true },
            });
            expect(result).toEqual({ branchId: "branch-1", ruleId: "rule-1", isActive: false });
        });

        it("returns null when no override exists", async () => {
            prismaClient.message_trigger_rule_branch_override.findUnique.mockResolvedValue(null);

            await expect(repository.findOne("branch-1", "rule-1")).resolves.toBeNull();
        });
    });

    describe("upsert", () => {
        it("creates or updates the override row for the branch+rule pair", async () => {
            prismaClient.message_trigger_rule_branch_override.upsert.mockResolvedValue({
                branchId: "branch-1",
                ruleId: "rule-1",
                isActive: false,
            });

            const result = await repository.upsert("branch-1", "rule-1", false);

            expect(prismaClient.message_trigger_rule_branch_override.upsert).toHaveBeenCalledWith({
                where: { branchId_ruleId: { branchId: "branch-1", ruleId: "rule-1" } },
                create: { branchId: "branch-1", ruleId: "rule-1", isActive: false },
                update: { isActive: false },
                select: { branchId: true, ruleId: true, isActive: true },
            });
            expect(result).toEqual({ branchId: "branch-1", ruleId: "rule-1", isActive: false });
        });
    });

    describe("cancelJobsForBranchRule", () => {
        it("cancels only pending jobs and failed retry-marker jobs for the branch+rule, leaving processing/dispatching/sent untouched", async () => {
            await repository.cancelJobsForBranchRule(
                "branch-1",
                "rule-1",
                "Service record link branch disabled",
                "Service record link scheduling retry",
            );

            expect(prismaClient.$transaction).toHaveBeenCalledTimes(1);
            expect(prismaClient.message_trigger_job.updateMany).toHaveBeenCalledTimes(2);

            // 1st write: cancel every currently-pending job for this branch+rule.
            expect(prismaClient.message_trigger_job.updateMany).toHaveBeenNthCalledWith(1, {
                where: { branchId: "branch-1", ruleId: "rule-1", status: "pending" },
                data: {
                    status: "canceled",
                    canceledAt: expect.any(Date),
                    cancelReason: "Service record link branch disabled",
                    canceledByUser: false,
                },
            });

            // 2nd write: clear only the branch's own failed retry markers for this rule (identified
            // by their retry cancelReason), not every failed row.
            expect(prismaClient.message_trigger_job.updateMany).toHaveBeenNthCalledWith(2, {
                where: {
                    branchId: "branch-1",
                    ruleId: "rule-1",
                    status: "failed",
                    cancelReason: "Service record link scheduling retry",
                },
                data: {
                    status: "canceled",
                    canceledAt: expect.any(Date),
                    cancelReason: "Service record link branch disabled",
                    canceledByUser: false,
                },
            });

            // Neither where-clause targets processing/dispatching/sent — those must be left alone.
            const targetedStatuses = prismaClient.message_trigger_job.updateMany.mock.calls.map(
                (call) => (call[0] as { where: { status: string } }).where.status,
            );
            expect(targetedStatuses).toEqual(["pending", "failed"]);
        });
    });
});
