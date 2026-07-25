import { expect, test } from "@playwright/test";

const CLIENT = {
  id: 101,
  name: "테스트 고객",
  createdAt: "2026-05-30T01:00:00.000Z",
  updatedAt: "2026-05-30T01:00:00.000Z",
  birthday: "900101",
  dueDate: "2026-05-30",
  address: "인천 남동구",
  phone: "010-1111-2222",
  primaryEmployee: { id: 1, name: "김정인" },
  secondaryEmployee: null,
  type: "A통합2형",
  duration: 10,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-05-31",
  endDate: "2026-06-09",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "active",
  eDocId: "DOC-CLIENT-101",
  hasSigned: true,
  documentStatus: "completed",
};

const ACTIVE_CLIENT_WITHOUT_CONTRACT = {
  ...CLIENT,
  id: 102,
  name: "계약서 없는 고객",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const CLIENT_SMS_LOG = {
  id: 201,
  provider: "aligo_sms",
  templateKey: "manual_sms",
  receiver: "010-9999-8888",
  recipientPhone: "+82 10-1111-2222",
  recipientName: CLIENT.name,
  clientId: null,
  messageBody: "테스트 문자입니다.",
  status: "sent",
  errorMessage: null,
  attempts: 1,
  createdAt: "2026-07-16T09:00:00.000Z",
  updatedAt: "2026-07-16T09:00:00.000Z",
  ruleName: null,
  eventType: null,
  clientName: CLIENT.name,
  employeeName: null,
};

test.describe("Mobile clients detail labels", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/employees", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/message-logs**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([CLIENT_SMS_LOG]),
      });
    });
  });

  test("keeps the client card above the shared bottom navigation", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
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

    await page.goto("/clients");
    await expect(page.locator('[data-component="mobile-clients-row"]')).toBeVisible({ timeout: 15000 });

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        const box = element?.getBoundingClientRect();
        return box
          ? {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              right: box.right,
              bottom: box.bottom,
            }
          : null;
      };
      const nav = document.querySelector('[data-component="mobile-bottom-nav"]');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        appRoot: rect('[data-component="app-root"]'),
        appShell: rect('[data-slot="app-shell"]'),
        appContent: rect('[data-slot="app-content"]'),
        card: rect('[data-component="mobile-redesign-list-card"]'),
        nav: rect('[data-component="mobile-bottom-nav"]'),
        navPosition: nav ? getComputedStyle(nav).position : null,
      };
    });

    expect(geometry.appRoot).toEqual({
      x: 0,
      y: 0,
      width: geometry.viewport.width,
      height: geometry.viewport.height,
      right: geometry.viewport.width,
      bottom: geometry.viewport.height,
    });
    expect(geometry.appShell).toEqual(geometry.appRoot);
    expect(geometry.appContent).toEqual(geometry.appRoot);
    expect(geometry.card).not.toBeNull();
    expect(geometry.nav).not.toBeNull();
    if (!geometry.card || !geometry.nav) {
      throw new Error("Client card and bottom navigation should be measurable");
    }

    expect(geometry.navPosition).toBe("absolute");
    expect(geometry.nav.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.nav.y - 8);
  });

  test("uses the compact notification labels in the client detail sheet", async ({ page }) => {
    await page.route(`**/api/clients/${CLIENT.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CLIENT),
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

    await page.goto("/clients");
    await expect(page.locator('[data-component="mobile-clients-row"]')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-component="mobile-clients-row"]', { hasText: CLIENT.name }).click();
    const notificationTabButton = page.locator('[data-component="mobile-redesign-detail-tabs"] [data-tab="message"]');
    await expect(notificationTabButton).toBeVisible();
    await notificationTabButton.dispatchEvent("click");

    const messageTab = page.locator('[data-component="mobile_clients_detail-sheet_stack_detail-page_content_tab-panel_message"]');
    await expect(messageTab).toBeVisible();
    await expect(messageTab.locator(".info-card-title")).toHaveText("발송 내역");
    await expect(messageTab).toContainText("메시지 · 수동 메시지");
    await expect(page.getByRole("button", { name: "알림톡 발송 현황" })).toHaveCount(0);
    await expect(messageTab.locator(".info-card-title")).not.toContainText("알림톡 ·");

    await page.route("**/messages/new**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>메시지 작성</body></html>",
      });
    });
    await page.getByRole("button", { name: "메시지", exact: true }).click();
    await expect(page).toHaveURL(`/messages/new?clientId=${CLIENT.id}`);
  });

  test("shows the missing contract badge next to the client status badge", async ({ page }) => {
    await page.route("**/api/clients?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [ACTIVE_CLIENT_WITHOUT_CONTRACT],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      });
    });

    await page.goto("/clients");
    await expect(page.locator('[data-component="mobile-clients-row"]')).toBeVisible({ timeout: 15000 });

    const filterPills = page.locator('[data-component="mobile-redesign-filter-pill"]');
    await expect(filterPills.nth(0)).toContainText("전체");
    await expect(filterPills.nth(0)).toContainText("1");
    await expect(filterPills.nth(1)).toContainText("계약서 필요");
    await expect(filterPills.nth(1)).toContainText("1");
    await filterPills.nth(1).click();

    const row = page.locator('[data-component="mobile-clients-row"]', {
      hasText: ACTIVE_CLIENT_WITHOUT_CONTRACT.name,
    });
    const badges = row.locator('[data-component="mobile-redesign-list-row-badges"] [data-component="status-badge"]');

    await expect(badges).toHaveText(["계약서 필요"]);
    await expect(row.locator('[data-component="mobile-redesign-list-row-badges-more"]')).toHaveText("+1");
  });

  test("shows a request error instead of a false empty message history", async ({ page }) => {
    await page.route("**/api/message-logs**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to fetch message logs" }),
      });
    });
    await page.route(`**/api/clients/${CLIENT.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CLIENT),
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

    await page.goto("/clients");
    await page.locator('[data-component="mobile-clients-row"]', { hasText: CLIENT.name }).click();
    await page.locator('[data-component="mobile-redesign-detail-tabs"] [data-tab="message"]').click();

    const messageTab = page.locator('[data-component="mobile_clients_detail-sheet_stack_detail-page_content_tab-panel_message"]');
    await expect(messageTab).toContainText("발송 내역을 불러오지 못했습니다.");
    await expect(messageTab).not.toContainText("발송 내역이 없습니다.");
    await expect(messageTab.locator('[data-component="mobile-clients-message-retry"]')).toBeVisible();
  });
});
