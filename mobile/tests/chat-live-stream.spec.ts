import { expect, test } from "@playwright/test";

test.describe("Chat live stream smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Keep the live test deterministic: don't render persisted wizard markers from backend history.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("ai_chat_session_id");
      } catch {
        // ignore
      }
    });

    await page.route("**/api/ai/chat/history**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [],
          total: 0,
          hasMore: false,
          sessionId: null,
          isSessionActive: false,
        }),
      });
    });
  });

  test("streams a deterministic Gemini stub response on /chat", async ({ page }) => {
    page.on("console", (msg) => {
      // Useful when debugging auth/stream issues locally.
      if (["warning", "error"].includes(msg.type())) {
        console.log(`[browser:${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto("/chat");
    await expect(page.locator('[data-slot="chat-page"]')).toBeVisible({ timeout: 15000 });

    const input = page.locator('[data-component="mobile_chat_page_input-area_input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const start = Date.now();
    await input.fill("안녕하세요");
    await input.press("Enter");

    await expect(page.getByLabel("응답 작성 중")).toBeVisible({ timeout: 5000 });

    const assistantMessages = page.locator('[data-component="mobile_chat_page_content_messages_message-assistant"]');
    await expect(assistantMessages.last()).toContainText("[e2e-stub]", { timeout: 15000 });
    await expect(assistantMessages.last()).toContainText("안녕하세요", { timeout: 15000 });

    await expect(page.getByLabel("응답 작성 중")).toHaveCount(0, { timeout: 20000 });
    await expect(input).toBeEnabled({ timeout: 5000 });

    const ttfbMs = Date.now() - start;
    console.log(`[chat-live] time-to-first-response-ms=${ttfbMs}`);
  });

  test("typing the local registration command opens the wizard without calling SSE", async ({ page }) => {
    let sseCalled = 0;
    await page.route("**/api/ai/chat/stream", async (route) => {
      sseCalled += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "SSE should not be called for local wizard" }),
      });
    });

    await page.goto("/chat");
    await expect(page.locator('[data-slot="chat-page"]')).toBeVisible({ timeout: 15000 });

    const input = page.locator('[data-component="mobile_chat_page_input-area_input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill("산모 등록");
    await input.press("Enter");

    await expect(page.locator('[data-component="chat-wizard-registration"]').first()).toBeVisible({ timeout: 5000 });
    // "산모 등록" also appears inside the rendered wizard — scope to the
    // user's message bubble to avoid a strict-mode violation.
    await expect(
      page.locator('[data-component="mobile_chat_page_content_messages_message-user_body_bubble"]', { hasText: "산모 등록" }),
    ).toBeVisible({ timeout: 5000 });

    expect(sseCalled).toBe(0);
  });
});
