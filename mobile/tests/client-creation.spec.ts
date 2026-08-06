import { expect, test, type Page } from "@playwright/test";

const VOUCHER_TYPE = "A가1형";
const VOUCHER_DURATION = "10";

const EMPLOYEES = [
  {
    id: 11,
    name: "테스트직원",
    workArea: ["인천"],
    phone: "010-1111-1111",
    grade: "베스트",
    openToNextWork: true,
    registeredDate: "2026-06-01",
    status: "available",
  },
  {
    id: 12,
    name: "보조직원",
    workArea: ["인천"],
    phone: "010-2222-2222",
    grade: "프리미엄",
    openToNextWork: true,
    registeredDate: "2026-06-01",
    status: "available",
  },
];

const BANK_ACCOUNT_INFOS = [
  {
    area: "area-incheon",
    bankName: "국민은행",
    accNum: "123-456-7890",
  },
];

const VOUCHER_PRICE_INFOS = [
  {
    id: 2,
    type: VOUCHER_TYPE,
    duration: VOUCHER_DURATION,
    fullPrice: "1300000",
    grant: "1000000",
    actualPrice: "300000",
  },
];

const OUT_OF_POCKET_PRICE_INFOS = [
  { id: 1, duration: 5, fullPrice: "815000" },
  { id: 2, duration: 10, fullPrice: "1620000" },
  { id: 3, duration: 15, fullPrice: "2425000" },
  { id: 4, duration: 20, fullPrice: "3240000" },
];

type CreateClientPayload = Record<string, unknown>;

async function mockClientsWizardRoutes(page: Page, options?: { onCreate?: (payload: CreateClientPayload) => void }) {
  await page.route("**/api/notifications/vapid-key**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "test-vapid-key" }),
    });
  });

  await page.route("**/api/employees", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPLOYEES),
    });
  });

  await page.route("**/api/bank-account-infos", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BANK_ACCOUNT_INFOS),
    });
  });

  await page.route("**/api/clients/check-phone**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: false }),
    });
  });

  await page.route("**/api/voucher-price-infos/type**", async (route) => {
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
      body: JSON.stringify(OUT_OF_POCKET_PRICE_INFOS),
    });
  });

  await page.route("**/api/clients", async (route) => {
    if (route.request().method() === "POST") {
      options?.onCreate?.(route.request().postDataJSON() as CreateClientPayload);

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: 501,
          name: "홍테스트 고객",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

async function fillStepZero(page: Page) {
  await page.getByPlaceholder("홍길동").fill("홍테스트 고객");
  await page.getByPlaceholder("010-1234-5678").fill("01011112222");
  await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-details-card_birthday-field_birthday-input"]').fill("950101");
  await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-details-card_due-date-field_due-date-input"]').fill("2026-06-15");
  await page.getByPlaceholder("서울시 강남구...").fill("인천광역시 연수구 테스트로 10");

  await expect(
    page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card"] [data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_phone-field_helper"]')
  ).toContainText("등록 가능한 번호입니다.");
}

async function goToStepOne(page: Page) {
  await fillStepZero(page);
  await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1).click();
  await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card"]')).toBeVisible();
  await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText("2 / 3 단계");
}

async function fillDeterministicVoucherFields(page: Page) {
  const voucherToggle = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_customer-type-field_toggle_voucher-button"]');
  await voucherToggle.click();
  await expect(voucherToggle).toHaveAttribute("aria-selected", "true");

  const voucherTypeSelect = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_voucher-type-field_select-wrap_select"]');
  await voucherTypeSelect.selectOption(VOUCHER_TYPE);

  const durationSelect = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_duration-field_select-wrap"] select');
  await expect(durationSelect.locator(`option[value="${VOUCHER_DURATION}"]`)).toHaveCount(1);
  await durationSelect.selectOption(VOUCHER_DURATION);

  await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_full-price-field_input-wrap"] input')).toHaveValue("1,300,000");
  await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_grant-field_input-wrap"] input')).toHaveValue("1,000,000");
  await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card_actual-price-field_input-wrap"] input')).toHaveValue("300,000");
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("clients/new wizard", () => {
  test("renders the wizard shell and the initial basic-info step", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await expect(page.locator('[data-component="mobile_clients-new_screen_root"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_navbar_title"]')).toHaveText("새 고객 추가");
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText("1 / 3 단계");
    await expect(page.getByRole("heading", { name: "기본 정보" })).toBeVisible();
    await expect(page.getByPlaceholder("홍길동")).toBeVisible();
    await expect(page.getByPlaceholder("010-1234-5678")).toBeVisible();
  });

  test("blocks advancing from step 0 while required fields are empty", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    const primaryButton = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1);

    await expect(primaryButton).toBeDisabled();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText("1 / 3 단계");
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card"]')).toHaveCount(0);
  });

  test("advances to step 1 after filling the basic info step", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await fillStepZero(page);

    const primaryButton = page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1);
    await expect(primaryButton).toBeEnabled();
    await primaryButton.click();

    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText("2 / 3 단계");
    await expect(page.getByText("서비스 설정")).toBeVisible();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card"]')).toBeVisible();
  });

  test("renders voucher selects on step 1 and auto-fills prices from mocked voucher data", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await goToStepOne(page);
    await fillDeterministicVoucherFields(page);

    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_pricing-card"]')).toContainText("자동입력");
  });

  test("opens the mobile employee creation modal from the provider assignment card", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await goToStepOne(page);

    // Autocomplete derives every descendant value from the caller base
    // (mobile/src/components/app/ui/Autocomplete.tsx:209-214).
    const primaryAutocomplete =
      "mobile_clients-new_screen_root_page_wizard_form-scroll_employee-card_primary-field_autocomplete";
    const employeeInput = page.locator(`[data-component="${primaryAutocomplete}_input"]`);

    await employeeInput.click();
    await employeeInput.fill("김정인");
    await page.locator(`[data-component="${primaryAutocomplete}_toggle"]`).click();

    const dialog = page.locator('[data-component="employees-form-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/nav-page detail/);
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    await expect(dialog.locator('[data-component="employees-form-dialog-header"]')).toContainText("새 제공인력 등록");
    await expect(dialog.locator('[data-component="employees-form-dialog-header"]')).not.toContainText("고객 생성 중 바로 추가");
    await expect(dialog.locator('[data-component="employees-form-dialog-content"]')).toHaveClass(/detail-body detail-column/);
    await expect(dialog.locator('[data-component="employees-form-dialog-content"] > [data-component="employees-form-dialog-header"]')).toHaveCount(1);
    await expect(dialog.locator('[data-component="employees-form-dialog-content"] > [data-component="mobile_employees_form-dialog_card"]')).toHaveCount(1);
    await expect(dialog.locator('[data-component="employees-form-dialog-content"] > [data-component="employees-form-dialog-actions"]')).toHaveCount(1);
    await expect(dialog.locator('[data-component="employees-form-dialog-actions"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(dialog.locator('[data-component="employees-form-dialog-actions"]')).toHaveCSS("border-radius", "16px");
    await expect
      .poll(async () => dialog.evaluate((element) => {
        const workSection = element.querySelector('[data-component="mobile_employees_form-dialog_card_section-work"]');
        const actions = element.querySelector('[data-component="employees-form-dialog-actions"]');
        if (!workSection || !actions) {
          return false;
        }
        return Boolean(workSection.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING);
      }))
      .toBe(true);
    await expect(dialog.locator('[data-component="mobile_employees_form-dialog_card_assignment"]')).toContainText("제공인력 1에 배정");
    await expect(dialog.locator('[data-component="mobile_employees_form-dialog_card_section-basic_field-name"] input')).toHaveValue("김정인");
    await expect(dialog.locator('[data-component="mobile_employees_form-dialog_card_section-basic_field-birthday"] input')).toHaveAttribute("placeholder", "YYMMDD");
    await expect(dialog.locator('[data-component="employees-form-dialog-submit"]')).toHaveText("등록");
    await expect(dialog.locator('[data-component="employees-form-dialog-cancel"]')).toHaveClass(/btn-press/);
    await expect(dialog.locator('[data-component="employees-form-dialog-submit"]')).toHaveClass(/btn-press/);
    await expect(dialog.locator('[data-component="employees-form-dialog-cancel"]')).toHaveAttribute("data-slot", "button");
    await expect(dialog.locator('[data-component="employees-form-dialog-cancel"]')).toHaveAttribute("data-size", "md");
    await expect(dialog.locator('[data-component="employees-form-dialog-cancel"]')).toHaveAttribute("data-width", "lg");
    await expect(dialog.locator('[data-component="employees-form-dialog-submit"]')).toHaveAttribute("data-slot", "button");
    await expect(dialog.locator('[data-component="employees-form-dialog-submit"]')).toHaveAttribute("data-size", "md");
    await expect(dialog.locator('[data-component="employees-form-dialog-submit"]')).toHaveAttribute("data-width", "lg");
    const cancelButtonBox = await dialog.locator('[data-component="employees-form-dialog-cancel"]').boundingBox();
    const submitButtonBox = await dialog.locator('[data-component="employees-form-dialog-submit"]').boundingBox();
    expect(Math.round(cancelButtonBox?.height ?? 0)).toBe(46);
    expect(Math.round(submitButtonBox?.height ?? 0)).toBe(46);

    const gradeSelect = dialog.locator('[data-component="mobile_employees_form-dialog_card_section-work_field-grade"] select');
    await expect(gradeSelect).toHaveValue("스탠다드");
    await expect(gradeSelect.locator("option")).toHaveText(["스탠다드", "베스트", "프리미엄"]);

    await expect
      .poll(async () => dialog.evaluate((element) => getComputedStyle(element).transform))
      .toBe("matrix(1, 0, 0, 1, 0, 0)");

    const box = await dialog.boundingBox();
    const shellBox = await page.locator('[data-component="employees-form-dialog-shell"]').boundingBox();
    const appProvidersBox = await page.locator('[data-slot="app-content"]').boundingBox();
    expect(Math.round(shellBox?.x ?? 0)).toBe(Math.round(appProvidersBox?.x ?? 0));
    expect(Math.round(shellBox?.width ?? 0)).toBe(Math.round(appProvidersBox?.width ?? 0));
    expect(Math.round(box?.x ?? 0)).toBe(Math.round(appProvidersBox?.x ?? 0));
    expect(Math.round(box?.width ?? 0)).toBe(Math.round(appProvidersBox?.width ?? 0));
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box?.width).toBeLessThanOrEqual(390);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    expect(Math.round(box?.y ?? 0)).toBe(42);
    await expect
      .poll(async () => Number(await dialog.evaluate((element) => getComputedStyle(element).zIndex)))
      .toBeGreaterThan(60);
    await expect
      .poll(async () => dialog.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.borderBottomLeftRadius} ${style.borderBottomRightRadius}`;
      }))
      .toBe("0px 0px");

    await dialog.locator('[data-component="employees-form-dialog-cancel"]').click();
    await expect
      .poll(async () => dialog.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
      .toBeGreaterThan(0);
    await expect(dialog.locator('[data-component="employees-form-dialog-content"]')).toHaveCount(0);
  });

  test("submits the minimal valid wizard payload and navigates back to /clients", async ({ page }) => {
    let createdPayload: CreateClientPayload | null = null;

    await mockClientsWizardRoutes(page, {
      onCreate: (payload) => {
        createdPayload = payload;
      },
    });
    await page.goto("/clients/new");

    await fillStepZero(page);
    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1).click();

    await fillDeterministicVoucherFields(page);
    // The wizard no longer collects a service area — `areaId` is only hydrated
    // from an existing client when editing, so a fresh create posts it as null.
    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1).click();

    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText("3 / 3 단계");
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_contract-status-card"]')).toBeVisible();

    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1).click();

    await expect(page).toHaveURL(/\/clients$/);
    expect(createdPayload).toEqual(
      expect.objectContaining({
        name: "홍테스트 고객",
        birthday: "950101",
        dueDate: "2026-06-15",
        address: "인천광역시 연수구 테스트로 10",
        phone: "010-1111-2222",
        type: VOUCHER_TYPE,
        duration: 10,
        fullPrice: "1300000",
        grant: "1000000",
        actualPrice: "300000",
        careCenter: false,
        voucherClient: true,
        breastPump: false,
        // The minimal payload never opens the 계약 상태 select, so this is the
        // wizard store's untouched default (client-wizard-store.ts).
        serviceStatus: "pre_booking",
        areaId: null,
      })
    );
  });
});
