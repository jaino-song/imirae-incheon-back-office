import { ServiceRecordFinalizationSchedulerService } from "application/services/service-record-finalization-scheduler.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("ServiceRecordFinalizationSchedulerService", () => {
    const createConfigService = () => ({
        get: jest.fn((key: string) =>
            key === "SERVICE_RECORD_AUTO_FINALIZE_ENABLED" ? "true" : undefined),
    });

    const createFinalizationService = () => ({
        processDueCases: jest.fn().mockResolvedValue(0),
    });

    it("skips the run when the scheduler lease is not held", async () => {
        const configService = createConfigService();
        const finalizationService = createFinalizationService();
        const service = new ServiceRecordFinalizationSchedulerService(
            configService as never,
            finalizationService as never,
            createSchedulerLeaseMock(false),
        );

        await service.finalizeDueServiceRecords();

        expect(finalizationService.processDueCases).not.toHaveBeenCalled();
    });
});
