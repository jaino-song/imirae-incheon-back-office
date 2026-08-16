import { resolveSchedulerModuleOptions } from "./scheduler-config";

describe("resolveSchedulerModuleOptions", () => {
    it("should preserve existing scheduler behavior by default", () => {
        expect(resolveSchedulerModuleOptions({})).toEqual({
            cronJobs: true,
            intervals: true,
            timeouts: true,
        });
    });

    it("should disable every scheduled execution mechanism for shadow deployments", () => {
        expect(resolveSchedulerModuleOptions({ SCHEDULERS_ENABLED: "false" })).toEqual({
            cronJobs: false,
            intervals: false,
            timeouts: false,
        });
    });

    it("should normalize the disabled value", () => {
        expect(resolveSchedulerModuleOptions({ SCHEDULERS_ENABLED: " FALSE " }).cronJobs).toBe(
            false,
        );
    });
});
