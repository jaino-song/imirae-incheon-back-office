/** @jest-environment node */
import { NextRequest } from "next/server";
import { tryLocalAutoLogin } from "./local-auto-login";

const originalEnv = process.env;
const originalFetch = global.fetch;
const fetchMock = jest.fn();
function request(url = "http://localhost:3000/dashboard", headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
}
beforeEach(() => {
  process.env = { NODE_ENV: "development", LOCAL_AUTO_LOGIN_EMAIL: "developer@example.test",
    LOCAL_AUTO_LOGIN_PASSWORD: "test-fixture", DEVELOPMENT_API_BASE_URL: "http://localhost:3001" };
  global.fetch = fetchMock;
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({
    success: true, accessToken: "access", refreshToken: "refresh",
  }) });
});
afterAll(() => { process.env = originalEnv; global.fetch = originalFetch; });

it("creates a normal session using the configured credentials only on loopback", async () => {
  expect(await tryLocalAutoLogin(request())).toEqual({ accessToken: "access", refreshToken: "refresh" });
  expect(fetchMock).toHaveBeenCalledWith(new URL("http://localhost:3001/auth/login"), expect.objectContaining({
    method: "POST", redirect: "error", cache: "no-store",
    body: JSON.stringify({ email: "developer@example.test", password: "test-fixture" }),
  }));
});
it.each(["production", "test", "preview", ""])('rejects runtime %s', async (env) => {
  Object.defineProperty(process.env, "NODE_ENV", { value: env, configurable: true });
  expect(await tryLocalAutoLogin(request())).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["VERCEL", "VERCEL_ENV", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME"])('rejects deployment marker %s', async (key) => {
  process.env[key] = "dev";
  expect(await tryLocalAutoLogin(request())).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["https://admin.example.test", "http://192.168.1.2:3000", "http://localhost.example.test"])('rejects frontend %s', async (url) => {
  expect(await tryLocalAutoLogin(request(url))).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["https://api.example.test", "http://192.168.1.2:3001", "not-a-url"])('rejects backend %s', async (url) => {
  process.env.DEVELOPMENT_API_BASE_URL = url;
  expect(await tryLocalAutoLogin(request())).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([
  { host: "attacker.test" }, { "x-forwarded-host": "attacker.test" },
  { origin: "http://attacker.test" }, { "sec-fetch-site": "cross-site" },
  { cookie: "auth_token=existing" }, { cookie: "refresh_token=existing" },
])('rejects unsafe or already authenticated request %j', async (headers) => {
  expect(await tryLocalAutoLogin(request(undefined, headers))).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});
it("does not submit missing credentials or POST navigation", async () => {
  delete process.env.LOCAL_AUTO_LOGIN_PASSWORD;
  expect(await tryLocalAutoLogin(request())).toBeNull();
  expect(await tryLocalAutoLogin(new NextRequest("http://localhost:3000", { method: "POST" }))).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([{ ok: false }, { ok: true, json: async () => ({ success: true }) }])("fails closed on rejected or malformed login", async (response) => {
  fetchMock.mockResolvedValue(response);
  expect(await tryLocalAutoLogin(request())).toBeNull();
});
it("does not log credential-bearing network errors", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockRejectedValue(new Error("request failed"));
  expect(await tryLocalAutoLogin(request())).toBeNull(); expect(log).not.toHaveBeenCalled(); log.mockRestore();
});

it("accepts Next normalizing a loopback URL while preserving the incoming host", async () => {
  expect(await tryLocalAutoLogin(request(undefined, { host: "127.0.0.1:3000", "x-forwarded-host": "127.0.0.1:3000" }))).not.toBeNull();
});
it("rejects a mismatched loopback port", async () => {
  expect(await tryLocalAutoLogin(request(undefined, { host: "127.0.0.1:4000" }))).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not initiate login on POST even with credentials configured", async () => {
  expect(await tryLocalAutoLogin(new NextRequest("http://localhost:3000/dashboard", { method: "POST", headers: { host: "localhost:3000" } }))).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
