import fs from "node:fs";
import path from "node:path";
import { request, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.BASE_URL
    ?? config.projects[0]?.use.baseURL
    ?? "http://localhost:3002";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: {
      email: process.env.E2E_AUTH_EMAIL ?? "admin-a@auth-e2e.test",
      password: process.env.E2E_AUTH_PASSWORD ?? "Password1!",
      autoLogin: true,
    },
  });
  const loginResult = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok() || loginResult?.success !== true) {
    throw new Error(`Real E2E login failed with ${response.status()} and no successful session`);
  }

  const branchId = process.env.E2E_BRANCH_ID
    ?? "20000000-0000-4000-8000-000000000001";
  const url = new URL(baseURL);
  const storageState = await context.storageState();
  if (!storageState.cookies.some((cookie) => cookie.name === "auth_token")) {
    throw new Error("Real E2E login returned without an auth_token cookie");
  }
  storageState.cookies.push({
    name: "selected_branch_id",
    value: branchId,
    domain: url.hostname,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  });
  fs.writeFileSync(
    path.resolve(process.cwd(), "auth.json"),
    JSON.stringify(storageState),
  );
  await context.dispose();
}
