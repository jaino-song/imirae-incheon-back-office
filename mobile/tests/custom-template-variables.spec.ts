import { expect, test, type Page, type Request, type Route } from '@playwright/test';

type CustomVariableFixture = {
  key: string;
  label: string;
  required: boolean;
};

type SystemTemplateFixture = {
  id: string;
  templateKey: string;
  name: string;
  description: string;
  content: string;
  requiredVariables: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  customVariables: CustomVariableFixture[];
  updatedAt: string;
};

const baseTemplateFixture: SystemTemplateFixture = {
  id: 'tpl-service',
  templateKey: 'SERVICE_INFO',
  name: '서비스 안내',
  description: '서비스 안내 메시지',
  content: '서비스 안내드립니다 {{name}}님',
  requiredVariables: [{ key: 'name', label: '이름', type: 'string', required: true }],
  customVariables: [],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
};

const phoneVariable: CustomVariableFixture = {
  key: 'phone',
  label: '연락처',
  required: true,
};

const templateWithPhoneVariable: SystemTemplateFixture = {
  ...baseTemplateFixture,
  customVariables: [phoneVariable],
};

const templateWithPhoneContent: SystemTemplateFixture = {
  ...templateWithPhoneVariable,
  content: '서비스 안내드립니다 {{name}}님 연락처 {{phone}}',
};

async function mockMessagesApproval(page: Page): Promise<void> {
  await page.route('**/api/settings/message-sender-approval', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        approvalStatus: 'approved',
        isApproved: true,
        canRequest: true,
        senderPhone: '01012345678',
        senderPhoneFormatted: '010-1234-5678',
      }),
    });
  });
}

async function mockComposeDependencies(
  page: Page,
  template: SystemTemplateFixture = baseTemplateFixture,
): Promise<void> {
  await mockMessagesApproval(page);

  await page.route('**/api/system-templates/*', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    const key = request.url().split('/').pop() ?? 'UNKNOWN';
    const response =
      key === 'SERVICE_INFO'
        ? template
        : {
            id: `tpl-${key.toLowerCase()}`,
            templateKey: key,
            name: key,
            description: `${key} template`,
            content: `${key} 본문`,
            requiredVariables: [],
            customVariables: [],
            updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/message-templates', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/bank-account-infos', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

test.describe('Custom Template Variables', () => {
  test('shows custom variable inputs on the current compose route', async ({ page }) => {
    await mockComposeDependencies(page, templateWithPhoneVariable);

    await page.goto('/messages/new?template=SERVICE_INFO');
    await expect(page.locator('form[data-form="messages-new-form"]')).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByLabel(/산모님 성함/)).toBeVisible();
    await expect(page.getByLabel('연락처')).toBeVisible();
    await expect(
      page.locator('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_row"][data-template-variable-key="phone"]'),
    ).toBeVisible();
  });

  test('updates the composed body with custom variable values', async ({ page }) => {
    await mockComposeDependencies(page, templateWithPhoneContent);

    await page.goto('/messages/new?template=SERVICE_INFO');
    await expect(page.locator('form[data-form="messages-new-form"]')).toBeVisible({
      timeout: 15000,
    });

    await page.getByLabel(/산모님 성함/).fill('김철수');
    await page.getByLabel('연락처').fill('010-2222-3333');

    await expect(page.getByLabel('메시지 본문')).toHaveValue(/김철수/);
    await expect(page.getByLabel('메시지 본문')).toHaveValue(/010-2222-3333/);
  });
});
