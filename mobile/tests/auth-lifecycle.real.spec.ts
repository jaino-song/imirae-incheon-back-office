import { expect, test } from "@playwright/test";

test("uses a real backend login session on mobile", async ({ request }) => {
  const response = await request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const user = (await response.json()) as { email?: string; role?: string };
  // Builds with NEXT_PUBLIC_E2E_TEST inlined stub /api/auth/me (lib/e2e.ts),
  // so the real-session assertion is unverifiable there.
  test.skip(
    user.email === "e2e@example.com",
    "app built with E2E auth stub — real session not observable via /api/auth/me",
  );
  expect(user).toMatchObject({
    email: "admin-a@auth-e2e.test",
    role: "admin",
  });
});

test("mobile registration is accepted once and delivered through Mailpit", async ({ request }) => {
  const suffix = Date.now().toString().slice(-8);
  const email = `mobile-${suffix}@auth-e2e.test`;
  const before = await request.get("http://localhost:8025/api/v1/messages");
  const beforeTotal = ((await before.json()) as { total?: number }).total ?? 0;

  const registration = await request.post("/api/auth/register", {
    data: {
      email,
      password: "Password1!",
      name: "모바일테스트",
      phone: `010${suffix}`,
      birthDate: "1990-01-01",
      branchId: "20000000-0000-4000-8000-000000000001",
      role: "user",
    },
  });
  expect(registration.status()).toBe(201);

  await expect.poll(async () => {
    const messages = await request.get("http://localhost:8025/api/v1/messages");
    return (((await messages.json()) as { total?: number }).total ?? 0);
  }, { timeout: 20_000 }).toBeGreaterThan(beforeTotal);
});
