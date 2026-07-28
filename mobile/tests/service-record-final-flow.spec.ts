import { expect, test } from "@playwright/test";

import { isoDateInKorea } from "../src/lib/date/business-days";

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: "UTC",
});

const TEST_NOW = new Date("2026-07-14T15:30:00.000Z");
const todayKst = isoDateInKorea(TEST_NOW);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(TEST_NOW);
});

const header = {
  momName: "김산모",
  momBirth: "900101",
  babyName: "김아기",
  babyBirth: "260714",
  babyWeight: "3.2",
  deliveryType: "자연분만",
};

async function mockShellRequests(page: import("@playwright/test").Page) {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
}

async function signServiceRecord(page: import("@playwright/test").Page) {
  const signaturePad = page.getByLabel("산모 서명 입력");
  await expect(signaturePad).toBeVisible();
  // page.mouse works in viewport coordinates and never auto-scrolls, so the pad
  // has to be brought into view before its box is read — the confirm step is
  // taller than the viewport and the pad sits below the fold.
  await signaturePad.scrollIntoViewIfNeeded();

  const box = await signaturePad.boundingBox();
  if (!box) throw new Error("산모 서명 입력 영역을 찾을 수 없습니다.");

  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 96, box.y + 56, { steps: 5 });
  await page.mouse.up();
}

test("백엔드 서비스 일수만큼 제공기록표를 생성한다", async ({ page }) => {
  const token = "dynamic-service-days";

  await mockShellRequests(page);
  await page.route(`**/api/service-record/${token}/link`, (route) => route.fulfill({ json: { valid: true } }));
  await page.route(`**/api/service-record/${token}/verify`, (route) => route.fulfill({ status: 201, json: { ok: true, accessToken: "access-token" } }));
  await page.route(`**/api/service-record/${token}/context`, (route) => route.fulfill({
    json: {
      employee: { id: 1, name: "김제공" },
      client: { id: 1, name: "테스트 고객" },
      totalSessions: 20,
      startDate: todayKst,
      header,
      sessions: [],
    },
  }));

  await page.goto(`/service-record/${token}`);
  await expect(page.getByText("제공기록표", { exact: true })).toBeVisible();
  await expect(page.locator('[data-component="mobile_service-record_wizard_body_day-grid"] > button')).toHaveCount(20);
  await expect(page.locator('[data-component="mobile_service-record_wizard_body_day-grid_day_number"]').filter({ hasText: "20" })).toHaveCount(1);
});

test("서비스 제공일자가 오늘과 달라도 경고만 표시하고 기록을 작성한다", async ({ page }) => {
  const token = "service-date-mismatch-warning";

  await mockShellRequests(page);
  await page.route(`**/api/service-record/${token}/link`, (route) => route.fulfill({ json: { valid: true } }));
  await page.route(`**/api/service-record/${token}/verify`, (route) => route.fulfill({ status: 201, json: { ok: true, accessToken: "access-token" } }));
  await page.route(`**/api/service-record/${token}/context`, (route) => route.fulfill({
    json: {
      org: { name: "테스트 제공기관", hours: "" },
      employee: { id: 1, name: "김제공" },
      client: { id: 1, name: "테스트 고객" },
      totalSessions: 2,
      startDate: "2026-07-20",
      header,
      sessions: [],
      recordStatus: "IN_PROGRESS",
    },
  }));

  await page.goto(`/service-record/${token}`);
  await expect(page.getByText("서비스 제공 기록은 해당 날짜에만 기록이 가능합니다.", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "기록 시작" }).click();

  await expect(page.locator('[data-component="mobile_service-record_wizard_body_date-mismatch-notice"]'))
    .toHaveText("서비스 제공일자(2026.07.20)가 오늘과 달라요. 한번 더 확인해 주세요.");
  await expect(page.getByRole("button", { name: "열상" })).toBeEnabled();
  await page.getByRole("button", { name: "열상" }).click();
  await page.getByLabel("식사").fill("3");
  await page.getByLabel("간식").fill("2");
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await expect(page.locator('[data-component="mobile_service-record_wizard_body_day-title"]')).toHaveText("신생아 기록");
});

test("마지막 회차 제출 후 별도 버튼 없이 최종 제출을 완료한다", async ({ page }) => {
  const token = "final-service-record";
  let headerSaved = false;
  let submitted = false;
  let finalizeCalls = 0;
  let submittedBody: Record<string, unknown> | null = null;

  await mockShellRequests(page);
  await page.route(`**/api/service-record/${token}/link`, (route) => route.fulfill({ json: { valid: true } }));
  await page.route(`**/api/service-record/${token}/verify`, (route) => route.fulfill({ status: 201, json: { ok: true, accessToken: "access-token" } }));
  await page.route(`**/api/service-record/${token}/header`, async (route) => {
    headerSaved = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/service-record/${token}/sessions/1/submit`, async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    submitted = true;
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route(`**/api/service-record/${token}/finalize`, async (route) => {
    finalizeCalls += 1;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/service-record/${token}/context`, (route) => route.fulfill({
    json: {
      org: { name: "테스트 제공기관", hours: "" },
      employee: { id: 1, name: "김제공" },
      client: { id: 1, name: "테스트 고객" },
      totalSessions: 1,
      startDate: todayKst,
      header: headerSaved ? header : null,
      sessions: submitted ? [{ sessionIndex: 1, serviceDate: todayKst, locked: true, momApproval: "approved" }] : [],
      recordStatus: submitted ? "WAITING_FOR_END" : "IN_PROGRESS",
    },
  }));

  await page.goto(`/service-record/${token}`);
  await page.getByPlaceholder("예) 홍길동").fill(header.momName);
  await page.getByPlaceholder("예) 900101").fill(header.momBirth);
  await page.getByPlaceholder("예) 홍아기").fill(header.babyName);
  await page.getByPlaceholder("예) 260615").fill(header.babyBirth);
  await page.getByPlaceholder("예) 3.2").fill(header.babyWeight);
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await page.getByRole("button", { name: "기록 시작" }).click();
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByLabel("식사").fill("3");
  await page.getByLabel("간식").fill("2");
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await page.getByLabel("체온").fill("36.5");
  const breastFeedingField = page.locator('[data-component="mobile_service-record_wizard_body_day-field"]').filter({ hasText: "⑧ 모유수유" });
  const formulaFeedingField = page.locator('[data-component="mobile_service-record_wizard_body_day-field"]').filter({ hasText: "⑨ 분유수유" });
  await breastFeedingField.getByRole("spinbutton").fill("5");
  await formulaFeedingField.getByLabel("횟수").fill("4");
  await formulaFeedingField.getByLabel("회당").fill("80");
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "결제 확인 완료" }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await signServiceRecord(page);
  await page.getByRole("button", { name: "확인", exact: true }).click();
  const submitDialog = page.getByRole("dialog", { name: "제출하시겠어요?" });
  await expect(submitDialog).toBeVisible();
  await submitDialog.getByRole("button", { name: "확인", exact: true }).click();

  await expect(page.getByText("최종 제출 완료", { exact: true })).toBeVisible();
  await expect(page.getByText("제공기록지 제출이 완료되었습니다.", { exact: true })).toBeVisible();
  expect(finalizeCalls).toBe(0);
  expect(submittedBody).toMatchObject({
    clientSignature: expect.any(String),
    momApproval: "approved",
    paymentConfirmed: true,
  });
});

test("기본정보 저장 실패 시 입력값을 보존하고 다음 단계로 이동하지 않는다", async ({ page }) => {
  const token = "header-save-failure";

  await mockShellRequests(page);
  await page.route(`**/api/service-record/${token}/link`, (route) => route.fulfill({ json: { valid: true } }));
  await page.route(`**/api/service-record/${token}/verify`, (route) => route.fulfill({
    status: 201,
    json: { ok: true, accessToken: "access-token" },
  }));
  await page.route(`**/api/service-record/${token}/header`, (route) => route.fulfill({
    status: 500,
    json: { message: "기본정보 저장에 실패했습니다." },
  }));
  await page.route(`**/api/service-record/${token}/context`, (route) => route.fulfill({
    json: {
      org: { name: "테스트 제공기관", hours: "" },
      employee: { id: 1, name: "김제공" },
      client: { id: 1, name: "테스트 고객" },
      totalSessions: 1,
      startDate: todayKst,
      header: null,
      sessions: [],
      recordStatus: "IN_PROGRESS",
    },
  }));

  await page.goto(`/service-record/${token}`);
  await page.getByPlaceholder("예) 홍길동").fill(header.momName);
  await page.getByPlaceholder("예) 900101").fill(header.momBirth);
  await page.getByPlaceholder("예) 홍아기").fill(header.babyName);
  await page.getByPlaceholder("예) 260615").fill(header.babyBirth);
  await page.getByPlaceholder("예) 3.2").fill(header.babyWeight);
  await page.getByRole("button", { name: "다음", exact: true }).click();

  await expect(page.getByText("기본정보 저장에 실패했습니다.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-component="mobile_service-record_wizard_body_service-title"]')).toHaveText("서비스 기본정보");

  await page.reload();
  await expect(page.getByPlaceholder("예) 홍길동")).toHaveValue(header.momName);
  await expect(page.getByPlaceholder("예) 홍아기")).toHaveValue(header.babyName);
});
