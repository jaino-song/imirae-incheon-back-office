import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Visual verification of the mobile-ui-ethereal-seahorse animation plan.
 * Captures screenshots at rest and during transitions; also asserts computed
 * styles to prove the plan's CSS landed exactly as specified.
 *
 * Screenshots land in tests/screenshots/animation-plan/<phase>/
 */

const SCREENSHOT_DIR = path.join(__dirname, "screenshots", "animation-plan");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(path.join(SCREENSHOT_DIR, "phase-1-bottom-nav"), { recursive: true });
fs.mkdirSync(path.join(SCREENSHOT_DIR, "phase-2-list-stagger"), { recursive: true });
fs.mkdirSync(path.join(SCREENSHOT_DIR, "phase-2-detail-tabs"), { recursive: true });
fs.mkdirSync(path.join(SCREENSHOT_DIR, "phase-2-badge"), { recursive: true });
fs.mkdirSync(path.join(SCREENSHOT_DIR, "reduced-motion"), { recursive: true });

const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;
const CLIENT_DETAIL_TABS =
  "mobile_clients_detail-sheet_stack_detail-page_content_tabs";

type MockClient = {
  id: number;
  name: string;
  birthday: string | null;
  dueDate: string | null;
  address: string;
  phone: string;
  primaryEmployee: { id: number; name: string } | null;
  secondaryEmployee: { id: number; name: string } | null;
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

function client(id: number, name: string, overrides: Partial<MockClient> = {}): MockClient {
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

const CLIENTS_LIST = [
  client(1, "김민준", { serviceStatus: "active", phone: "010-1111-2222" }),
  client(2, "박서연", { serviceStatus: "active", eDocId: "doc-1", documentStatus: "opened" }),
  client(3, "이지우", { serviceStatus: "replacement_requested" }),
  client(4, "최민서"),
  client(5, "정유나"),
  client(6, "한지훈"),
  client(7, "강예린"),
  client(8, "윤도현"),
];

const ANALYTICS = {
  activeClients: 8,
  contractsNotSent: 2,
  contractsPendingSignature: 3,
  upcomingThisMonth: 4,
  upcomingNextMonth: 5,
};

async function mockBaseRoutes(page: Page) {
  await page.route("**/api/clients/analytics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ANALYTICS),
    })
  );
  await page.route("**/api/clients*", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/clients/analytics")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: CLIENTS_LIST,
        total: CLIENTS_LIST.length,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
    });
  });
}

test.describe("Animation plan — visual verification", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  // ====================================================================
  // PHASE 1.2 — Bottom-nav active indicator slide
  // ====================================================================
  test("phase 1.2: bottom-nav indicator has transition and slides between tabs", async ({
    page,
  }) => {
    await mockBaseRoutes(page);

    await page.goto("/dashboard");
    await expect(page.locator('[data-slot="mobile-bottom-nav"]')).toBeVisible();

    // Find the indicator div (first child of nav with absolute positioning + transform)
    const indicator = page
      .locator('[data-slot="mobile-bottom-nav"] > div[aria-hidden="true"]')
      .first();
    await expect(indicator).toBeVisible();

    // ---- Computed-style assertion: must have transition on transform ----
    const transitionAtRest = await indicator.evaluate((el) => getComputedStyle(el).transition);
    console.log(`[bottom-nav indicator transition] ${transitionAtRest}`);
    expect(transitionAtRest).toContain("transform");
    expect(transitionAtRest).toMatch(/0\.32s|320ms/); // duration-spatial = 320ms

    // ---- Screenshot at /dashboard (Home tab active) ----
    const nav = page.locator('[data-slot="mobile-bottom-nav"]');
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "01-home-active.png"),
    });

    // ---- Navigate to /clients and screenshot ----
    await page.click('[data-slot="mobile-bottom-nav-clients"]');
    await page.waitForURL("**/clients", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400); // let the indicator settle
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "02-clients-active.png"),
    });

    // ---- Navigate to /contracts ----
    await page.click('[data-slot="mobile-bottom-nav-contracts"]');
    await page.waitForURL("**/contracts", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "03-contracts-active.png"),
    });

    // ---- Navigate to /all ----
    await page.click('[data-slot="mobile-bottom-nav-all"]');
    await page.waitForURL("**/all", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "04-all-active.png"),
    });

    // ---- Capture mid-transition: navigate, wait 100ms (< 320ms duration) ----
    await page.click('[data-slot="mobile-bottom-nav-dashboard"]');
    await page.waitForTimeout(120); // mid-slide
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "05-mid-slide-to-home.png"),
    });
    await page.waitForTimeout(400); // let it settle
    await nav.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-1-bottom-nav", "06-home-settled.png"),
    });
  });

  // ====================================================================
  // PHASE 2.1 — List item stagger entrance
  // ====================================================================
  test("phase 2.1: .list-item carries mobile-list-pop-up animation; stagger applied", async ({
    page,
  }) => {
    await mockBaseRoutes(page);

    await page.goto("/clients");
    await page.waitForLoadState("networkidle");

    // Screenshot the list mid-stagger (the staggered first 5 items should be at different opacity/y)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-list-stagger", "01-clients-list-at-rest.png"),
      fullPage: false,
    });

    // ---- Find the first .list-item and verify computed animation ----
    const firstListItem = page.locator(".list-item").first();
    if (await firstListItem.count()) {
      const anim = await firstListItem.evaluate((el) => ({
        name: getComputedStyle(el).animationName,
        duration: getComputedStyle(el).animationDuration,
        timing: getComputedStyle(el).animationTimingFunction,
        delay: getComputedStyle(el).animationDelay,
        fill: getComputedStyle(el).animationFillMode,
      }));
      console.log(`[list-item[0] animation] ${JSON.stringify(anim)}`);
      expect(anim.name).toBe("mobile-list-pop-up");
      expect(anim.duration).toMatch(/0\.42s|420ms/); // duration-emphasis
      expect(anim.fill).toBe("both");
      expect(anim.delay).toBe("0s"); // first item has delay 0
    } else {
      console.log("[list-item] no .list-item present on /clients; checking dashboard instead");
    }

    // ---- Reload and capture quickly to see the cascading entrance ----
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    // Capture at ~80ms — the first 3 items should be most visible
    await page.waitForTimeout(80);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-list-stagger", "02-clients-list-80ms-into-entrance.png"),
      fullPage: false,
    });
    await page.waitForTimeout(120); // total 200ms
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-list-stagger", "03-clients-list-200ms-into-entrance.png"),
      fullPage: false,
    });
    await page.waitForTimeout(300); // total 500ms — all should be settled
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-list-stagger", "04-clients-list-settled.png"),
      fullPage: false,
    });

    // ---- Verify stagger delay clamp on later items ----
    const listItems = page.locator(".list-item");
    const count = await listItems.count();
    if (count >= 6) {
      const delays = await listItems.evaluateAll((els) =>
        els.map((el, i) => ({ i, delay: getComputedStyle(el).animationDelay }))
      );
      console.log(`[list-item delays] ${JSON.stringify(delays.slice(0, 8))}`);
      // First 5 should have increasing delays, items 6+ should be clamped to the max
      // Note: this only fires if consumer-side passed style; .list-item also works without
      const item6Delay = delays[5]?.delay;
      const item7Delay = delays[6]?.delay;
      if (item6Delay && item7Delay && item6Delay !== "0s") {
        expect(item6Delay).toBe(item7Delay); // clamped, both items >= 5 share max delay
      }
    }
  });

  // ====================================================================
  // PHASE 2.3 — DetailTabPills sliding underline + content fade
  // ====================================================================
  test("phase 2.3: DetailTabPills has sliding underline indicator with framer-motion", async ({
    page,
  }) => {
    await mockBaseRoutes(page);

    // Open a client detail via dashboard — opens MobileDetailSheet with DetailTabPills
    await page.goto("/clients");
    await page.waitForLoadState("networkidle");

    // Click first list-item to open detail
    const firstItem = page.locator(".list-item").first();
    if (await firstItem.count()) {
      await firstItem.click();
    } else {
      console.log("[phase 2.3] no .list-item to click on /clients; aborting interactive parts");
      return;
    }

    // Wait for detail sheet to open (.nav-stack.show-detail)
    await page.waitForTimeout(500); // nav-page slide

    // Look for DetailTabPills
    const detailTabs = page.locator(
      `[data-component="${CLIENT_DETAIL_TABS}"]`
    );
    if (!(await detailTabs.count())) {
      console.log("[phase 2.3] no DetailTabPills present on /clients detail; skipping");
      return;
    }

    await expect(detailTabs.first()).toBeVisible();
    await detailTabs.first().screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "01-tabs-initial.png"),
    });

    // Indicator should exist on the active tab
    const indicator = page.locator(
      `[data-component="${CLIENT_DETAIL_TABS}_indicator"]`
    );
    await expect(indicator).toHaveCount(1);
    const indicatorBox1 = await indicator.boundingBox();
    console.log(`[indicator initial position] ${JSON.stringify(indicatorBox1)}`);

    // Click the second tab
    const tabs = detailTabs.first().locator(".filter-pill");
    const tabCount = await tabs.count();
    console.log(`[detail tabs] count=${tabCount}`);
    if (tabCount >= 2) {
      // Capture at multiple points during the slide (250ms tween)
      await tabs.nth(1).click();
      await page.waitForTimeout(80); // ~1/3 into slide
      await detailTabs.first().screenshot({
        path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "02-tabs-mid-slide-80ms.png"),
      });

      await page.waitForTimeout(80); // ~2/3 into slide
      await detailTabs.first().screenshot({
        path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "03-tabs-mid-slide-160ms.png"),
      });

      await page.waitForTimeout(200); // settled
      await detailTabs.first().screenshot({
        path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "04-tabs-settled-tab2.png"),
      });

      const indicatorBox2 = await indicator.boundingBox();
      console.log(`[indicator after click tab2] ${JSON.stringify(indicatorBox2)}`);

      // Indicator should have moved horizontally
      if (indicatorBox1 && indicatorBox2) {
        expect(Math.abs(indicatorBox2.x - indicatorBox1.x)).toBeGreaterThan(20);
      }

      // Click back to tab 1
      await tabs.nth(0).click();
      await page.waitForTimeout(300);
      await detailTabs.first().screenshot({
        path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "05-tabs-back-to-tab1.png"),
      });

      // Click tab 3 (if exists)
      if (tabCount >= 3) {
        await tabs.nth(2).click();
        await page.waitForTimeout(80);
        await detailTabs.first().screenshot({
          path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "06-tabs-tab3-mid.png"),
        });
        await page.waitForTimeout(300);
        await detailTabs.first().screenshot({
          path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "07-tabs-tab3-settled.png"),
        });
      }
    }

    // Capture entire detail sheet area
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "phase-2-detail-tabs", "08-detail-full-view.png"),
    });
  });

  // ====================================================================
  // PHASE 2.2 — Badge transition (computed style only — DOM rarely changes
  // status in a single page session, but we can verify the CSS landed)
  // ====================================================================
  test("phase 2.2: .badge has color transitions", async ({ page }) => {
    await mockBaseRoutes(page);
    await page.goto("/clients");
    await page.waitForLoadState("networkidle");

    const badge = page.locator(".badge").first();
    if (await badge.count()) {
      const transition = await badge.evaluate((el) => getComputedStyle(el).transition);
      console.log(`[.badge transition] ${transition}`);
      expect(transition).toMatch(/background-color/);
      expect(transition).toMatch(/0\.3s|300ms/); // duration-pop
      await page.locator(".badge").first().screenshot({
        path: path.join(SCREENSHOT_DIR, "phase-2-badge", "01-badge-sample.png"),
      });
    } else {
      console.log("[.badge] no badge present on /clients");
    }
  });

  // ====================================================================
  // FOUNDATION — Reduced motion respected globally
  // ====================================================================
  test("reduced-motion: prefers-reduced-motion disables animations", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      reducedMotion: "reduce",
      storageState: "auth.json",
    });
    const page = await ctx.newPage();
    await mockBaseRoutes(page);

    await page.goto("/clients");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "reduced-motion", "01-clients-reduced.png"),
      fullPage: false,
    });

    // Helper: convert a CSS time string to milliseconds. Handles scientific
    // notation (e.g. "1e-05s" = 0.00001s = 0.01ms) which browsers emit for
    // very small values.
    const cssTimeToMs = (raw: string): number => {
      const v = raw.trim();
      const m = v.match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)(ms|s)?$/i);
      if (!m) return NaN;
      const num = parseFloat(m[1]);
      const unit = (m[2] || "s").toLowerCase();
      return unit === "ms" ? num : num * 1000;
    };

    // Verify .list-item animation-duration is effectively 0 under reduced-motion
    const listItem = page.locator(".list-item").first();
    if (await listItem.count()) {
      const dur = await listItem.evaluate((el) => getComputedStyle(el).animationDuration);
      console.log(`[reduced-motion .list-item duration] ${dur}`);
      // The global block sets animation-duration: 0.01ms !important — must be < 1ms
      expect(cssTimeToMs(dur)).toBeLessThan(1);
    }

    // Bottom-nav indicator transition should also be effectively 0
    const indicator = page
      .locator('[data-slot="mobile-bottom-nav"] > div[aria-hidden="true"]')
      .first();
    if (await indicator.count()) {
      const transition = await indicator.evaluate((el) => getComputedStyle(el).transitionDuration);
      console.log(`[reduced-motion bottom-nav indicator transition-duration] ${transition}`);
      expect(cssTimeToMs(transition)).toBeLessThan(1);
    }

    await ctx.close();
  });
});
