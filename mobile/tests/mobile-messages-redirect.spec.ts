import { expect, test } from "@playwright/test";

test.describe("Mobile messages route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("redirects /messages to the new message compose page", async ({ page }) => {
    await page.goto("/messages");

    await expect(page).toHaveURL(/\/messages\/new$/);
    await expect(page.locator('form[data-form="messages-new-form"]')).toBeVisible();
  });
});
