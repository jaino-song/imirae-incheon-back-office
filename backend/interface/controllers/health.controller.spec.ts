import { HealthController } from "./health.controller";

describe("HealthController", () => {
    it("should report process liveness without external dependencies", () => {
        const controller = new HealthController();

        expect(controller.getHealth()).toEqual({ status: "ok" });
    });
});
