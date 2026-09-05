import { expect, test, type Page, type Route } from "@playwright/test";

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

async function mockMessageReads(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user",
          name: "E2E Tester",
          // The 발송 예정 / 발송 기록 sections are 출시 예정 and owner-only.
          role: "owner",
          branchName: "테스트 지점",
        }),
      });
    }
    if (pathname === "/api/settings/message-sender-approval") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          approvalStatus: "not_requested",
          isApproved: false,
          canRequest: true,
        }),
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
          {
            id: "job-processing",
            ruleId: "rule-2",
            ruleName: "처리 메시지",
            eventType: "SERVICE_START",
            offsetType: "SAME_DAY",
            offsetDays: 0,
            recipientType: "CLIENT",
            recipientPhone: "01033334444",
            templateKey: "SERVICE_INFO",
            status: "processing",
            scheduledFor: "2026-07-20T02:00:00.000Z",
            sentAt: null,
            canceledAt: null,
            cancelReason: null,
            clientId: 2,
            employeeScheduleId: null,
            payload: {
              memberId: "2",
              recipientName: "처리 고객",
              recipientPhone: "01033334444",
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
            id: "job:failed",
            provider: "message_job",
            templateKey: "SERVICE_INFO",
            triggerJobId: "failed",
            receiver: "01055556666",
            clientId: 3,
            recipientPhone: "01055556666",
            messageBody: "",
            variables: {},
            status: "failed",
            aligoMid: null,
            errorMessage: "provider timeout",
            attempts: 1,
            lastAttemptAt: "2026-07-16T03:00:00.000Z",
            nextRetryAt: null,
            createdAt: "2026-07-16T03:00:00.000Z",
            updatedAt: "2026-07-16T03:00:00.000Z",
            ruleId: "rule-3",
            ruleName: "실패 메시지",
            eventType: "SERVICE_START",
            offsetType: "SAME_DAY",
            offsetDays: 0,
            scheduledFor: "2026-07-16T03:00:00.000Z",
            recipientType: "CLIENT",
            recipientName: "실패 고객",
            clientName: "실패 고객",
            employeeName: null,
          },
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
    if (pathname === "/api/notifications/unread/count") {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' });
    }
    if (
      pathname === "/api/message-templates"
      || pathname === "/api/clients"
      || pathname === "/api/clients/alerts"
    ) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test.describe("Message read-only status surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await enableE2EAuth(page);
    await mockMessageReads(page);
  });

  test("shows waiting and processing jobs before sender approval", async ({ page }) => {
    await page.goto("/messages");
    await page.getByRole("button", { name: "발송 예정" }).click();

    await expect(page.getByText("대기 고객")).toBeVisible();
    await expect(page.getByText("처리 고객")).toBeVisible();
    await expect(page.getByText("발송 대기", { exact: true })).toBeVisible();
    await expect(page.getByText("발송 중", { exact: true })).toBeVisible();
    await expect(page.getByText("메시지 전송 권한이 필요합니다.")).not.toBeVisible();
  });

  test("shows failed and canceled jobs in history before sender approval", async ({ page }) => {
    await page.goto("/messages");
    await page.getByRole("button", { name: "발송 기록" }).click();

    await expect(page.getByText("실패 고객").first()).toBeVisible();
    await expect(page.getByText("취소 고객").first()).toBeVisible();
    await expect(page.getByText("발송 실패", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("발송 취소", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("메시지 전송 권한이 필요합니다.")).not.toBeVisible();
  });
});
