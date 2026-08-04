import { ClientEntity } from "domain/entities/client.entity";
import { ClientAgentCapabilitiesProvider } from "./client-agent-capabilities.provider";

describe("ClientAgentCapabilitiesProvider", () => {
    const client = (id: number) => ClientEntity.reconstitute(
        id, "홍길동", null, null, null, null, null, null, null,
        new Date("2026-08-10T00:00:00Z"), null, null, false, null, null,
        "서비스 예정", false, null,
    );

    it("returns structured choices for duplicate matches and scopes to the verified branch", async () => {
        const list = { execute: jest.fn().mockResolvedValue({ data: [client(1), client(2)], total: 2 }) };
        const find = { execute: jest.fn() };
        const provider = new ClientAgentCapabilitiesProvider(list as never, find as never);
        const search = provider.getCapabilities().find((item) => item.meta.name === "clients.search")!;
        const output = await search.execute({
            principal: { userId: "u", branchId: "branch-a", globalRole: "user", branchRole: "user" },
            sessionId: "s", traceId: "t", locale: "ko",
        }, { query: "홍길동" });

        expect(output).toMatchObject({ kind: "choices", choices: [{ id: 1 }, { id: 2 }] });
        expect(list.execute).toHaveBeenCalledWith("branch-a", 1, 10, "홍길동");
    });
});
