import { MessageTriggerSchedulerService } from "application/services/message-trigger-scheduler.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("MessageTriggerSchedulerService", () => {
    const createMockTriggerService = () => ({
        dispatchDueJobs: jest.fn(),
    });

    let scheduler: MessageTriggerSchedulerService;
    let triggerService: ReturnType<typeof createMockTriggerService>;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        triggerService = createMockTriggerService();
        scheduler = new MessageTriggerSchedulerService(
            triggerService as unknown as MessageTriggerService,
            createSchedulerLeaseMock(),
        );
        nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    it("enters cooldown after transient prisma connectivity errors", async () => {
        const prismaError = Object.assign(
            new Error("Can't reach database server at `aws-0-ap-northeast-2.pooler.supabase.com:6543`"),
            { code: "P1001" },
        );
        triggerService.dispatchDueJobs.mockRejectedValue(prismaError);

        await scheduler.dispatchDueJobs();
        await scheduler.dispatchDueJobs();

        expect(triggerService.dispatchDueJobs).toHaveBeenCalledTimes(1);
    });

    it("clears a stale lock and starts a fresh run", async () => {
        let releaseFirstRun: (() => void) | undefined;
        triggerService.dispatchDueJobs.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirstRun = resolve;
                }),
        );
        triggerService.dispatchDueJobs.mockResolvedValueOnce(undefined);

        const firstRun = scheduler.dispatchDueJobs();

        nowSpy.mockReturnValue(16 * 60 * 1000);
        await scheduler.dispatchDueJobs();

        expect(triggerService.dispatchDueJobs).toHaveBeenCalledTimes(2);

        releaseFirstRun?.();
        await firstRun;
    });

    it("skips the run when the scheduler lease is not held", async () => {
        scheduler = new MessageTriggerSchedulerService(
            triggerService as unknown as MessageTriggerService,
            createSchedulerLeaseMock(false),
        );

        await scheduler.dispatchDueJobs();

        expect(triggerService.dispatchDueJobs).not.toHaveBeenCalled();
    });
});
