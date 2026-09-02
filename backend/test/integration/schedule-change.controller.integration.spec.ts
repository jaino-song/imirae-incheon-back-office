import { ConflictException, ExecutionContext, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";

type MockScheduleChangeService = {
    previewAdminChange: jest.Mock;
    applyAdminChange: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
};

const createSerializedRequest = (status: string) => ({
    id: "request-1",
    branchId: "org-1",
    scheduleId: 11,
    clientId: 21,
    sessionIndex: 3,
    fromDate: "2026-07-03",
    toDate: "2026-07-06",
    oldEndDate: "2026-07-14",
    newEndDate: "2026-07-15",
    status,
    reason: null,
    decidedBy: "user-1",
    requestedAt: "2026-07-02T00:00:00.000Z",
    decidedAt: "2026-07-02T00:00:00.000Z",
});

const expectRoute = (
    handler: object,
    method: RequestMethod,
    path: string,
): void => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
};

describe("ScheduleChangeController (Integration)", () => {
    it.each(["applyAdminChange", "approve", "reject"])("requires owner/admin authority for %s", (methodName) => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            ScheduleChangeController.prototype[methodName as keyof typeof ScheduleChangeController.prototype],
        ) ?? [];
        expect(guards).toContain(OwnerOrAdminGuard);
    });
    const tenant = {
        userId: "user-1",
        branchId: "org-1",
        role: "admin",
        branchRole: "admin",
    };

    let moduleFixture: TestingModule;
    let controller: ScheduleChangeController;
    let scheduleChangeService: MockScheduleChangeService;

    beforeEach(async () => {
        scheduleChangeService = {
            previewAdminChange: jest.fn(),
            applyAdminChange: jest.fn(),
            approve: jest.fn(),
            reject: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = tenant;
                requestContext.tenant = {
                    userId: tenant.userId,
                    branchId: tenant.branchId,
                    globalRole: tenant.role,
                    branchRole: tenant.branchRole,
                };
                return true;
            },
        };

        moduleFixture = await Test.createTestingModule({
            controllers: [ScheduleChangeController],
            providers: [
                {
                    provide: ScheduleChangeService,
                    useValue: scheduleChangeService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        controller = moduleFixture.get(ScheduleChangeController);
    });

    afterEach(async () => {
        await moduleFixture.close();
    });

    describe("admin direct schedule change", () => {
        it("should expose a tenant-scoped preview route", async () => {
            scheduleChangeService.previewAdminChange.mockResolvedValue({
                sessionIndex: 3,
                fromDate: "2026-07-20",
                minimumDate: "2026-07-20",
            });

            expectRoute(
                ScheduleChangeController.prototype.previewAdminChange,
                RequestMethod.GET,
                "schedules/:scheduleId/preview",
            );

            await controller.previewAdminChange(tenant, 11);

            expect(scheduleChangeService.previewAdminChange).toHaveBeenCalledWith("org-1", 11);
        });

        it("should apply the selected date with the current tenant", async () => {
            scheduleChangeService.applyAdminChange.mockResolvedValue(
                createSerializedRequest("approved"),
            );

            expectRoute(
                ScheduleChangeController.prototype.applyAdminChange,
                RequestMethod.POST,
                "schedules/:scheduleId/apply",
            );

            await controller.applyAdminChange(tenant, 11, { toDate: "2026-07-23" });

            expect(scheduleChangeService.applyAdminChange).toHaveBeenCalledWith(
                11,
                "2026-07-23",
                tenant,
            );
        });
    });

    describe("POST /schedule-change-requests/:id/approve", () => {
        it("should expose the approve route and call the service with the current tenant", async () => {
            scheduleChangeService.approve.mockResolvedValue(createSerializedRequest("approved"));

            expect(Reflect.getMetadata(PATH_METADATA, ScheduleChangeController)).toBe(
                "schedule-change-requests",
            );
            expectRoute(
                ScheduleChangeController.prototype.approve,
                RequestMethod.POST,
                ":id/approve",
            );

            await controller.approve(tenant, "request-1");

            expect(scheduleChangeService.approve).toHaveBeenCalledWith(
                "request-1",
                expect.objectContaining({ branchId: "org-1" }),
            );
        });

        it("should preserve conflict response codes from the service", async () => {
            scheduleChangeService.approve.mockRejectedValue(
                new ConflictException({ code: "REQUEST_STALE" }),
            );

            try {
                await controller.approve(tenant, "request-1");
                throw new Error("Expected ConflictException");
            } catch (error) {
                expect(error).toBeInstanceOf(ConflictException);
                expect((error as ConflictException).getStatus()).toBe(409);
                expect((error as ConflictException).getResponse()).toEqual({ code: "REQUEST_STALE" });
            }
        });
    });

    describe("POST /schedule-change-requests/:id/reject", () => {
        it("should expose the reject route and pass dto reason", async () => {
            scheduleChangeService.reject.mockResolvedValue(createSerializedRequest("rejected"));

            expectRoute(
                ScheduleChangeController.prototype.reject,
                RequestMethod.POST,
                ":id/reject",
            );

            await controller.reject(tenant, "request-1", { reason: "provider unavailable" });

            expect(scheduleChangeService.reject).toHaveBeenCalledWith(
                "request-1",
                expect.objectContaining({ branchId: "org-1" }),
                "provider unavailable",
            );
        });
    });
});
