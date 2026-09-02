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
    await page.goto("/all");
    await expect(page.locator('[data-component="mobile_all_page"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')).toHaveCount(3);
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_badge-skeleton"]')).toHaveCount(1);
    await expect(
      page
        .locator('[data-component="mobile_all_page_menu_group_row"]', { hasText: "메시지" })
        .locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')
    ).toBeVisible();

    // What this test is about: the skeleton standing in for a fetched value occupies
    // the same box the value will, so the swap moves nothing. That is a claim about a
    // row and its neighbours inside one menu group, and it is measured that way —
    // each row's offset within its own `.menu-group`, plus every group's height.
    //
    // Absolute page y was the previous measure and it is the wrong one: it sums every
    // sub-pixel difference in everything rendered above the row, so a row seven
    // positions down drifted 2-3px in CI while every row above it held — twice on a
    // branch whose only change was to this file. The per-group measure is strictly
    // stronger inside a group (a group's height moves if ANY of its rows changes box)
    // and stops reporting drift that originates outside it.
    //
    // Rows are matched on their `.menu-label` text, exactly. By index the assertions
    // were checking the wrong rows — rows[6]/rows[7] are 가격표 and 메시지, not the
    // 메시지/발송 자동화 their names claimed — and by `textContent` a row would also
    // match on a value or badge that happened to contain the string.
    const MEASURED_LABELS = [
      "상담",
      "고객",
      "제공인력",
      "전자문서",
      "일정 캘린더",
      "통계 보고서",
      "가격표",
      "메시지",
      "발송 자동화",
      "알림 설정",
    ];

    const measureMenu = () =>
      page.evaluate((labels: string[]) => {
        const round = (value: number) => Math.round(value * 100) / 100;
        const rows = Array.from(
          document.querySelectorAll('[data-component="mobile_all_page_menu_group_row"]'),
        );

        const measured: Record<
          string,
          { offsetInGroup: number; height: number; pageY: number } | null
        > = {};
        for (const label of labels) {
          const row = rows.find(
            (candidate) => candidate.querySelector(".menu-label")?.textContent?.trim() === label,
          );
          const group = row?.closest(".menu-group");
          if (!row || !group) {
            measured[label] = null;
            continue;
          }
          const rowRect = row.getBoundingClientRect();
          const groupRect = group.getBoundingClientRect();
          measured[label] = {
            offsetInGroup: round(rowRect.y - groupRect.y),
            height: round(rowRect.height),
            // Kept for the diagnostic log below, never asserted on.
            pageY: round(rowRect.y + window.scrollY),
          };
        }

        return {
          rows: measured,
          groups: Array.from(document.querySelectorAll(".menu-group")).map((group) => ({
            height: round(group.getBoundingClientRect().height),
            titleHeight: round(
              group.querySelector(".menu-group-title")?.getBoundingClientRect().height ?? -1,
            ),
          })),
        };
      }, MEASURED_LABELS);

    // The loading-state layout is not final the instant the skeletons appear, and the
    // baseline must not sample it mid-settle.
    //
    // What CI actually showed, from the geometry log below. On the reads that failed,
    // every row that `.menu-row:first-of-type` exempts from a top border measured
    // 60px and every other row 61px — 10 of 10, exactly the stylesheet's own intent —
    // and a moment later every row measured 61px. That 1px lands on rows with no
    // fetched value at all (가격표, 전자문서, 통계 보고서, 발송 자동화), so it is a
    // page-wide settle and not the skeleton swap this test is about. It only has to
    // stop being sampled as the baseline.
    //
    // Three consecutive identical reads, at least half a second apart end to end. Two
    // is not enough: back-to-back reads both land inside the same transient state.
    const measureSettledMenu = async () => {
      type MenuGeometry = Awaited<ReturnType<typeof measureMenu>>;
      let previous: MenuGeometry | undefined;
      let stableReads = 0;

      await expect(async () => {
        const current = await measureMenu();
        stableReads =
          previous && JSON.stringify(current) === JSON.stringify(previous) ? stableReads + 1 : 0;
        previous = current;
        expect(
          stableReads,
          "all-menu layout should settle before it is measured",
        ).toBeGreaterThanOrEqual(2);
      }).toPass({ intervals: [250, 250, 250, 500, 1000], timeout: 15_000 });

      if (!previous) {
        throw new Error("All menu loading geometry should be measurable");
      }
      return previous;
    };

    const before = await measureSettledMenu();

    releaseClients();
    releaseEmployees();
    releaseUnreadCount();
    releaseMessageTemplates();

    await expect(page.locator(".menu-value", { hasText: "2명" })).toBeVisible();
    await expect(page.locator(".menu-value", { hasText: "1명" })).toBeVisible();
    await expect(page.locator(".menu-value", { hasText: "5건" })).toBeVisible();
    await expect(
      page
        .locator('[data-component="mobile_all_page_menu_group_row"]', { hasText: "발송 자동화" })
        .locator(".menu-status-pill", { hasText: "출시 예정" })
    ).toBeVisible();
    await expect(page.locator(".menu-badge", { hasText: "3" })).toBeVisible();
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_value-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_all_page_menu_group_row_badge-skeleton"]')).toHaveCount(0);

    const after = await measureSettledMenu();

    // Printed on every run, pass or fail. The flake this replaced reported a single
    // number ("3 > 1") with no way to tell which box had grown, so every hypothesis
    // cost a CI round trip. The absolute pageY values are here for exactly that.
    console.log(`[all-menu geometry] before ${JSON.stringify(before)}`);
    console.log(`[all-menu geometry] after  ${JSON.stringify(after)}`);

    expect(after.groups).toHaveLength(before.groups.length);
    before.groups.forEach((group, index) => {
      expect(
        Math.abs(after.groups[index].height - group.height),
        `menu group ${index} changed height across the loading transition`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(after.groups[index].titleHeight - group.titleHeight),
        `menu group ${index} title changed height across the loading transition`,
      ).toBeLessThanOrEqual(1);
    });

    for (const label of MEASURED_LABELS) {
      const beforeRow = before.rows[label];
      const afterRow = after.rows[label];
      expect(beforeRow, `${label} row should be measurable while loading`).not.toBeNull();
      expect(afterRow, `${label} row should be measurable once loaded`).not.toBeNull();
      if (!beforeRow || !afterRow) {
        throw new Error(`All menu loading geometry should be measurable for ${label}`);
      }

      expect(
        Math.abs(afterRow.offsetInGroup - beforeRow.offsetInGroup),
        `${label} row moved inside its group across the loading transition`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(afterRow.height - beforeRow.height),
        `${label} row changed height across the loading transition`,
      ).toBeLessThanOrEqual(1);
    }
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
