import { expect, test, type Page, type Route } from "@playwright/test";

const CLIENT_A = {
  id: 101,
  name: "삭제 지연 고객 A",
  phone: "010-1111-0101",
  address: "인천 남동구",
  serviceStatus: "waiting",
  startDate: null,
  endDate: null,
  dueDate: "2026-09-01",
};

const CLIENT_B = {
  id: 202,
  name: "선택 유지 고객 B",
  phone: "010-2222-0202",
  address: "인천 연수구",
  serviceStatus: "waiting",
  startDate: null,
  endDate: null,
  dueDate: "2026-09-02",
};

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
    { name: "auth_token", value: authToken, url: baseURL, sameSite: "Lax" },
    { name: "e2e_auth", value: "1", url: baseURL, sameSite: "Lax" },
  ]);
  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
    sessionStorage.clear();
  });
}

test("closes and unlocks the page before a pending delete settles", async ({ page }) => {
  await enableE2EAuth(page);

  let deleteSucceeded = false;
  let releaseDelete: (() => void) | undefined;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let markDeleteRequested: (() => void) | undefined;
  const deleteRequested = new Promise<void>((resolve) => {
    markDeleteRequested = resolve;
  });

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/clients/101" && request.method() === "DELETE") {
      markDeleteRequested?.();
      await deleteGate;
      deleteSucceeded = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname === "/api/clients") {
      const clients = deleteSucceeded ? [CLIENT_B] : [CLIENT_A, CLIENT_B];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: clients, total: clients.length, page: 1, limit: 50, totalPages: 1 }),
      });
    }
    if (pathname === "/api/auth/me") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "e2e-user", name: "E2E Tester", role: "admin", branchName: "테스트 지점" }) });
    }
    if (pathname.startsWith("/api/admin/service-records/client/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: null, assignments: [] }) });
    }
    if (pathname === "/api/eformsign-docs/client" || pathname === "/api/clients/alerts" || pathname === "/api/message-trigger-jobs/upcoming" || pathname === "/api/voucher-price-infos/years" || pathname === "/api/out-of-pocket-price-infos" || pathname === "/api/area-templates") {
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

  await page.goto("/clients");
  const listPanel = page.locator('[data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel"]');
  await listPanel.getByText(CLIENT_A.name, { exact: true }).click();
  await page.getByRole("button", { name: "고객 작업 메뉴 열기" }).click();
  await page.getByText("삭제", { exact: true }).click();

  const modal = page.locator('[data-component="desktop_clients_modals_delete-approval"]');
  await expect(modal).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe("none");
  await modal.getByRole("button", { name: "삭제" }).click();
  await deleteRequested;

  await expect(modal).toBeHidden();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await expect(listPanel.getByText(CLIENT_A.name, { exact: true })).toBeHidden();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe("auto");

  await listPanel.getByText(CLIENT_B.name, { exact: true }).click();
  releaseDelete?.();
  await expect.poll(() => deleteSucceeded).toBe(true);
  await expect(page.locator('[data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_title-group_title-row_title"]')).toHaveText(CLIENT_B.name);
});
