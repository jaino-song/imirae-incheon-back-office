import { expect, test, type Page, type Route } from "@playwright/test";

const LIST_SHELL =
  "mobile_messages_history_detail-sheet_stack_list-page_shell_content_list-card_body";
const UPCOMING_ROW = `${LIST_SHELL}_item-upcoming`;
const PAST_ROW = `${LIST_SHELL}_item`;

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

async function mockReadOnlyMessages(page: Page, options: { isApproved?: boolean } = {}) {
  const isApproved = options.isApproved ?? false;
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "e2e-user", name: "E2E", role: "admin" }),
      });
    }
    if (pathname === "/api/settings/message-sender-approval") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          isApproved
            ? { approvalStatus: "approved", isApproved: true, canRequest: false }
            : { approvalStatus: "not_requested", isApproved: false, canRequest: true },
        ),
      });
    }
    if (pathname === "/api/message-trigger-jobs/upcoming") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "job-waiting",
            ruleId: "rule-1",
            ruleName: "대기 메시지",
            eventType: "SERVICE_START",
            offsetType: "BEFORE_DAYS",
            offsetDays: 7,
            recipientType: "CLIENT",
            recipientPhone: "01011112222",
            templateKey: "SERVICE_INFO",
            status: "pending",
            scheduledFor: "2026-07-20T01:00:00.000Z",
            sentAt: null,
            canceledAt: null,
            cancelReason: null,
            clientId: 1,
            employeeScheduleId: null,
            payload: {
              memberId: "1",
              recipientName: "대기 고객",
              recipientPhone: "01011112222",
              templateVariables: {},
            },
            createdAt: "2026-07-16T01:00:00.000Z",
            updatedAt: "2026-07-16T01:00:00.000Z",
          },
        ]),
      });
    }
    if (pathname === "/api/message-logs") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "job:canceled",
            provider: "message_job",
            templateKey: "CLIENT_GREETING",
            triggerJobId: "canceled",
            receiver: "01077778888",
            clientId: 4,
            recipientPhone: "01077778888",
            messageBody: "",
            variables: {},
            status: "canceled",
            aligoMid: null,
            errorMessage: "메시지 발송 승인 필요",
            attempts: 0,
            lastAttemptAt: "2026-07-16T04:00:00.000Z",
            nextRetryAt: null,
            createdAt: "2026-07-16T04:00:00.000Z",
            updatedAt: "2026-07-16T04:00:00.000Z",
            ruleId: "rule-4",
            ruleName: "취소 메시지",
            eventType: "CLIENT_CREATED",
            offsetType: "IMMEDIATE",
            offsetDays: 0,
            scheduledFor: "2026-07-16T04:00:00.000Z",
            recipientType: "CLIENT",
            recipientName: "취소 고객",
            clientName: "취소 고객",
            employeeName: null,
          },
        ]),
      });
    }
    if (pathname === "/api/out-of-pocket-price-infos") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
    if (pathname === "/api/notifications/unread/count") {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

// 발송 예정 and 발송 기록 used to be two screens, and both were exempt from the
// sending-approval gate — the earlier version of these tests asserted that the
// content showed up *before* approval, which is the hole that got closed. The
// merged screen now surfaces upcoming sends and a cancel action, so it is
// gated like every other message screen.
test.describe("Mobile merged message record screen", () => {
  test.beforeEach(async ({ page }) => {
    await enableE2EAuth(page);
  });

  test("stays gated until the branch can send messages", async ({ page }) => {
    await mockReadOnlyMessages(page);
    await page.goto("/messages/history");

    // The guard renders the page and puts the approval modal over it rather
    // than unmounting the content, so the rows stay in the DOM and asserting
    // they are hidden would be asserting something the app never does. The
    // regression this protects is that the modal appears here at all: this
    // route used to be exempt from the approval check entirely, so typing the
    // URL walked straight past a nav item that looked disabled.
    await expect(page.getByText("메시지 전송 권한이 필요합니다.")).toBeVisible();
  });

  test("shows upcoming and past sends together once approved", async ({ page }) => {
    await mockReadOnlyMessages(page, { isApproved: true });
    await page.goto("/messages/history");

    await expect(page.locator(".list-card .list-title-text")).toContainText("발송 기록");
    await expect(page.getByText("메시지 전송 권한이 필요합니다.")).not.toBeVisible();

    // Scoped to the row, not matched by text: 발송 취소 is the canceled status
    // label AND the cancel button's label AND the confirm dialog's button, so a
    // bare getByText hits three elements on this screen.
    const upcomingRow = page
      .locator(`[data-component="${UPCOMING_ROW}"]`)
      .filter({ hasText: "대기 고객" });
    await expect(upcomingRow).toContainText("발송 대기");

    const pastRow = page
      .locator(`[data-component="${PAST_ROW}"]`)
      .filter({ hasText: "취소 고객" });
    await expect(pastRow).toContainText("발송 취소");
  });

  test("keeps the old scheduled URL working by redirecting", async ({ page }) => {
    await mockReadOnlyMessages(page, { isApproved: true });
    await page.goto("/messages/scheduled");

    await expect(page).toHaveURL(/\/messages\/history$/);
  });
});
