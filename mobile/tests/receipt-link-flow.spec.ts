import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const TOKEN = "efr_test";
const STATUS = {
    ok: true,
    state: "pending",
    branchName: "인천 아이미래로",
    expiresAt: "2026-10-03T00:00:00.000Z",
    remainingAttempts: 5,
    lockedUntil: null,
};

test("mother verifies her birthday and reaches the receipt image", async ({ page }) => {
    let attempts = 0;
    await page.route(`**/api/receipt/${TOKEN}/status`, (route) => route.fulfill({ json: STATUS }));
    await page.route(`**/api/receipt/${TOKEN}/verify`, (route) => {
        attempts += 1;
        if (attempts === 1) {
            return route.fulfill({ status: 401, json: { reason: "verification_failed", remainingAttempts: 4 } });
        }
        return route.fulfill({ json: { ok: true, clientName: "김산모" } });
    });
    await page.route(`**/api/receipt/${TOKEN}/image*`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
        }),
    );

    await page.goto(`/receipt/${TOKEN}`);
    await expect(page.getByRole("heading", { name: "본인부담금 영수증" })).toBeVisible();
    await expect(page.getByText("인천 아이미래로")).toBeVisible();
    await expect(page.getByText("김산모")).toHaveCount(0);

    await page.getByLabel("산모 생년월일").fill("000000");
    await page.getByRole("button", { name: "확인하기" }).click();
    // Next.js's built-in route announcer also carries role="alert" (always present,
    // empty text), so scope to the page's own error element rather than the role alone.
    await expect(page.locator(".rcpt-err")).toHaveText("생년월일이 일치하지 않습니다. 남은 횟수 4회");
    await expect(page.getByText("5회 연속 틀리면 30분 동안 확인이 잠깁니다", { exact: false })).toBeVisible();

    await page.getByLabel("산모 생년월일").fill("940315");
    await page.getByRole("button", { name: "다시 확인하기" }).click();
    await expect(page.getByRole("heading", { name: "김산모 산모님 영수증" })).toBeVisible();
    await expect(page.getByText("확인 완료")).toBeVisible();
    await expect(page.getByRole("link", { name: "이미지 저장" })).toHaveAttribute(
        "href",
        `/api/receipt/${TOKEN}/image?download=1`,
    );
    await expect(page.getByText("이 링크는 발송일로부터 30일간 유효합니다.")).toBeVisible();
});

test("expired links show the expiry screen without a phone number", async ({ page }) => {
    await page.route(`**/api/receipt/${TOKEN}/status`, (route) => route.fulfill({ status: 410, json: { reason: "expired" } }));
    await page.goto(`/receipt/${TOKEN}`);
    await expect(page.getByRole("heading", { name: "링크 유효기간이 지났습니다" })).toBeVisible();
    await expect(page.getByText(/010-\d{4}-\d{4}/)).toHaveCount(0);
});

test("a locked link disables the form", async ({ page }) => {
    await page.route(`**/api/receipt/${TOKEN}/status`, (route) =>
        route.fulfill({ json: { ...STATUS, remainingAttempts: 0, lockedUntil: "2026-09-03T01:00:00.000Z" } }),
    );
    await page.goto(`/receipt/${TOKEN}`);
    await expect(page.getByRole("button", { name: "확인하기" })).toBeDisabled();
    await expect(page.locator(".rcpt-err")).toContainText("확인이 잠겼습니다");
});
