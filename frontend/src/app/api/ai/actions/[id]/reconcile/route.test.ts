/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { proxyAgentRequest } from "../../../agent/_proxy";
import { POST } from "./route";

jest.mock("../../../agent/_proxy", () => ({ proxyAgentRequest: jest.fn() }));

describe("agent action reconciliation proxy", () => {
    it("forwards a bodyless reconciliation request", async () => {
        (proxyAgentRequest as jest.Mock).mockResolvedValue(new Response(null, { status: 200 }));
        const request = new NextRequest("http://localhost/api/ai/actions/action%20one/reconcile", { method: "POST" });

        await POST(request, { params: Promise.resolve({ id: "action one" }) });

        expect(proxyAgentRequest).toHaveBeenCalledWith(request, "/ai/actions/action%20one/reconcile", "POST");
    });
});
