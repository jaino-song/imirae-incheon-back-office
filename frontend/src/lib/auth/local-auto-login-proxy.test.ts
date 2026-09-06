/** @jest-environment node */
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

jest.mock("@/lib/gateway/mobile-redirect", () => ({ getMobileGatewayRedirectUrl: () => null }));
const originalEnv = process.env;
const originalFetch = global.fetch;
const token = `e30.${Buffer.from(JSON.stringify({ type: "access", sid: "test-session", role: "admin", exp: 4_000_000_000 })).toString("base64url")}.test`;
beforeEach(() => {
  process.env = { NODE_ENV: "development", LOCAL_AUTO_LOGIN_EMAIL: "developer@example.test",
    LOCAL_AUTO_LOGIN_PASSWORD: "fixture", DEVELOPMENT_API_BASE_URL: "http://localhost:3001" };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, accessToken: token, refreshToken: "refresh" }) });
});
afterAll(() => { process.env = originalEnv; global.fetch = originalFetch; });
it.each(["/", "/login", "/dashboard"])("sets normal httpOnly session cookies on %s", async (path) => {
  const response = await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`http://localhost:3000${path === "/login" ? "/" : path}`);
  expect(response.cookies.get("auth_token")).toMatchObject({ value: token, httpOnly: true });
  expect(response.cookies.get("refresh_token")).toMatchObject({ value: "refresh", httpOnly: true });
});
it.each(["/api/auth/login", "/logout", "/register", "/_next/asset"])("never auto logs in on %s", async (path) => {
  await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
  expect(global.fetch).not.toHaveBeenCalled();
});
it("retains the regular login gate in production", async () => {
  process.env = { ...process.env, NODE_ENV: "production" };
  const response = await proxy(new NextRequest("http://localhost:3000/dashboard", { headers: { host: "localhost:3000" } }));
  expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  expect(global.fetch).not.toHaveBeenCalled();
});
