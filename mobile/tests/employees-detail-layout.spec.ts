import { expect, type Page, test } from "@playwright/test";

const MOCK_EMPLOYEES = [
  {
    id: 101,
    name: "김정인",
    workArea: ["incheon-namdong"],
    phone: "010-1111-2222",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-05-30",
    status: "working",
  },
  {
    id: 102,
    name: "박지영",
    workArea: [],
    phone: "010-3333-4444",
    grade: "B",
    openToNextWork: false,
    registeredDate: "2026-03-08T00:00:00.000Z",
    status: "unavailable",
  },
  {
    id: 103,
    name: "오류테스트",
    workArea: ["incheon-namdong"],
    phone: "010-5555-6666",
    grade: "A",
    openToNextWork: false,
    registeredDate: "2026-04-12",
    status: "available",
  },
];

const MOCK_ACTIVE_CLIENTS = [
  {
    clientId: 201,
    clientName: "윤정아",
    role: "primary",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
  },
];

const MOCK_WORK_HISTORY = [
  {
    scheduleId: 301,
    clientId: 201,
    clientName: "윤정아",
    role: "primary",
    startDate: "2025-01-01",
    endDate: "2025-06-30",
    status: "completed",
  },
  {
    scheduleId: 302,
    clientId: 202,
    clientName: "김하늘",
    role: "secondary",
    startDate: "2024-03-01",
    endDate: "2024-12-31",
    status: "replaced",
  },
];

async function mockEmployeesApi(page: Page) {
  await page.route("**/api/employees**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    const pathname = new URL(route.request().url()).pathname;
    let body: unknown;

    if (pathname === "/api/employees") {
      body = MOCK_EMPLOYEES;
    } else if (pathname === "/api/employees/101/active-clients") {
      body = MOCK_ACTIVE_CLIENTS;
    } else if (pathname === "/api/employees/102/active-clients") {
      body = [];
    } else if (pathname === "/api/employees/103/active-clients") {
      body = [];
    } else if (pathname === "/api/employees/101/work-history") {
      body = {
        data: MOCK_WORK_HISTORY,
        total: MOCK_WORK_HISTORY.length,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
    } else if (pathname === "/api/employees/102/work-history") {
      body = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    } else if (pathname === "/api/employees/103/work-history") {
      body = { error: "internal employee schedule details" };
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      return;
    } else {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("employees mobile detail layout", () => {
  test("uses the shared absolute detail-sheet geometry", async ({ page }) => {
    await mockEmployeesApi(page);

    await page.goto("/employees");
    await expect(page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]')).toHaveCount(3, {
      timeout: 15000,
    });

    const row = page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]');
    await expect(row).toHaveCount(3);
    const assignedRow = page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]', {
      hasText: "김정인",
    });
    await expect(assignedRow).toHaveCount(1);
    await assignedRow.click();

    const stack = page.locator('[data-component="mobile_employees_detail-sheet_stack"]');
    const detailPage = page.locator(
      '[data-component="mobile_employees_detail-sheet_stack_detail-page"][data-slot="mobile-detail-stack-detail-page"]',
    );
    const listPage = page.locator(
      '[data-component="mobile_employees_detail-sheet_stack_list-page"]',
    );

    await expect(stack).toHaveClass(/show-detail/);
    await expect(stack).toHaveCSS("position", "absolute");
    await expect(listPage).toHaveCSS("position", "absolute");
    await expect(detailPage).toHaveCSS("position", "absolute");
    await expect(detailPage).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    const geometry = await detailPage.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      return {
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        position: style.position,
        right: Math.round(rect.right),
        top: Math.round(rect.top),
      };
    });

    expect(geometry.position).toBe("absolute");
    expect(geometry.left).toBe(0);
    expect(geometry.right).toBe(390);
    expect(geometry.bottom).toBe(844);
    expect(geometry.top).toBeGreaterThan(0);
    expect(geometry.top).toBeLessThan(60);
    await expect(page.getByText("2026.05.30")).toBeVisible();

    await page.getByRole("button", { name: "담당 고객" }).click();
    await expect(page.locator(".info-card-title", { hasText: "현재 담당" })).toBeVisible();
    await expect(page.locator(".info-card-title", { hasText: "이전 담당" })).toBeHidden();

    await page.getByRole("button", { name: "근무 내역" }).click();
    await expect(page.getByText("윤정아")).toHaveCount(2);
    await expect(page.getByText("2025.01.01 ~ 2025.06.30 · 주담당")).toBeVisible();
    await expect(page.getByText("종료")).toBeVisible();
    await expect(page.getByText("김하늘")).toBeVisible();
    await expect(page.getByText("교체됨")).toBeVisible();
  });

  test("shows an empty state when the employee has no assigned client", async ({ page }) => {
    await mockEmployeesApi(page);

    await page.goto("/employees");
    await expect(page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]')).toHaveCount(3, {
      timeout: 15000,
    });

    const unassignedRow = page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]', {
      hasText: "박지영",
    });
    await expect(unassignedRow).toHaveCount(1);
    await unassignedRow.click();
    await page.getByRole("button", { name: "담당 고객" }).click();

    await expect(page.locator('[data-component="mobile_employees_detail-panel_info-card-3_empty"]')).toHaveText(
      "현재 담당 고객이 없습니다.",
    );

    await page.getByRole("button", { name: "근무 내역" }).click();
    await expect(page.locator('[data-component="mobile_employees_detail-panel_info-card-4_empty"]')).toHaveText(
      "근무 내역이 없습니다.",
    );
  });

  test("shows a retryable sanitized error when work history is unavailable", async ({ page }) => {
    await mockEmployeesApi(page);

    await page.goto("/employees");
    await expect(page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]')).toHaveCount(3, {
      timeout: 15000,
    });

    const errorRow = page.locator('[data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"]', {
      hasText: "오류테스트",
    });
    await errorRow.click();
    await page.getByRole("button", { name: "근무 내역" }).click();

    await expect(page.getByText("근무 내역을 불러오지 못했어요")).toBeVisible();
    await expect(page.getByText("잠시 후 다시 시도해 주세요.")).toBeVisible();
    await expect(page.getByText("internal employee schedule details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });
});
