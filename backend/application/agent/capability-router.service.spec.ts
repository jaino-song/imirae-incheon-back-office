import { generateText } from "ai";
import { CapabilityRouterService, minimizeClassifierText } from "./capability-router.service";

jest.mock("ai", () => ({ generateText: jest.fn() }));

const mockedGenerateText = generateText as jest.MockedFunction<typeof generateText>;

describe("CapabilityRouterService", () => {
    beforeEach(() => mockedGenerateText.mockReset());

    function enabledFlags() {
        return {
            getSnapshot: jest.fn().mockResolvedValue({ config: {}, emergencyDisabled: false }),
            isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(true),
        };
    }

    it("routes Korean and English terms only to enabled capabilities", async () => {
        const registry = {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "contracts.status", domain: "contracts" } },
            ],
        };
        const flags = enabledFlags();
        const router = new CapabilityRouterService(registry as never, flags as never);
        const result = await router.route("계약 상태 보여줘", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        });

        expect(result.domains).toEqual(["contracts"]);
        expect(result.capabilities.map((item) => item.meta.name)).toEqual(["contracts.status"]);
        expect(flags.getSnapshot).toHaveBeenCalledTimes(1);
        expect(flags.isCapabilityEnabledFromSnapshot).toHaveBeenCalledTimes(2);
    });

    it("caps the bundle", async () => {
        const capabilities = Array.from({ length: 20 }, (_, index) => ({
            meta: { name: `clients.read${index}`, domain: "clients" },
        }));
        const router = new CapabilityRouterService(
            { list: () => capabilities } as never,
            enabledFlags() as never,
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
            enabledFlags() as never,
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

    it("minimizes phone, email, URL, and long identifiers before classifier dispatch", () => {
        expect(minimizeClassifierText("010-1234-5678 client@example.com https://private.example/a 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 123456789"))
            .toBe("[redacted] [redacted] [redacted] 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 [redacted]");
    });

    it("passes only minimized current-turn text to the ambiguous classifier", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["clients"]}' } as never);
        const router = new CapabilityRouterService(
            { list: () => [{ meta: { name: "clients.search", domain: "clients" } }] } as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await router.route("person@example.com https://private.example/a 123e4567-e89b-12d3-a456-426614174000", {
                userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
            });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            prompt: "[redacted] [redacted] 123e4567-e89b-12d3-a456-426614174000",
        }));
    });

    it("removes labeled credentials while preserving opaque operational identifiers", () => {
        expect(minimizeClassifierText("Bearer abc.def token: secret-value actionId=123e4567-e89b-12d3-a456-426614174000 cursor=cuid_2m4x6z8q0v"))
            .toBe("[redacted] [redacted] actionId=123e4567-e89b-12d3-a456-426614174000 cursor=cuid_2m4x6z8q0v");
    });
});
