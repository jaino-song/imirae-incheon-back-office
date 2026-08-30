import { HealthController } from "./health.controller";
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

describe("HealthController", () => {
    it("should report process liveness without external dependencies", () => {
        const controller = new HealthController(undefined, new ReadinessService());

        expect(controller.getHealth()).toEqual({ status: "ok" });
    });

    it("should report readiness after a successful SELECT 1 and disable caching", async () => {
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
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
        );
        const response = createResponse();

        readiness.markNotReady();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "unavailable",
        });

        expect(queryRaw).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(503);
    });
});
