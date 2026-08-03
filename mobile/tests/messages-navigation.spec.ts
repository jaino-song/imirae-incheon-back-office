import { expect, test, type Page, type Route } from "@playwright/test";

async function mockMessagesApproval(page: Page) {
  await page.route("**/api/settings/message-sender-approval", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        approvalStatus: "approved",
        isApproved: true,
        canRequest: true,
        senderPhone: "01012345678",
        senderPhoneFormatted: "010-1234-5678",
      }),
    });
  });
}

// The 출시 예정 sections are owner-only, so the navigation test runs as the owner.
async function mockOwnerUser(page: Page) {
  const body = JSON.stringify({
    id: "e2e-owner",
    name: "E2E Owner",
    role: "owner",
    branchName: "테스트 지점",
  });

  await page.route("**/api/auth/me", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.route("**/auth/me", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

async function enableOwnerE2EUser(page: Page) {
  await page.goto("/messages");
  await page.context().addCookies([
    {
      name: "e2e_role",
      value: "owner",
      url: new URL(page.url()).origin,
    },
  ]);
  await page.reload();
}

test.describe("mobile messages navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockMessagesApproval(page);
    await mockOwnerUser(page);
  });

  test("exposes the currently available message sections as mobile destinations", async ({ page }) => {
    await enableOwnerE2EUser(page);

    const expectedDestinations = [
      ["전송하기", "/messages/new"],
      ["발송 예정", "/messages/scheduled"],
      ["발송 기록", "/messages/history"],
      ["템플릿", "/messages/templates"],
      ["자동 전송", "/messages/automation"],
      ["설정", "/messages/settings"],
    ] as const;

    const sectionNavigation = page.getByRole("navigation", { name: "메시지 기능" });
    await expect(sectionNavigation).toBeVisible();

    for (const [label, href] of expectedDestinations) {
      await page.goto("/messages");
      const destinationButton = page.getByRole("button", { name: label });
      await expect(destinationButton).toBeEnabled({ timeout: 15000 });
      await destinationButton.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    }
  });

  test("shows live SMS history data on the dedicated history route", async ({ page }) => {
    await page.route("**/api/message-logs**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            provider: "aligo_sms",
            templateKey: "CLIENT_GREETING",
            triggerJobId: null,
            receiver: "01012345678",
            clientId: 1,
            recipientPhone: "01012345678",
            messageBody: "안녕하세요",
            variables: {},
            status: "sent",
            aligoMid: null,
            errorMessage: null,
            attempts: 1,
            lastAttemptAt: "2026-07-16T01:00:00.000Z",
            nextRetryAt: null,
            createdAt: "2026-07-16T01:00:00.000Z",
            updatedAt: "2026-07-16T01:00:00.000Z",
            ruleId: null,
            ruleName: null,
            eventType: "CLIENT_CREATED",
            offsetType: "IMMEDIATE",
            offsetDays: 0,
            scheduledFor: null,
            recipientType: "CLIENT",
            recipientName: "문자 고객",
            clientName: "문자 고객",
            employeeName: null,
          },
        ]),
      });
    });

    await page.goto("/messages/history");

    await expect(page.locator(".list-card .list-title-text")).toContainText("발송 기록");
    await expect(page.getByText("문자 고객")).toBeVisible();
    await expect(page.getByText("1건")).toBeVisible();

    await page.getByRole("button", { name: /인사 메시지/ }).click();

    await expect(
      page.locator('[data-component="mobile_messages_history_detail-sheet_stack_detail-page_body"]'),
    ).toBeVisible();
    await expect(page.getByText("발송 정보")).toBeVisible();
    await expect(page.getByText("01012345678")).toBeVisible();
    await expect(page.getByText("안녕하세요")).toBeVisible();

    await page
      .locator('[data-component="mobile_messages_history_detail-sheet_stack_detail-page"] .sheet-close')
      .click();

    await expect(page.locator(".list-card .list-title-text")).toContainText("발송 기록");
    await expect(page.getByText("01012345678")).not.toBeVisible();
  });

  test("shows upcoming SMS jobs on the dedicated scheduled route", async ({ page }) => {
    await page.route("**/api/message-trigger-jobs/upcoming**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "job-101",
            ruleId: "rule-101",
            ruleName: "서비스 안내",
            eventType: "SERVICE_START",
            offsetType: "BEFORE_DAYS",
            offsetDays: 7,
            recipientType: "CLIENT",
            recipientPhone: "01098765432",
            templateKey: "SERVICE_INFO",
            status: "pending",
            scheduledFor: "2026-07-17T01:00:00.000Z",
            sentAt: null,
            canceledAt: null,
            cancelReason: null,
            clientId: 2,
            employeeScheduleId: null,
            payload: {
              memberId: "member-101",
              recipientName: "예정 고객",
              recipientPhone: "01098765432",
              templateVariables: {},
            },
            createdAt: "2026-07-16T01:00:00.000Z",
            updatedAt: "2026-07-16T01:00:00.000Z",
          },
        ]),
      });
    });

    await page.goto("/messages/scheduled");

    await expect(page.locator(".list-card .list-title-text")).toContainText("발송 예정");
    await expect(page.getByText("예정 고객")).toBeVisible();
    await expect(page.getByText("1건")).toBeVisible();
  });
});
