import fs from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.BASE_URL
    ?? config.projects[0]?.use.baseURL
    ?? "http://localhost:3000";
  if (process.env.RUN_AGENT_E2E === "1" && process.env.RUN_AGENT_REAL_E2E !== "1") {
    const url = new URL(baseURL);
    fs.writeFileSync(
      path.resolve(process.cwd(), "auth.json"),
      JSON.stringify({
        cookies: [
          {
            name: "auth_token",
            value: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJlMmUtdXNlciIsInJvbGUiOiJhZG1pbiIsImJyYW5jaElkIjoiMjAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiYnJhbmNoUm9sZSI6ImFkbWluIiwidHlwZSI6ImFjY2VzcyIsInNpZCI6ImFnZW50LWUyZSIsImV4cCI6NDEwMjQ0NDgwMH0.",
            domain: url.hostname,
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: url.protocol === "https:",
            sameSite: "Lax",
          },
          {
            name: "selected_branch_id",
            value: "20000000-0000-4000-8000-000000000001",
            domain: url.hostname,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: url.protocol === "https:",
            sameSite: "Lax",
          },
          {
            name: "e2e_auth",
            value: "1",
            domain: url.hostname,
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: url.protocol === "https:",
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
    );
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const response = await context.request.post("/api/auth/login", {
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
  await context.close();
  await browser.close();

  if (!fs.existsSync(path.resolve(process.cwd(), "auth.json"))) {
    throw new Error("Playwright auth storage state was not created");
  }
}
