import { CapabilityRouterService } from "./capability-router.service";

describe("CapabilityRouterService", () => {
    it("routes Korean and English terms only to enabled capabilities", async () => {
        const registry = {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "contracts.status", domain: "contracts" } },
            ],
        };
        const flags = { isCapabilityEnabled: jest.fn().mockResolvedValue(true) };
        const router = new CapabilityRouterService(registry as never, flags as never);
        const result = await router.route("계약 상태 보여줘", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        });

        expect(result.domains).toEqual(["contracts"]);
        expect(result.capabilities.map((item) => item.meta.name)).toEqual(["contracts.status"]);
    });

    it("caps the bundle", async () => {
        const capabilities = Array.from({ length: 20 }, (_, index) => ({
            meta: { name: `clients.read${index}`, domain: "clients" },
        }));
        const router = new CapabilityRouterService(
            { list: () => capabilities } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
        );
        await expect(router.route("client", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        }, 5)).resolves.toMatchObject({ capabilities: { length: 5 } });
    });

    it("uses one bounded classifier call when lexical routing is ambiguous", async () => {
        const create = jest.fn().mockReturnValue({});
        const router = new CapabilityRouterService(
            { list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ] } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { create } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";
        // The deterministic provider cannot do a non-streaming classifier call,
        // so the router safely falls back to the enabled default domain.
        try {
            await expect(router.route("도와줘", {
                userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
            })).resolves.toMatchObject({ domains: ["clients"] });
            expect(create).toHaveBeenCalledTimes(1);
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });
});
