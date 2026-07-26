import { test, expect, type Page } from "@playwright/test";

import { diffBusinessDaysKr, isoDateInKorea } from "../src/lib/date/business-days";

declare global {
  interface Window {
    __v3AnimEvents?: Array<{ name: string; comp: string | null; t: number }>;
  }
}

type MockEmployee = {
  id: number;
  name: string;
} | null;

type MockClient = {
  id: number;
  name: string;
  birthday: string | null;
  dueDate: string | null;
  address: string;
  phone: string;
  primaryEmployee: MockEmployee;
  secondaryEmployee: MockEmployee;
  type: string;
  duration: number | null;
  fullPrice: number | null;
  grant: number | null;
  actualPrice: number | null;
  startDate: string | null;
  endDate: string | null;
  careCenter: boolean;
  voucherClient: boolean;
  breastPump: boolean;
  serviceStatus: string | null;
  eDocId: string | null;
  hasSigned: boolean;
  documentStatus: string | null;
};

type ClientsApiResponse = {
  data: MockClient[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const DEFAULT_ANALYTICS = {
  activeClients: 1,
  contractsNotSent: 2,
  contractsPendingSignature: 3,
  upcomingThisMonth: 4,
  upcomingNextMonth: 5,
};

function createMockClient({
  id,
  name,
  ...overrides
}: Partial<MockClient> & Pick<MockClient, "id" | "name">): MockClient {
  return {
    id,
    name,
    birthday: null,
    dueDate: null,
    address: "서울시 강남구",
    phone: "010-1111-2222",
    primaryEmployee: { id: 1, name: "이영희" },
    secondaryEmployee: null,
    type: "산모신생아",
    duration: 25,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

function createClientsResponse(clients: MockClient[], total = clients.length): ClientsApiResponse {
  return {
    data: clients,
    total,
    page: 1,
    limit: 50,
    totalPages: Math.max(1, Math.ceil(total / 50)),
  };
}

async function mockClientsRoute(
  page: Page,
  handler: (
    url: string
  ) =>
    | {
        status?: number;
        body: unknown;
      }
    | Promise<{
        status?: number;
        body: unknown;
      }>
) {
  await page.route("**/api/clients*", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/clients/analytics")) {
      await route.fallback();
      return;
    }

    const response = await handler(url);
    await route.fulfill({
      status: response.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });
}

async function mockAnalyticsRoute(page: Page, delayMs = 0, body = DEFAULT_ANALYTICS) {
  await page.route("**/api/clients/analytics", async (route) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("Dashboard activities animations", () => {
  test("does not re-run intro/list animations when analytics loading completes", async ({ page }) => {
    // Collect only our v3 animations
    await page.addInitScript(() => {
      window.__v3AnimEvents = [];
      document.addEventListener(
        "animationstart",
        (e) => {
          const animName = (e as AnimationEvent).animationName || "";
          if (!animName.startsWith("v3-")) return;
          const target = e.target as HTMLElement | null;
          const comp = target?.dataset?.component ?? null;
          window.__v3AnimEvents?.push({ name: animName, comp, t: performance.now() });
        },
        true
      );
    });

    await mockClientsRoute(page, () => ({
      body: createClientsResponse([
        createMockClient({
          id: 1,
          name: "김교체",
          address: "서울시 강남구",
          phone: "010-1111-2222",
          primaryEmployee: { id: 1, name: "이영희" },
          serviceStatus: "replacement_requested",
        }),
        createMockClient({
          id: 2,
          name: "박서명",
          address: "서울시 서초구",
          phone: "010-3333-4444",
          primaryEmployee: { id: 2, name: "박지수" },
          dueDate: "2026-04-01",
          duration: 20,
          startDate: "2026-02-20",
          endDate: "2026-03-11",
          serviceStatus: "active",
          eDocId: "edoc-123",
          documentStatus: "opened",
        }),
        createMockClient({
          id: 3,
          name: "이발송",
          address: "서울시 송파구",
          phone: "010-5555-6666",
          primaryEmployee: { id: 3, name: "김현수" },
          serviceStatus: "active",
        }),
      ]),
    }));

    // Delay analytics
    await mockAnalyticsRoute(page, 1200);

    const analyticsResponse = page.waitForResponse("**/api/clients/analytics");
    await page.goto("/dashboard");

    const panel = page.locator('[data-component="dashboard-activities-panel"]');
    await expect(panel).toBeVisible();

    // Wait for client data to load (names appear)
    await expect(page.getByText("김교체")).toBeVisible();

    // Collect animation events after items render
    await page.waitForTimeout(400);
    const beforeResolve = await page.evaluate(() => window.__v3AnimEvents ?? []);

    // After analytics resolves
    await analyticsResponse;
    await page.waitForTimeout(300);
    const afterResolve = await page.evaluate(() => window.__v3AnimEvents ?? []);

    // Activities panel must not re-animate when analytics resolve
    const panelBefore = beforeResolve.filter((e) => e.comp === "dashboard-activities-panel").length;
    const panelAfter = afterResolve.filter((e) => e.comp === "dashboard-activities-panel").length;
    expect(panelAfter).toBe(panelBefore);

    // No additional pop-up animations after initial render
    const popUpsAfterResolve = afterResolve
      .slice(beforeResolve.length)
      .filter((e) => e.name === "v3-pop-up" && e.comp === "dashboard-split-list-item");
    expect(popUpsAfterResolve.length).toBe(0);
  });

  test("renders action required items in priority order", async ({ page }) => {
    await mockClientsRoute(page, () => ({
      body: createClientsResponse([
        createMockClient({ id: 1, name: "이발송", serviceStatus: "active", eDocId: null }),
        createMockClient({ id: 2, name: "김교체", serviceStatus: "replacement_requested" }),
        createMockClient({
          id: 3,
          name: "박서명",
          serviceStatus: "active",
          eDocId: "edoc-123",
          documentStatus: "opened",
        }),
      ]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");
    await expect(page.getByText("조치 필요")).toBeVisible();

    const items = page.locator('[data-component="dashboard-split-list-item"]');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("김교체");
    await expect(items.nth(1)).toContainText("박서명");
    await expect(items.nth(2)).toContainText("이발송");
  });

  test("merges duplicated client states in the all dashboard feed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);
    const startIso = isoDateInKorea(twoDaysAgo);
    const elapsedBusinessDays = diffBusinessDaysKr(startIso, isoDateInKorea());
    if (elapsedBusinessDays === null) {
      throw new Error(`Failed to calculate business-day diff for ${startIso}`);
    }

    const twentyFiveDaysLater = new Date();
    twentyFiveDaysLater.setDate(twentyFiveDaysLater.getDate() + 25);
    twentyFiveDaysLater.setHours(12, 0, 0, 0);
    await mockClientsRoute(page, () => ({
      body: createClientsResponse([
        createMockClient({
          id: 1,
          name: "가나다",
          serviceStatus: "active",
          eDocId: null,
          documentStatus: null,
          startDate: twoDaysAgo.toISOString(),
          endDate: twentyFiveDaysLater.toISOString(),
        }),
      ]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    const rows = page.locator('[data-component="mobile-redesign-list-row"]', { hasText: "가나다" });
    await expect(rows).toHaveCount(1);

    const row = rows.first();
    const badges = row.locator('[data-component="mobile-redesign-list-row-badges"] [data-component="status-badge"]');
    await expect(badges).toHaveText(["계약서 필요"]);
    await expect(row.locator('[data-component="mobile-redesign-list-row-badges-more"]')).toHaveText("+1");
    await expect(row.locator(".dday")).toHaveText(`서비스 시작 ${Math.abs(elapsedBusinessDays)} 영업일 경과`);
    await expect(row.locator(".list-right")).toContainText("계약서 필요");
    await expect(page.getByRole("button", { name: /전체\s+1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /조치 필요\s+1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /종료 예정\s+1/ })).toBeVisible();

    const headerBox = await page.locator('[data-slot="mobile-header"]').boundingBox();
    const analyticsBox = await page.locator('[data-component="mobile-dashboard-analytics-grid"]').boundingBox();
    const contentBox = await page.locator('[data-component="mobile-dashboard-content"]').boundingBox();
    expect(headerBox).not.toBeNull();
    expect(analyticsBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(analyticsBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
    expect(contentBox!.y - (analyticsBox!.y + analyticsBox!.height)).toBeLessThanOrEqual(20);

    const cardBox = await page.locator('[data-component="mobile-redesign-list-card"]').boundingBox();
    expect(cardBox).not.toBeNull();
    const pillBoxes = await page.locator('[data-component="mobile-redesign-filter-pill"]').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      })
    );
    expect(Math.min(...pillBoxes.map((box) => box.left))).toBeGreaterThanOrEqual(cardBox!.x + 8);
    expect(new Set(pillBoxes.map((box) => Math.round(box.width))).size).toBeGreaterThan(1);
  });

  test("renders dashboard card skeletons while initial data loads", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await mockClientsRoute(page, async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { body: createClientsResponse([]) };
    });
    await mockAnalyticsRoute(page, 600);

    await page.goto("/dashboard");

    await expect(page.locator('[data-component="mobile-redesign-list-card"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-redesign-filter-pill"][data-loading="true"]')).toHaveCount(4);
    await expect(page.locator('[data-component="mobile-dashboard-analytic-skeleton"]')).toHaveCount(4);
    await expect(page.locator('[data-component="mobile-dashboard-loading-skeleton"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-dashboard-row-skeleton"]')).toHaveCount(4);
  });

  test("renders dashboard analytics values after data loads", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await mockClientsRoute(page, () => ({
      body: createClientsResponse([]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    const analyticsCards = page.locator('[data-component="mobile-dashboard-analytic"]');
    await expect(analyticsCards).toHaveCount(4);
    await expect(analyticsCards.nth(0)).toContainText("1");
    await expect(analyticsCards.nth(0)).toContainText("서비스 진행 중");
    await expect(analyticsCards.nth(1)).toContainText("4");
    await expect(analyticsCards.nth(1)).toContainText("7일 내 시작 예정");
    await expect(analyticsCards.nth(2)).toContainText("3");
    await expect(analyticsCards.nth(2)).toContainText("검토 필요 문서");
    await expect(analyticsCards.nth(3)).toContainText("2");
    await expect(analyticsCards.nth(3)).toContainText("계약서 미완료");
    await expect(page.locator('[data-component="mobile-dashboard-analytic-skeleton"]')).toHaveCount(0);
  });

  test("keeps dashboard analytics height stable from skeleton to loaded cards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await mockClientsRoute(page, async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { body: createClientsResponse([]) };
    });
    await mockAnalyticsRoute(page, 700);

    await page.goto("/dashboard");

    const grid = page.locator('[data-component="mobile-dashboard-analytics-grid"]');
    await expect(page.locator('[data-component="mobile-dashboard-analytic-skeleton"]')).toHaveCount(4);
    const skeletonBox = await grid.boundingBox();
    const firstSkeletonBox = await page
      .locator('[data-component="mobile-dashboard-analytic-skeleton"]')
      .first()
      .boundingBox();

    await expect(page.locator('[data-component="mobile-dashboard-analytic"]')).toHaveCount(4);
    const loadedBox = await grid.boundingBox();
    const firstLoadedBox = await page
      .locator('[data-component="mobile-dashboard-analytic"]')
      .first()
      .boundingBox();

    expect(skeletonBox).not.toBeNull();
    expect(loadedBox).not.toBeNull();
    expect(firstSkeletonBox).not.toBeNull();
    expect(firstLoadedBox).not.toBeNull();
    expect(Math.abs(loadedBox!.height - skeletonBox!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(firstLoadedBox!.height - firstSkeletonBox!.height)).toBeLessThanOrEqual(1);
  });

  test("does not exceed viewport height on short desktop previews", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    await mockClientsRoute(page, () => ({
      body: createClientsResponse([]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");
    await expect(page.locator('[data-component="mobile-dashboard-analytics-grid"]')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const appRoot = document.querySelector('[data-slot="app-root"]');
      const appRootRect = appRoot?.getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        bodyScrollHeight: document.body.scrollHeight,
        htmlScrollHeight: document.documentElement.scrollHeight,
        appRootHeight: appRootRect?.height ?? 0,
      };
    });

    expect(metrics.appRootHeight).toBeLessThanOrEqual(metrics.innerHeight);
    expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
    expect(metrics.htmlScrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
  });

  test("renders upcoming items with relative date labels", async ({ page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);

    await mockClientsRoute(page, () => ({
      body: createClientsResponse([
        createMockClient({
          id: 1,
          name: "내일시작",
          serviceStatus: "active",
          eDocId: "edoc-complete",
          documentStatus: "completed",
          startDate: tomorrow.toISOString(),
        }),
      ]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");
    await expect(page.getByText("곧 시작")).toBeVisible();

    const item = page.locator('[data-component="dashboard-split-list-item"]').filter({
      hasText: "내일시작",
    });
    await expect(item).toBeVisible();
    await expect(item).toContainText("내일");
  });

  test("detail panel opens when clicking an activity item", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await mockClientsRoute(page, () => ({
      body: createClientsResponse([
        createMockClient({
          id: 1,
          name: "김교체",
          address: "서울시 강남구",
          phone: "010-1111-2222",
          serviceStatus: "replacement_requested",
        }),
      ]),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    const splitTrack = page.locator('[data-component="split-layout"] > div.flex.transition-transform');
    await expect(splitTrack).toBeVisible();

    await expect
      .poll(async () => splitTrack.evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("translateX(0");

    const firstItem = page.locator('[data-component="dashboard-split-list-item"]').first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();

    const detailPanel = page.locator('[data-component="detail-panel"]');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toContainText("김교체");

    await expect
      .poll(async () => splitTrack.evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("translateX(-");
  });

  test("shows error state with retry button on API failure", async ({ page }) => {
    let shouldFail = true;

    await mockClientsRoute(page, () => {
      if (shouldFail) {
        return {
          status: 500,
          body: { message: "Internal Server Error" },
        };
      }

      return {
        body: createClientsResponse([
          createMockClient({
            id: 1,
            name: "김교체",
            serviceStatus: "replacement_requested",
          }),
        ]),
      };
    });
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    await expect(page.getByText("데이터를 불러올 수 없습니다")).toBeVisible();
    const retryButton = page.getByRole("button", { name: "다시 시도" });
    await expect(retryButton).toBeVisible();

    shouldFail = false;
    await retryButton.click();
    await expect(page.getByText("김교체")).toBeVisible();
  });

  test("shows empty state when no matching clients", async ({ page }) => {
    await mockClientsRoute(page, () => ({
      body: createClientsResponse([], 0),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    await expect(page.getByText("현재 조치가 필요한 항목이 없습니다")).toBeVisible();
    await expect(page.getByText("데이터를 불러올 수 없습니다")).toHaveCount(0);
  });

  test("shows overflow link when total clients exceeds 50", async ({ page }) => {
    await mockClientsRoute(page, () => ({
      body: createClientsResponse(
        [
          createMockClient({
            id: 1,
            name: "김교체",
            serviceStatus: "replacement_requested",
          }),
        ],
        100
      ),
    }));
    await mockAnalyticsRoute(page);

    await page.goto("/dashboard");

    const overflowLink = page.getByRole("link", { name: /전체 고객 보기/ });
    await expect(overflowLink).toBeVisible();
    await expect(overflowLink).toHaveAttribute("href", "/clients");
  });
});
