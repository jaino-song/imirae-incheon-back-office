/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { middleware } from "../middleware";

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

const mockJwtDecode = jwtDecode as jest.Mock;

function createRequest(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("middleware API route protection", () => {
  beforeEach(() => {
    mockJwtDecode.mockReset();
  });

  it("redirects the login page to home when a valid access token exists", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest("/login", "auth_token=session-token"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("allows the login page without a valid access token", async () => {
    const response = await middleware(createRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows explicitly public auth API routes without a session", async () => {
    const response = await middleware(createRequest("/api/auth/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the receipt status BFF route without a session", async () => {
    const response = await middleware(createRequest("/api/receipt/efr_x/status"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the public receipt page without a session", async () => {
    const response = await middleware(createRequest("/receipt/efr_x"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not treat the receipt-links send route as public — it requires a session", async () => {
    // Regression guard for a mutant that simplifies isRouteMatch() to a bare
    // `pathname.startsWith(route)`: "/api/receipt-links/send".startsWith("/api/receipt")
    // is true, which would wrongly make this protected admin route public. The real
    // isRouteMatch() requires an exact match or a "/" boundary after the route prefix.
    const response = await middleware(createRequest("/api/receipt-links/send"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("does not allow the legacy token callback as a public API route", async () => {
    const response = await middleware(createRequest("/api/auth/callback"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects protected API routes without a session", async () => {
    const response = await middleware(createRequest("/api/clients"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects protected API routes when the session has no selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest("/api/clients", "auth_token=session-token"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Branch selection required" });
  });

  it("allows protected API routes with auth and selected branch", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await middleware(createRequest(
      "/api/clients",
      "auth_token=session-token; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not clear cookies when another request is already rotating refresh", async () => {
    mockJwtDecode.mockReturnValue({
      sub: "user-1",
      sid: "session-1",
      role: "manager",
      type: "access",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        code: "AUTH_REFRESH_REPLAY_CONCURRENT",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await middleware(createRequest(
      "/clients",
      "auth_token=expired; refresh_token=current; selected_branch_id=branch-1",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/clients");
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();
    fetchMock.mockRestore();
  });
});
