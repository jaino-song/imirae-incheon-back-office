import { AgentController } from "./agent.controller";

describe("AgentController emergency disable", () => {
    it("sends only the enabled=false patch so stored domains, capabilities, and risks survive", async () => {
        const flags = {
            getConfig: jest.fn(),
            updateConfig: jest.fn().mockResolvedValue({ enabled: false }),
        };
        const controller = new AgentController(
            {} as never,
            {} as never,
            {} as never,
            flags as never,
            {} as never,
            {} as never,
        );

        await expect(controller.emergencyDisable()).resolves.toEqual({ enabled: false });
        expect(flags.getConfig).not.toHaveBeenCalled();
        expect(flags.updateConfig).toHaveBeenCalledWith({ enabled: false });
    });
});
