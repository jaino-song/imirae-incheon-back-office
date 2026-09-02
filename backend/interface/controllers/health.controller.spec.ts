import { Test } from "@nestjs/testing";

import { HealthController } from "./health.controller";
import { SchedulerLeaseService, type SchedulerLeaseSnapshot } from "application/services/scheduler-lease.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ReadinessService } from "infrastructure/health/readiness.service";

interface MockResponse {
    setHeader: jest.Mock;
    status: jest.Mock;
}

function createResponse(): MockResponse {
    return {
        setHeader: jest.fn(),
        status: jest.fn(),
    };
}

function createLease(overrides: Partial<SchedulerLeaseSnapshot> = {}): SchedulerLeaseService {
    const snapshot: SchedulerLeaseSnapshot = {
        mode: "required",
        holderId: "lightnode",
        instanceId: "instance-1",
        held: true,
        lastRenewOkAgoMs: 1_000,
        ...overrides,
    };
    return { snapshot: jest.fn(() => snapshot) } as unknown as SchedulerLeaseService;
}

describe("HealthController", () => {
    it("should receive PrismaService through Nest injection and report ready", async () => {
        // Regression: the constructor types prisma as `PrismaService | undefined`,
        // which TypeScript emits as `Object` in design:paramtypes. Under
        // @Optional() Nest then injects undefined instead of failing, and every
        // readiness probe answered 503 — the LightNode deploy of b51f63c75 rolled
        // back on exactly this. Only a real DI container can observe it, so this
        // test compiles a module instead of calling the constructor directly.
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const moduleRef = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [
                ReadinessService,
                { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
                { provide: SchedulerLeaseService, useValue: createLease() },
            ],
        }).compile();
        const controller = moduleRef.get(HealthController);
        const response = createResponse();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "ok",
        });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it("should report process liveness without external dependencies", () => {
        const controller = new HealthController(undefined, new ReadinessService(), createLease());

        expect(controller.getHealth()).toEqual({ status: "ok" });
    });

    it("should report readiness after a successful SELECT 1 and disable caching", async () => {
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "ok",
        });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(queryRaw.mock.calls[0]?.[0]?.[0]).toBe("SELECT 1");
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).toHaveBeenCalledWith(200);
        expect(readiness.isReady()).toBe(true);
    });

    it("should return a generic 503 without database details when readiness fails", async () => {
        const databaseMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";
        const queryRaw = jest.fn().mockRejectedValue(new Error(databaseMessage));
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        const result = await controller.getReadiness(response as never);

        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).toHaveBeenCalledWith(503);
        expect(result).toEqual({ status: "unavailable" });
        expect(JSON.stringify(result)).not.toContain(databaseMessage);
        expect(readiness.isReady()).toBe(true);
    });

    it("should fail closed without probing the database after process readiness is revoked", async () => {
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        readiness.markNotReady();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "unavailable",
        });

        expect(queryRaw).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(503);
    });

    it("should expose the scheduler lease snapshot without the process instance id", () => {
        const controller = new HealthController(undefined, new ReadinessService(), createLease());
        const response = createResponse();

        expect(controller.getLease(response as never)).toEqual({
            mode: "required",
            holderId: "lightnode",
            held: true,
        });
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).not.toHaveBeenCalled();
    });

    it("should report standby and not held on a passive host", () => {
        const controller = new HealthController(
            undefined,
            new ReadinessService(),
            createLease({ mode: "standby", held: false, lastRenewOkAgoMs: null }),
        );

        expect(controller.getLease(createResponse() as never)).toEqual({
            mode: "standby",
            holderId: "lightnode",
            held: false,
        });
    });
});
