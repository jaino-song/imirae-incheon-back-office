/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { proxyAgentRequest } from "../../agent/_proxy";
import { GET } from "./route";

jest.mock("../../agent/_proxy", () => ({ proxyAgentRequest: jest.fn() }));

describe("agent action recovery proxy", () => {
    it("proxies an encoded action identity to the owner-scoped backend endpoint", async () => {
        (proxyAgentRequest as jest.Mock).mockResolvedValue(new Response(null, { status: 200 }));
        const request = new NextRequest("http://localhost/api/ai/actions/action%20one");

        await GET(request, { params: Promise.resolve({ id: "action one" }) });

        expect(proxyAgentRequest).toHaveBeenCalledWith(request, "/ai/actions/action%20one", "GET");
    });
});
