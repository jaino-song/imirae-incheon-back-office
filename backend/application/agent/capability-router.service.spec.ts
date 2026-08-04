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

    function ambiguousRegistry() {
        return {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ],
        };
    }

    const principal = { userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin" } as const;

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
            ambiguousRegistry() as never,
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

    it("falls back to all enabled lexical matches when classifier routing is disabled", async () => {
        const create = jest.fn().mockReturnValue({});
        const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never, { create } as never);
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "false";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(create).not.toHaveBeenCalled();
    });

    it("falls back to lexical matches when no classifier model is available", async () => {
        const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

        await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
    });

    it("falls back to lexical matches when classifier generation throws", async () => {
        mockedGenerateText.mockRejectedValueOnce(new Error("classifier unavailable"));
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it.each([
        ["invalid JSON shape", '{"domains":"employees"}'],
        ["invalid domain values", '{"domains":["unknown", 42]}'],
        ["mixed valid and invalid domains", '{"domains":["employees","unknown"]}'],
        ["empty domain output", '{"domains":[]}'],
    ])("falls back to lexical matches for %s classifier output", async (_caseName, classifierText) => {
        mockedGenerateText.mockResolvedValueOnce({ text: classifierText } as never);
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it("uses a nonempty valid classifier result to narrow ambiguous lexical matches", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["employees"]}' } as never);
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({
                domains: ["employees"],
                capabilities: [{ meta: { name: "employees.search", domain: "employees" } }],
            });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it("defaults to clients only when neither lexical nor classifier routing has a result", async () => {
        const router = new CapabilityRouterService(
            { list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ] } as never,
            enabledFlags() as never,
        );

        await expect(router.route("도와줘", principal)).resolves.toMatchObject({
            domains: ["clients"],
            capabilities: [{ meta: { name: "clients.search", domain: "clients" } }],
        });
    });

    it("minimizes phone, email, URL, and long identifiers before classifier dispatch", () => {
        expect(minimizeClassifierText("010-1234-5678 client@example.com https://private.example/a 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 123456789"))
            .toBe("[redacted] [redacted] [redacted] 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 [redacted]");
    });

    it("minimizes Korean landlines and hyphenated identifiers while preserving operational metadata", () => {
        expect(minimizeClassifierText("02-1234-5678 031-123-4567 070-1234-5678 080-123-4567 0505-123-4567 +82-2-1234-5678 +82-31-123-4567 900101-1234567 123-45-67890 2026-08-03 v1.2.3 123e4567-e89b-12d3-a456-426614174000"))
            .toBe("[redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] 2026-08-03 v1.2.3 123e4567-e89b-12d3-a456-426614174000");
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
