import { expect, type Page, test } from "@playwright/test";

async function mockPricesApi(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "owner-1", name: "관리자", role: "owner" }),
    });
  });
  await page.route("**/api/voucher-price-infos/years", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([2026]),
    });
  });
  await page.route("**/api/voucher-price-infos/type**", async (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get("type") ?? "A통합1형";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: Math.abs(type.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)),
          type,
          duration: "5",
          fullPrice: "1000000",
          grant: "700000",
          actualPrice: "300000",
        },
      ]),
    });
  });
}

test.describe("Mobile prices skeletons", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders skeleton filters, count, and rows while prices load", async ({ page }) => {
    let releaseYears: () => void = () => {};
    let releasePrices: () => void = () => {};
    const yearsReady = new Promise<void>((resolve) => {
      releaseYears = resolve;
    });
    const pricesReady = new Promise<void>((resolve) => {
      releasePrices = resolve;
    });

    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "owner-1", name: "관리자", role: "owner" }),
      });
    });
    await page.route("**/api/voucher-price-infos/years", async (route) => {
      await yearsReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([2026]),
      });
    });
    await page.route("**/api/voucher-price-infos/type**", async (route) => {
      await pricesReady;
      const url = new URL(route.request().url());
      const type = url.searchParams.get("type") ?? "A통합1형";

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: Math.abs(type.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)),
            type,
            duration: "5",
            fullPrice: "1000000",
            grant: "700000",
            actualPrice: "300000",
          },
        ]),
      });
    });

    await page.goto("/prices");
    await expect(page.locator('[data-component="prices-page"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-prices-count-skeleton"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-prices-year-filter"] [data-loading="true"]')).toHaveCount(2);
    await expect(page.locator('[data-component="mobile-redesign-filter-row"] [data-loading="true"]')).toHaveCount(5);
    await expect(page.locator('[data-component="mobile-prices-loading-skeleton"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile-prices-row-skeleton"]')).toHaveCount(5);

    const skeletonFilterGeometry = await page.locator('[data-component="mobile-redesign-filter-row"]').boundingBox();

    releaseYears();
    releasePrices();

    await expect(page.locator('[data-component="mobile-prices-count-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-prices-year-filter"] [data-loading="true"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-redesign-filter-row"] [data-loading="true"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-prices-row-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile-prices-row"]').first()).toBeVisible();

    const loadedFilterGeometry = await page.locator('[data-component="mobile-redesign-filter-row"]').boundingBox();
    expect(skeletonFilterGeometry).not.toBeNull();
    expect(loadedFilterGeometry).not.toBeNull();
    expect(Math.abs((loadedFilterGeometry?.y ?? 0) - (skeletonFilterGeometry?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((loadedFilterGeometry?.height ?? 0) - (skeletonFilterGeometry?.height ?? 0))).toBeLessThanOrEqual(1);
  });

  test("uses the shared detail page geometry for price details", async ({ page }) => {
    await page.setViewportSize({ width: 467, height: 852 });
    await mockPricesApi(page);

    await page.goto("/prices");
    await expect(page.locator('[data-component="prices-page"]')).toBeVisible();

    const listMetrics = await page.evaluate(() => {
      const appRoot = document.querySelector('[data-component="app-root"]')?.getBoundingClientRect();
      const listCard = document
        .querySelector('[data-component="mobile-redesign-list-card"]')
        ?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        appRoot: appRoot ? { x: appRoot.x, width: appRoot.width } : null,
        listCard: listCard ? { x: listCard.x, width: listCard.width, right: listCard.right } : null,
      };
    });

    expect(listMetrics.appRoot).not.toBeNull();
    expect(listMetrics.listCard).not.toBeNull();
    expect(listMetrics.appRoot?.x).toBe(0);
    expect(listMetrics.appRoot?.width).toBe(listMetrics.viewportWidth);
    expect(listMetrics.listCard?.width).toBeGreaterThan(390);
    expect(listMetrics.listCard?.right).toBeLessThanOrEqual(listMetrics.viewportWidth);

    await page.locator('[data-component="mobile-prices-row"]').first().click();

    await expect(page.locator('[data-component="mobile_prices_detail-sheet_stack"]')).toHaveClass(/show-detail/);
    const detailPage = page.locator(
      '[data-component="mobile_prices_detail-sheet_stack_detail-page"][data-slot="mobile-detail-stack-detail-page"]',
    );
    await expect(detailPage).toBeVisible();
    await expect
      .poll(async () =>
        detailPage.evaluate((element) => {
          const transform = window.getComputedStyle(element).transform;

          if (transform === "none") {
            return 0;
          }

          return Math.round(new DOMMatrixReadOnly(transform).m42);
        }),
      )
      .toBe(0);

    const detailMetrics = await detailPage.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const scrim = document.querySelector(
        '[data-component="mobile_prices_detail-sheet_stack_scrim"]',
      );
      const scrimStyle = scrim ? window.getComputedStyle(scrim) : null;
      const scrimRect = scrim?.getBoundingClientRect();

      return {
        position: style.position,
        top: Number.parseFloat(style.top),
        right: style.right,
        bottom: style.bottom,
        left: style.left,
        width: style.width,
        rectTop: rect.top,
        expectedTop: window.innerHeight * 0.05,
        viewportWidth: window.innerWidth,
        scrim:
          scrimStyle && scrimRect
            ? {
                position: scrimStyle.position,
                x: scrimRect.x,
                y: scrimRect.y,
                width: scrimRect.width,
                height: scrimRect.height,
                viewportHeight: window.innerHeight,
              }
            : null,
      };
    });

    expect(detailMetrics.position).toBe("fixed");
    expect(Math.abs(detailMetrics.top - detailMetrics.expectedTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(detailMetrics.rectTop - detailMetrics.expectedTop)).toBeLessThanOrEqual(1);
    expect(detailMetrics.left).toBe("0px");
    expect(detailMetrics.right).toBe("0px");
    expect(detailMetrics.bottom).toBe("0px");
    expect(Number.parseFloat(detailMetrics.width)).toBe(detailMetrics.viewportWidth);
    expect(detailMetrics.scrim).not.toBeNull();
    expect(detailMetrics.scrim?.position).toBe("fixed");
    expect(detailMetrics.scrim?.x).toBe(0);
    expect(detailMetrics.scrim?.y).toBe(0);
    expect(detailMetrics.scrim?.width).toBe(detailMetrics.viewportWidth);
    expect(detailMetrics.scrim?.height).toBe(detailMetrics.scrim?.viewportHeight);

    await expect(page.locator('[data-component="mobile-prices-detail"]')).toHaveClass(/detail-body/);
    await expect(page.locator('[data-component="mobile-prices-detail"]')).toHaveClass(/detail-column/);
  });
});
