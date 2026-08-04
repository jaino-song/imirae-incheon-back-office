import { expect, test } from "@playwright/test";

const enabled = process.env.RUN_AGENT_REAL_E2E === "1";

test.describe("Mobile operational copilot real backend", () => {
  test("streams through the mobile proxy and restores the server-owned session", async ({ page }) => {
    test.skip(!enabled, "Run with RUN_AGENT_REAL_E2E=1 after building with the agent shell enabled");
    await page.goto("/chat");
    await expect(page.locator('[data-component="mobile_chat_agent-shell"]')).toBeVisible();

    const input = page.getByLabel("질문 입력");
    await input.fill("홍길동 산모 찾아줘");
    await input.press("Enter");
    await expect(page.getByText("[agent-e2e-stub] 조회 결과를 확인했습니다.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "전송" })).toBeVisible();

    await page.getByRole("button", { name: "대화 목록" }).click();
    await expect(page.getByText("브랜치별 대화는 안전하게 분리됩니다.")).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();

    await page.reload();
    await expect(page.locator('[data-component="mobile_chat_agent-shell"]')).toBeVisible();
    await page.getByRole("button", { name: "대화 목록" }).click();
    await expect(page.locator('[data-component="mobile_chat_agent-shell_drawer"] button').first()).toBeVisible();
  });
});
