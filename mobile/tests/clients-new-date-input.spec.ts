import { expect, test, type Page } from "@playwright/test";

/**
 * The registration wizard used to take every date as bare YYMMDD. Dates are
 * keyed in as YYYY-MM-DD now, matching the call review sheet, so a reviewer
 * confirming a draft and someone filling the form by hand type the same thing.
 *
 * 생년월일 is the exception and stays YYMMDD — it is stored that way
 * (client.birthday is a varchar(6)), not as a date.
 */

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const CLIENT = {
  id: 7,
  name: "김서연",
  phone: "010-4821-7763",
  birthday: "990315",
  dueDate: "2026-09-15",
  startDate: "2026-09-20",
  endDate: "2026-10-17",
  address: "인천 부평구",
  type: "A통합1형",
  duration: "20",
  voucherClient: true,
  careCenter: false,
  breastPump: false,
  status: "IN_PROGRESS",
  fullPrice: "1000000",
  grant: "700000",
  actualPrice: "300000",
};

async function mockApi(page: Page) {
  // Playwright gives the LAST matching route priority, so the catch-all is
  // registered first and the specific handlers override it.
  await page.route("**/api/**", (route) => route.fulfill(json([])));
  await page.route("**/api/auth/me", (route) =>
    route.fulfill(json({ id: "owner-1", name: "관리자", role: "owner" })),
  );
  await page.route("**/api/clients/7", (route) => route.fulfill(json(CLIENT)));
}

const dueDate = (page: Page) =>
  page.locator('[data-component$="due-date-field_due-date-input"]');
const birthday = (page: Page) =>
  page.locator('[data-component$="birthday-field_birthday-input"]');

test.describe("Client registration date inputs", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("types dates out as YYYY-MM-DD", async ({ page }) => {
    await mockApi(page);
    await page.goto("/clients/new");
    await expect(dueDate(page)).toBeVisible();

    await expect(dueDate(page)).toHaveAttribute("maxlength", "10");
    await expect(dueDate(page)).toHaveAttribute("placeholder", "YYYY-MM-DD");

    await dueDate(page).pressSequentially("20260915");
    await expect(dueDate(page)).toHaveValue("2026-09-15");
  });

  test("leaves 생년월일 as the six digits it is stored as", async ({ page }) => {
    await mockApi(page);
    await page.goto("/clients/new");
    await expect(birthday(page)).toBeVisible();

    await expect(birthday(page)).toHaveAttribute("maxlength", "6");
    await expect(birthday(page)).toHaveAttribute("placeholder", "YYMMDD");

    await birthday(page).pressSequentially("990315");
    await expect(birthday(page)).toHaveValue("990315");
  });

  test("fills an existing client's dates back in as ISO", async ({ page }) => {
    await mockApi(page);
    await page.goto("/clients/new?clientId=7");

    // Hydration used to convert down to YYMMDD; the store holds ISO now.
    await expect(dueDate(page)).toHaveValue("2026-09-15", { timeout: 10_000 });
    await expect(birthday(page)).toHaveValue("990315");
  });
});
