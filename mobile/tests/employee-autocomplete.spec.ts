import { expect, test, type Page } from '@playwright/test';

// The employee autocomplete lives on STEP 1 (service settings) of the
// /clients/new wizard — the beforeEach must complete step 0 first.

// Canonical data-component values rendered by the wizard's provider-assignment card.
// Producers: mobile/src/app/(shell)/clients/new/page.tsx:1034 (card),
// :1038 / :1052 (primary/secondary EmployeeAutocomplete bases) and
// mobile/src/components/app/ui/Autocomplete.tsx:209-214 (suffix derivation).
const EMPLOYEE_CARD =
  'mobile_clients-new_screen_root_page_wizard_form-scroll_employee-card';
const PRIMARY_AUTOCOMPLETE = `${EMPLOYEE_CARD}_primary-field_autocomplete`;

const EMPLOYEES = [
  {
    id: 11,
    name: '테스트직원',
    workArea: ['인천'],
    phone: '010-1111-1111',
    grade: '베스트',
    openToNextWork: true,
    registeredDate: '2026-06-01',
    status: 'available',
  },
  {
    id: 12,
    name: '보조직원',
    workArea: ['인천'],
    phone: '010-2222-2222',
    grade: '프리미엄',
    openToNextWork: true,
    registeredDate: '2026-06-01',
    status: 'available',
  },
];

async function mockWizardRoutes(page: Page) {
  await page.route('**/api/notifications/vapid-key**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ publicKey: 'test-vapid-key' }),
    });
  });

  await page.route('**/api/employees', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPLOYEES),
    });
  });

  await page.route('**/api/bank-account-infos', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ area: 'area-incheon', bankName: '국민은행', accNum: '123-456-7890' }]),
    });
  });

  await page.route('**/api/clients/check-phone**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ exists: false }),
    });
  });

  await page.route('**/api/voucher-price-infos/type**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/clients', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

test.describe('EmployeeAutocomplete', () => {
  test.beforeEach(async ({ page }) => {
    await mockWizardRoutes(page);

    await page.goto('/clients/new');
    await expect(page.locator('[data-component="mobile_clients-new_screen_root"]')).toBeVisible({
      timeout: 15000,
    });

    // Complete step 0 (basic info) to reach step 1 where the autocomplete mounts.
    await page.getByPlaceholder('홍길동').fill('홍테스트 고객');
    await page.getByPlaceholder('010-1234-5678').fill('01011112222');
    await page.getByPlaceholder('YYMMDD').nth(0).fill('950101');
    await page.getByPlaceholder('YYMMDD').nth(1).fill('260615');
    await page.getByPlaceholder('서울시 강남구...').fill('인천광역시 연수구 테스트로 10');
    await expect(
      page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card"] [data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_phone-field_helper"]')
    ).toContainText('등록 가능한 번호입니다.');

    await page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button').nth(1).click();
    await expect(page.locator('[data-component="mobile_clients-new_screen_root_page_wizard_header_progress-row_step-count"]')).toHaveText('2 / 3 단계');
  });

  test('renders employee autocompletes on the client creation wizard', async ({ page }) => {
    const employeeAutocompletes = page.locator(
      `[data-component^="${EMPLOYEE_CARD}"][data-slot="autocomplete"]`
    );

    await expect(employeeAutocompletes.first()).toBeVisible();
    await expect(employeeAutocompletes).toHaveCount(2);
  });

  test('opens the dropdown on focus and keeps the manual-entry action visible', async ({ page }) => {
    const autocompleteInput = page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_input"]`);

    await autocompleteInput.click();
    await expect(page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_dropdown"]`)).toBeVisible();
    await expect(page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_toggle"]`)).toBeVisible();
  });

  test('keeps the manual-entry action visible while filtering', async ({ page }) => {
    const autocompleteInput = page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_input"]`);

    await autocompleteInput.click();
    await expect(page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_dropdown"]`)).toBeVisible();

    await autocompleteInput.fill('xyz-nonexistent');
    await expect(page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_toggle"]`)).toBeVisible();
  });

  test('opens the employee dialog with the typed name prefilled', async ({ page }) => {
    const autocompleteInput = page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_input"]`);
    const typedName = '신규직원';

    await autocompleteInput.click();
    await expect(page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_dropdown"]`)).toBeVisible({
      timeout: 5000,
    });

    await autocompleteInput.fill(typedName);
    await page.locator(`[data-component="${PRIMARY_AUTOCOMPLETE}_toggle"]`).click();

    const employeeDialog = page.locator('[data-component="employees-form-dialog"]');
    await expect(employeeDialog).toBeVisible({ timeout: 5000 });
    await expect(employeeDialog.locator('[data-component="mobile_employees_form-dialog_card_section-basic_field-name"] input')).toHaveValue(
      typedName,
    );
  });
});
