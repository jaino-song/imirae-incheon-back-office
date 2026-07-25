import { expect, test, type Page } from "@playwright/test";

const CLIENT = {
  id: 62,
  name: "송진호",
  birthday: "960414",
  dueDate: "2026-06-26",
  address: "경기도 고양시",
  phone: "010-6621-1878",
  primaryEmployee: { id: 1, name: "송진호" },
  secondaryEmployee: null,
  type: "A통합2형",
  duration: 23,
  fullPrice: "2136000",
  grant: "1494000",
  actualPrice: "642000",
  startDate: "2026-07-14",
  endDate: "2026-08-05",
  careCenter: true,
  voucherClient: true,
  breastPump: true,
  serviceStatus: "active",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const SMS_LOG = {
  id: 31,
  provider: "aligo_sms",
  templateKey: "service_info_sms",
  receiver: "010-6621-1878",
  recipientPhone: "010-6621-1878",
  recipientName: CLIENT.name,
  clientId: CLIENT.id,
  messageBody: "서비스 안내 메시지입니다.",
  status: "sent",
  errorMessage: null,
  createdAt: "2026-07-12T16:58:00.710Z",
  ruleName: null,
  variables: null,
};

async function enableE2EAuth(page: Page) {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([{
    name: "e2e_auth",
    value: "1",
    url: baseURL,
    sameSite: "Lax",
  }]);
  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });
}

test("dashboard client detail uses the same message history as the clients page", async ({ page }) => {
  await enableE2EAuth(page);
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-user",
        name: "E2E Tester",
        role: "admin",
        branchName: "테스트 지점",
      }),
    });
  });
  await page.route("**/api/notifications/unread/count", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    });
  });
  await page.route("**/api/clients/analytics", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeClients: 1,
        contractsNotSent: 1,
        contractsPendingSignature: 0,
        upcomingThisMonth: 0,
        upcomingNextMonth: 0,
      }),
    });
  });
  await page.route("**/api/clients?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [CLIENT],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
    });
  });
  await page.route("**/api/message-logs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([SMS_LOG]),
    });
  });

  await page.goto("/dashboard");
  await page.locator('[data-component="mobile-redesign-list-row"]', { hasText: CLIENT.name }).click();
  await page.locator('[data-component="mobile-redesign-detail-tabs"] [data-tab="message"]').click();

  const messageTab = page.locator('[data-component="mobile_dashboard_detail-sheet_stack_detail-page_content_tab-panel_message"]');
  await expect(messageTab).toContainText("메시지 · 메시지");
  await expect(messageTab).not.toContainText("발송 내역이 없습니다.");
});
