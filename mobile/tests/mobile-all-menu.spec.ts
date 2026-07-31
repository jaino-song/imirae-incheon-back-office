import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

type AuthCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

async function restoreAuthCookies(page: Page) {
  const storageState = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "auth.json"), "utf-8")) as {
    cookies: AuthCookie[];
  };

  await page.context().addCookies(storageState.cookies);
}

test.describe("Mobile nav: center chat + /all menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/notifications/vapid-key**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ publicKey: "test-vapid-key" }),
      });
    });
  });

  test("all menu uses fixed-size skeletons for fetched values while loading", async ({ page }) => {
    let releaseClients: () => void = () => {};
    let releaseEmployees: () => void = () => {};
    let releaseUnreadCount: () => void = () => {};
    let releaseMessageTemplates: () => void = () => {};
    let releaseAlimtalkRules: () => void = () => {};
    const clientsReady = new Promise<void>((resolve) => {
      releaseClients = resolve;
    });
    const employeesReady = new Promise<void>((resolve) => {
      releaseEmployees = resolve;
    });
    const unreadCountReady = new Promise<void>((resolve) => {
      releaseUnreadCount = resolve;
    });
    const messageTemplatesReady = new Promise<void>((resolve) => {
      releaseMessageTemplates = resolve;
    });
    const alimtalkRulesReady = new Promise<void>((resolve) => {
      releaseAlimtalkRules = resolve;
    });

    await page.route("**/api/clients**", async (route) => {
      await clientsReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }, { id: 2 }]),
      });
    });
    await page.route("**/api/employees**", async (route) => {
      await employeesReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }]),
      });
    });
    await page.route("**/api/notifications/unread/count**", async (route) => {
      await unreadCountReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 3 }),
      });
    });
    await page.route("**/api/message-templates**", async (route) => {
      await messageTemplatesReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }]),
      });
    });
    await page.route("**/api/message-trigger-rules**", async (route) => {
      await alimtalkRulesReady;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }]),
      });
    });

    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')).toHaveCount(3);
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_badge-skeleton"]')).toHaveCount(1);
    await expect(
      page
        .locator('[data-component="mobile_all_page_menu_group_row"]', { hasText: "메시지" })
        .locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')
    ).toBeVisible();

    const before = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-component="mobile_all_page_menu_group_row"]'));
      const groupTitle = document.querySelector(".menu-group-title")?.getBoundingClientRect();
      const clientRow = rows[1]?.getBoundingClientRect();
      const employeeRow = rows[2]?.getBoundingClientRect();
      const messageRow = rows[6]?.getBoundingClientRect();
      const alimtalkRow = rows[7]?.getBoundingClientRect();

      return {
        groupTitle: groupTitle ? { y: groupTitle.y, height: groupTitle.height } : null,
        clientRow: clientRow ? { y: clientRow.y, height: clientRow.height } : null,
        employeeRow: employeeRow ? { y: employeeRow.y, height: employeeRow.height } : null,
        messageRow: messageRow ? { y: messageRow.y, height: messageRow.height } : null,
        alimtalkRow: alimtalkRow ? { y: alimtalkRow.y, height: alimtalkRow.height } : null,
      };
    });

    releaseClients();
    releaseEmployees();
    releaseUnreadCount();
    releaseMessageTemplates();
    releaseAlimtalkRules();

    await expect(page.locator(".menu-value", { hasText: "2명" })).toBeVisible();
    await expect(page.locator(".menu-value", { hasText: "1명" })).toBeVisible();
    await expect(page.locator(".menu-value", { hasText: "5건" })).toBeVisible();
    await expect(page.locator(".menu-value", { hasText: "4개" })).toBeVisible();
    await expect(page.locator(".menu-badge", { hasText: "3" })).toBeVisible();
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_badge-skeleton"]')).toHaveCount(0);

    const after = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-component="mobile_all_page_menu_group_row"]'));
      const groupTitle = document.querySelector(".menu-group-title")?.getBoundingClientRect();
      const clientRow = rows[1]?.getBoundingClientRect();
      const employeeRow = rows[2]?.getBoundingClientRect();
      const messageRow = rows[6]?.getBoundingClientRect();
      const alimtalkRow = rows[7]?.getBoundingClientRect();

      return {
        groupTitle: groupTitle ? { y: groupTitle.y, height: groupTitle.height } : null,
        clientRow: clientRow ? { y: clientRow.y, height: clientRow.height } : null,
        employeeRow: employeeRow ? { y: employeeRow.y, height: employeeRow.height } : null,
        messageRow: messageRow ? { y: messageRow.y, height: messageRow.height } : null,
        alimtalkRow: alimtalkRow ? { y: alimtalkRow.y, height: alimtalkRow.height } : null,
      };
    });

    expect(before.groupTitle).not.toBeNull();
    expect(before.clientRow).not.toBeNull();
    expect(before.employeeRow).not.toBeNull();
    expect(before.messageRow).not.toBeNull();
    expect(before.alimtalkRow).not.toBeNull();
    expect(after.groupTitle).not.toBeNull();
    expect(after.clientRow).not.toBeNull();
    expect(after.employeeRow).not.toBeNull();
    expect(after.messageRow).not.toBeNull();
    expect(after.alimtalkRow).not.toBeNull();
    if (
      !before.groupTitle ||
      !before.clientRow ||
      !before.employeeRow ||
      !before.messageRow ||
      !before.alimtalkRow ||
      !after.groupTitle ||
      !after.clientRow ||
      !after.employeeRow ||
      !after.messageRow ||
      !after.alimtalkRow
    ) {
      throw new Error("All menu loading geometry should be measurable");
    }

    expect(Math.abs(after.groupTitle.y - before.groupTitle.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.groupTitle.height - before.groupTitle.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.clientRow.y - before.clientRow.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.clientRow.height - before.clientRow.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.employeeRow.y - before.employeeRow.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.employeeRow.height - before.employeeRow.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.messageRow.y - before.messageRow.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.messageRow.height - before.messageRow.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.alimtalkRow.y - before.alimtalkRow.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.alimtalkRow.height - before.alimtalkRow.height)).toBeLessThanOrEqual(1);
  });

  test("all menu has center chat and active /all bottom nav item", async ({ page }) => {
    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();

    const nav = page.locator('[data-slot="mobile-bottom-nav"]');
    await expect(nav).toBeVisible();

    // Center messages button.
    await expect(page.locator('[data-slot="mobile-bottom-nav-messages"]')).toBeVisible();

    // "전체" button should exist.
    const allNav = page.locator('[data-slot="mobile-bottom-nav-all"]');
    await expect(allNav).toBeVisible();
    await expect(allNav).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-component="mobile_all_page_menu"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_all_page_menu_profile-card"]')).toBeVisible();
  });

  test("all page cards respond to the mobile viewport width", async ({ page }) => {
    await page.setViewportSize({ width: 467, height: 852 });

    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const appRoot = document.querySelector('[data-slot="app-root"]')?.getBoundingClientRect();
      const appProviders = document.querySelector('[data-slot="app-content"]')?.getBoundingClientRect();
      const allMenu = document.querySelector('[data-component="mobile_all_page_menu"]')?.getBoundingClientRect();
      const profileCard = document.querySelector('[data-component="mobile_all_page_menu_profile-card"]')?.getBoundingClientRect();
      const menuGroup = document.querySelector('[data-component="mobile_all_page_menu_group"]')?.getBoundingClientRect();
      const bottomNav = document.querySelector('[data-slot="mobile-bottom-nav"]')?.getBoundingClientRect();
      const rootElement = document.querySelector('[data-slot="app-root"]') as HTMLElement | null;
      const providersElement = document.querySelector('[data-slot="app-content"]') as HTMLElement | null;
      const rootStyles = rootElement ? getComputedStyle(rootElement) : null;
      const providerStyles = providersElement ? getComputedStyle(providersElement) : null;

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        appRoot: appRoot
          ? {
              x: appRoot.x,
              width: appRoot.width,
              height: appRoot.height,
              padding: rootStyles?.padding ?? "",
              borderRadius: rootStyles?.borderRadius ?? "",
            }
          : null,
        appProviders: appProviders
          ? {
              width: appProviders.width,
              height: appProviders.height,
              background: providerStyles?.backgroundColor ?? "",
              borderRadius: providerStyles?.borderRadius ?? "",
            }
          : null,
        allMenu: allMenu ? { y: allMenu.y, height: allMenu.height, bottom: allMenu.bottom } : null,
        profileCard: profileCard
          ? { x: profileCard.x, width: profileCard.width, right: profileCard.right }
          : null,
        menuGroup: menuGroup ? { x: menuGroup.x, width: menuGroup.width, right: menuGroup.right } : null,
        bottomNav: bottomNav ? { y: bottomNav.y, height: bottomNav.height, bottom: bottomNav.bottom } : null,
        documentHeight: document.documentElement.scrollHeight,
      };
    });

    expect(geometry.appRoot).not.toBeNull();
    expect(geometry.appProviders).not.toBeNull();
    expect(geometry.allMenu).not.toBeNull();
    expect(geometry.profileCard).not.toBeNull();
    expect(geometry.menuGroup).not.toBeNull();
    expect(geometry.bottomNav).not.toBeNull();
    if (
      !geometry.appRoot ||
      !geometry.appProviders ||
      !geometry.allMenu ||
      !geometry.profileCard ||
      !geometry.menuGroup ||
      !geometry.bottomNav
    ) {
      throw new Error("All page shell geometry should be measurable");
    }

    expect(Math.abs(geometry.appRoot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.width - geometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.height - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(geometry.appRoot.padding).toBe("0px");
    expect(geometry.appRoot.borderRadius).toBe("0px");
    expect(Math.abs(geometry.appProviders.width - geometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appProviders.height - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(geometry.appProviders.background).toBe("rgba(0, 0, 0, 0)");
    expect(geometry.appProviders.borderRadius).toBe("0px");
    expect(geometry.profileCard.width).toBeGreaterThan(390);
    expect(geometry.profileCard.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.menuGroup.width).toBeGreaterThan(390);
    expect(geometry.menuGroup.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.allMenu.bottom).toBeLessThanOrEqual(geometry.appRoot.height);
    expect(geometry.bottomNav.bottom).toBeLessThanOrEqual(geometry.appRoot.height);
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  });

  test("all page does not show the old phone frame on wide refresh", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    await page.route("**/api/clients**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }, { id: 2 }]),
      });
    });
    await page.route("**/api/employees**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }]),
      });
    });
    await page.route("**/api/notifications/unread/count**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      });
    });
    await page.route("**/api/notifications/vapid-key**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ publicKey: "test" }),
      });
    });
    await page.route("**/api/message-templates**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }]),
      });
    });
    await page.route("**/api/message-trigger-rules**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }]),
      });
    });

    await restoreAuthCookies(page);
    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();
    await restoreAuthCookies(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const appRoot = document.querySelector('[data-slot="app-root"]')?.getBoundingClientRect();
      const header = document.querySelector('[data-slot="mobile-header"]')?.getBoundingClientRect();
      const rootElement = document.querySelector('[data-slot="app-root"]') as HTMLElement | null;
      const rootStyles = rootElement ? getComputedStyle(rootElement) : null;
      const rootBeforeStyles = rootElement ? getComputedStyle(rootElement, "::before") : null;

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        appRoot: appRoot
          ? {
              x: appRoot.x,
              width: appRoot.width,
              height: appRoot.height,
              padding: rootStyles?.padding ?? "",
              borderRadius: rootStyles?.borderRadius ?? "",
              background: rootStyles?.backgroundColor ?? "",
              boxShadow: rootStyles?.boxShadow ?? "",
              beforeDisplay: rootBeforeStyles?.display ?? "",
              beforeContent: rootBeforeStyles?.content ?? "",
            }
          : null,
        header: header ? { y: header.y, height: header.height, bottom: header.bottom } : null,
        documentHeight: document.documentElement.scrollHeight,
      };
    });

    expect(geometry.appRoot).not.toBeNull();
    expect(geometry.header).not.toBeNull();
    if (!geometry.appRoot || !geometry.header) {
      throw new Error("All page wide shell geometry should be measurable");
    }

    expect(Math.abs(geometry.appRoot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.width - geometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.height - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(geometry.appRoot.height).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.appRoot.padding).toBe("0px");
    expect(geometry.appRoot.borderRadius).toBe("0px");
    expect(geometry.appRoot.background).not.toBe("rgb(0, 0, 0)");
    expect(geometry.appRoot.boxShadow).toBe("none");
    expect(geometry.appRoot.beforeDisplay).toBe("none");
    expect(geometry.appRoot.beforeContent).toBe("none");
    expect(geometry.header.y).toBeGreaterThanOrEqual(0);
    expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.appRoot.height);
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  });

  test("profile card refresh animation does not translate the menu surface", async ({ page }) => {
    await page.route("**/api/clients**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }, { id: 2 }]),
      });
    });
    await page.route("**/api/employees**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1 }]),
      });
    });
    await page.route("**/api/notifications/unread/count**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      });
    });
    await page.route("**/api/notifications/vapid-key**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ publicKey: "test" }),
      });
    });
    await page.route("**/api/message-templates**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }]),
      });
    });
    await page.route("**/api/message-trigger-rules**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }]),
      });
    });

    await restoreAuthCookies(page);
    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();

    await restoreAuthCookies(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-component="mobile_all_page_menu_profile-card"]')).toBeVisible();

    const samples = [];
    let previousDelay = 0;
    for (const delay of [0, 50, 120, 220, 360]) {
      await page.waitForTimeout(delay - previousDelay);
      previousDelay = delay;
      samples.push(
        await page.evaluate(() => {
          const profile = document.querySelector('[data-component="mobile_all_page_menu_profile-card"]');
          const groupTitle = document.querySelector(".menu-group-title");
          const firstRow = document.querySelector('[data-component="mobile_all_page_menu_group_row"]');
          const profileRect = profile?.getBoundingClientRect();
          const groupTitleRect = groupTitle?.getBoundingClientRect();
          const rowRect = firstRow?.getBoundingClientRect();
          const profileStyle = profile ? getComputedStyle(profile) : null;

          return {
            profile: profileRect
              ? {
                  y: profileRect.y,
                  bottom: profileRect.bottom,
                  transform: profileStyle?.transform ?? "",
                  animationName: profileStyle?.animationName ?? "",
                }
              : null,
            groupTitle: groupTitleRect
              ? { y: groupTitleRect.y, height: groupTitleRect.height, bottom: groupTitleRect.bottom }
              : null,
            firstRow: rowRect ? { y: rowRect.y, height: rowRect.height, bottom: rowRect.bottom } : null,
          };
        })
      );
    }

    const first = samples[0];
    expect(first.profile).not.toBeNull();
    expect(first.groupTitle).not.toBeNull();
    expect(first.firstRow).not.toBeNull();
    if (!first.profile || !first.groupTitle || !first.firstRow) {
      throw new Error("All page menu motion should be measurable");
    }

    for (const sample of samples) {
      expect(sample.profile).not.toBeNull();
      expect(sample.groupTitle).not.toBeNull();
      expect(sample.firstRow).not.toBeNull();
      if (!sample.profile || !sample.groupTitle || !sample.firstRow) {
        throw new Error("All page menu motion sample should be measurable");
      }

      expect(sample.profile.animationName).toBe("mobile-profile-card-fade-in");
      expect(sample.profile.transform).toBe("none");
      expect(sample.groupTitle.y).toBeGreaterThan(sample.profile.bottom);
      expect(sample.firstRow.y).toBeGreaterThanOrEqual(sample.groupTitle.bottom);
      expect(Math.abs(sample.groupTitle.y - first.groupTitle.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.groupTitle.height - first.groupTitle.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.firstRow.y - first.firstRow.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.firstRow.height - first.firstRow.height)).toBeLessThanOrEqual(1);
    }
  });
});
