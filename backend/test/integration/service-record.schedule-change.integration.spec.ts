import { ExecutionContext, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { ServiceRecordEntryController } from "interface/controllers/service-record-entry.controller";

type MockScheduleChangeService = {
    preview: jest.Mock;
    createRequest: jest.Mock;
};

const expectRoute = (
    handler: object,
    method: RequestMethod,
    path: string,
): void => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
};

describe("ServiceRecordEntryController schedule-change endpoints (Integration)", () => {
    const serviceRecordContext = {
        tokenId: "t1",
        branchId: "org-1",
        scheduleId: 11,
        employeeId: 5,
    };

    let moduleFixture: TestingModule;
    let controller: ServiceRecordEntryController;
    let scheduleChangeService: MockScheduleChangeService;

    beforeEach(async () => {
        const serviceRecordService = {
            linkStatus: jest.fn(),
            verify: jest.fn(),
            getContext: jest.fn(),
            saveHeader: jest.fn(),
            upsertSession: jest.fn(),
            finalize: jest.fn(),
        };
        scheduleChangeService = {
            preview: jest.fn(),
            createRequest: jest.fn(),
        };
        const mockServiceRecordGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.serviceRecordContext = serviceRecordContext;
                return true;
            },
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [ServiceRecordEntryController],
            providers: [
                {
                    provide: ServiceRecordEntryService,
                    useValue: serviceRecordService,
                },
                {
                    provide: ScheduleChangeService,
                    useValue: scheduleChangeService,
                },
            ],
        })
            .overrideGuard(ServiceRecordGuard)
            .useValue(mockServiceRecordGuard)
            .compile();

        controller = moduleFixture.get(ServiceRecordEntryController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    describe("GET /service-record/schedule-change/preview", () => {
        it("should expose the preview route and call the schedule-change service with service-record context", async () => {
            scheduleChangeService.preview.mockResolvedValue({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expect(Reflect.getMetadata(PATH_METADATA, ServiceRecordEntryController)).toBe(
                "service-record",
            );
            expectRoute(
                ServiceRecordEntryController.prototype.previewScheduleChange,
                RequestMethod.GET,
                "schedule-change/preview",
            );

            await controller.previewScheduleChange({ serviceRecordContext } as Parameters<
                ServiceRecordEntryController["previewScheduleChange"]
            >[0]);

            expect(scheduleChangeService.preview).toHaveBeenCalledWith(serviceRecordContext);
        });
    });

    describe("POST /service-record/schedule-change", () => {
        it("should expose the create route and call the schedule-change service with service-record context", async () => {
            scheduleChangeService.createRequest.mockResolvedValue({
                id: "request-1",
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });

            expectRoute(
                ServiceRecordEntryController.prototype.createScheduleChange,
                RequestMethod.POST,
                "schedule-change",
            );

            await controller.createScheduleChange({ serviceRecordContext } as Parameters<
                ServiceRecordEntryController["createScheduleChange"]
            >[0]);

            expect(scheduleChangeService.createRequest).toHaveBeenCalledWith(serviceRecordContext);
        });
    });
});
