import { expect, test, type Page, type Route } from "@playwright/test";

const SERVICE_RECORD_URL = "https://mobile.test/service-record/efl_reset";

async function enableE2EAuth(page: Page) {
    const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
    const tokenPayload = Buffer.from(JSON.stringify({
        exp: 4_102_444_800,
        sub: "e2e-user",
        sid: "e2e-session",
        type: "access",
        branchId: "branch-1",
        role: "admin",
    })).toString("base64url");
    const authToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${tokenPayload}.e2e`;
    await page.context().addCookies([
        {
            name: "auth_token",
            value: authToken,
            url: baseURL,
            sameSite: "Lax",
        },
        {
            name: "e2e_auth",
            value: "1",
            url: baseURL,
            sameSite: "Lax",
        },
    ]);
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
        sessionStorage.clear();
    });
}

test("resets the service-record link without resending a message and shows the URL", async ({ page }) => {
    await enableE2EAuth(page);
    let resetRequestCount = 0;
    let sendRequestCount = 0;
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.route("**/api/**", async (route: Route) => {
        const pathname = new URL(route.request().url()).pathname;

        if (pathname === "/api/auth/me") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: "e2e-user",
                    name: "E2E Tester",
                    role: "admin",
                    branchName: "테스트 지점",
                }),
            });
        }
        if (pathname === "/api/clients") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    data: [{
                        id: 1,
                        name: "링크 테스트 고객",
                        phone: "010-3333-4444",
                        address: "인천 남동구",
                        serviceStatus: "active",
                        startDate: "2026-07-01",
                        endDate: "2026-07-31",
                        dueDate: "2026-07-01",
                    }],
                    total: 1,
                    page: 1,
                    limit: 50,
                    totalPages: 1,
                }),
            });
        }
        if (pathname === "/api/clients/1") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 1,
                    name: "링크 테스트 고객",
                    phone: "010-3333-4444",
                    address: "인천 남동구",
                    serviceStatus: "active",
                    startDate: "2026-07-01",
                    endDate: "2026-07-31",
                    dueDate: "2026-07-01",
                }),
            });
        }
        if (pathname === "/api/admin/service-records/client/1") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    record: null,
                    assignments: [{
                        scheduleId: 51,
                        startDate: "2026-07-01",
                        endDate: "2026-07-31",
                        replaced: false,
                        employee: { id: 30, name: "관리사", phone: "010-1111-2222" },
                        link: {
                            status: "sent",
                            scheduledFor: null,
                            sentCount: 1,
                            lastSentAt: "2026-07-01",
                            token: null,
                        },
                        header: null,
                        totalSessions: 0,
                        sessions: [],
                        signatureDoc: null,
                    }],
                }),
            });
        }
        if (pathname === "/api/eformsign-docs/client") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (pathname === "/api/admin/service-records/schedules/51/reset-link") {
            resetRequestCount += 1;
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({
                    serviceRecordUrl: SERVICE_RECORD_URL,
                    expiresAt: "2026-07-31T11:00:00.000Z",
                }),
            });
        }
        if (pathname === "/api/admin/service-records/schedules/51/send-link") {
            sendRequestCount += 1;
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({ ok: true }),
            });
        }
        if (pathname === "/api/clients/alerts" || pathname === "/api/message-trigger-jobs/upcoming") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (pathname === "/api/notifications/unread/count") {
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' });
        }
        if (pathname === "/api/settings/client-registration-policy") {
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false}' });
        }

        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/clients?id=1");
    await expect(page.getByText("링크 테스트 고객", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.getByRole("button", { name: "고객 작업 메뉴 열기" }).click();
    await page.getByText("제공기록지 링크 재설정", { exact: true }).click();

    const approval = page.locator('[data-component="desktop_clients_modals_reset-service-record-link-approval"]');
    await expect(approval).toContainText("메시지는 발송되지 않습니다.");
    await approval.getByRole("button", { name: "링크 재설정" }).click();

    const result = page.locator('[data-component="clients-detail-reset-service-record-link-result"]');
    await expect(result).toBeVisible();
    await expect(result.getByRole("textbox", { name: "제공기록지 링크" })).toHaveValue(SERVICE_RECORD_URL);
    expect(resetRequestCount).toBe(1);
    expect(sendRequestCount).toBe(0);
});
