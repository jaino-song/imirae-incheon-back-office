import { test, expect } from "@playwright/test";

// /clients/new?clientId=<id> 진입 시 기존 wizard가 편집 모드로 전환되고
// 모든 필드가 mock client로 하이드레이트되는지 시각/값 검증.
// 데이터는 page.route()로 mock하므로 시드 의존 없음.

const CLIENT_ID = 42;
const VOUCHER_TYPE = "A통합3형";
const OUT_OF_POCKET_PRICES = [
  { id: 1, duration: 5, fullPrice: "815000" },
  { id: 2, duration: 10, fullPrice: "1620000" },
  { id: 3, duration: 15, fullPrice: "2425000" },
  { id: 4, duration: 20, fullPrice: "3240000" },
];
const VOUCHER_PRICE_INFOS = [
  {
    id: 24,
    type: VOUCHER_TYPE,
    duration: "20",
    fullPrice: "2848000",
    grant: "1766000",
    actualPrice: "1082000",
  },
];

const MOCK_CLIENT = {
  id: CLIENT_ID,
  name: "테스트 고객",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
  birthday: "950414",
  dueDate: "2026-06-11",
  address: "인천시 동구 송현로 100",
  phone: "010-9641-1878",
  primaryEmployee: { id: 1, name: "김정인" },
  secondaryEmployee: { id: 2, name: "박지영" },
  type: VOUCHER_TYPE,
  duration: 20,
  fullPrice: "2848000",
  grant: "1766000",
  actualPrice: "1082000",
  startDate: "2026-05-30",
  endDate: "2026-06-26",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "waiting",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

test.use({ viewport: { width: 390, height: 844 } });

test.describe("clients edit wizard hydration", () => {
  test("hydrates Client into wizard via ?clientId — three steps render saved values", async ({ page }) => {
    // 1. 단일 고객 fetch mock
    await page.route(`**/api/clients/${CLIENT_ID}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CLIENT),
      });
    });

    // 2. 가격 정보 API는 production과 동일하게 배열을 반환한다.
    await page.route("**/api/voucher-price-infos**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const type = requestUrl.searchParams.get("type");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(type === VOUCHER_TYPE ? VOUCHER_PRICE_INFOS : []),
      });
    });
    await page.route("**/api/out-of-pocket-price-infos**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OUT_OF_POCKET_PRICES),
      });
    });

    // 3. 제공인력 자동완성 데이터
    await page.route("**/api/employees**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: 1, name: "김정인", status: "active" },
          { id: 2, name: "박지영", status: "active" },
        ]),
      });
    });

    // 4. 전화번호 중복 체크 — edit 모드 본인번호는 코드에서 short-circuit하지만, 안전망.
    await page.route("**/api/clients/check-phone**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exists: false }),
      });
    });

    // 직접 편집 모드로 진입
    await page.goto(`/clients/new?clientId=${CLIENT_ID}`);

    // 네브바 타이틀이 편집 모드 텍스트로 바뀌어야 함
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_navbar_title"]')).toHaveText("고객 정보 수정");

    // ── Step 1 (기본 정보) ──
    const nameInput = page.locator('input[placeholder="홍길동"]');
    await expect(nameInput).toHaveValue(MOCK_CLIENT.name);
    const phoneInput = page.locator('input[placeholder="010-1234-5678"]');
    await expect(phoneInput).toHaveValue(MOCK_CLIENT.phone);
    const birthdayInput = page.locator('input[placeholder="YYMMDD"]').nth(0);
    await expect(birthdayInput).toHaveValue("950414");
    const dueDateInput = page.locator('input[placeholder="YYMMDD"]').nth(1);
    // ISO "2026-06-11" → "260611"
    await expect(dueDateInput).toHaveValue("260611");
    const addressInput = page.locator('input[placeholder="서울시 강남구..."]');
    await expect(addressInput).toHaveValue(MOCK_CLIENT.address);

    await page.screenshot({
      path: "tests/screenshots/clients-edit-step1-basic.png",
      fullPage: false,
    });

    // 다음 단계 — 1차 "다음" 버튼
    const primaryBtn = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1);
    await expect(primaryBtn).toHaveText("다음");
    await primaryBtn.click();

    // ── Step 2 (서비스 설정 — 바우처/제공인력/요금/옵션) ──
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card"]')).toBeVisible();
    // 가격 hydrate (1000s 단위 콤마 포매팅)
    const fullPriceInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_full-price-field_input-wrap"] input');
    await expect(fullPriceInput).toHaveValue("2,848,000");
    const grantInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_grant-field_input-wrap"] input');
    await expect(grantInput).toHaveValue("1,766,000");
    const actualPriceInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_actual-price-field_input-wrap"] input');
    await expect(actualPriceInput).toHaveValue("1,082,000");

    await page.screenshot({
      path: "tests/screenshots/clients-edit-step2-service.png",
      fullPage: false,
    });

    await primaryBtn.click();

    // ── Step 3 (계약 정보) ──
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_contract-status-card"]')).toBeVisible();
    const startDateInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_service-period-card"] input').nth(0);
    await expect(startDateInput).toHaveValue("260530");
    const endDateInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_service-period-card"] input').nth(1);
    // hydrate "260626" (ISO 2026-06-26 → YYMMDD). business-days 재계산이 덮어쓸 수 있는데,
    // 정확한 결과는 휴일 캘린더 의존이므로 6자리 YYMMDD 모양만 확인.
    await expect(endDateInput).toHaveValue(/^\d{6}$/);

    // 마지막 단계 primary 버튼 라벨이 "저장" 인지 확인 (편집 모드 분기)
    await expect(primaryBtn).toHaveText("저장");

    await page.screenshot({
      path: "tests/screenshots/clients-edit-step3-contract.png",
      fullPage: false,
    });
  });

  test("new self-pay client selects only a period and receives an editable total price", async ({ page }) => {
    await page.route("**/api/out-of-pocket-price-infos**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OUT_OF_POCKET_PRICES),
      });
    });
    await page.route("**/api/voucher-price-infos**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/employees**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/clients/check-phone**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exists: false }),
      });
    });

    await page.goto("/clients/new");
    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_name-field_name-input"]').fill("자부담 신규 고객");
    const compactDateInputs = page.locator('input[placeholder="YYMMDD"]');
    await compactDateInputs.nth(0).fill("900101");
    await compactDateInputs.nth(1).fill("260901");
    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_phone-field_phone-input"]').fill("01012345678");

    const nextButton = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1);
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_customer-type-field_toggle_self-pay-button"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_voucher-type-field_select-wrap_select"]')).toHaveCount(0);
    await expect(page.getByText("정부지원금", { exact: true })).toHaveCount(0);
    await expect(page.getByText("본인부담금", { exact: true })).toHaveCount(0);

    const durationSelect = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_duration-field_select-wrap_select"]');
    await expect(durationSelect).toBeEnabled();
    await expect(durationSelect.locator('option[value="5"]')).toHaveText("1주 (5일)");
    await durationSelect.selectOption("5");

    const fullPriceInput = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_full-price-field_input-wrap_input"]');
    await expect(fullPriceInput).toHaveValue("815,000");
    await fullPriceInput.fill("820000");
    await expect(fullPriceInput).toHaveValue("820,000");
  });
});
