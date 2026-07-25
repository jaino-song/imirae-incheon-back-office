import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const templateFixture = {
  id: 'tpl-thanks',
  templateKey: 'THANKS',
  name: '감사',
  description: '감사 메시지',
  content: '감사합니다 {{name}}님',
  requiredVariables: [{ key: 'name', label: '이름', type: 'string', required: true }],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
} as const;

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

async function mockTemplateRoutes(page: Page): Promise<void> {
  await page.route('**/api/system-templates/THANKS', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templateFixture),
    });
  });

  await page.route('**/api/system-templates/*', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    const key = request.url().split('/').pop() ?? 'UNKNOWN';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `tpl-${key.toLowerCase()}`,
        templateKey: key,
        name: key,
        description: `${key} template`,
        content: key === 'THANKS' ? templateFixture.content : `${key} 내용`,
        requiredVariables: [],
        updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      }),
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

test.describe('System Template Send CTA', () => {
  test('navigates to the compose page with the template body prefilled', async ({ page }) => {
    await mockMessagesApproval(page);
    await mockTemplateRoutes(page);

    await page.goto('/messages/system-templates/THANKS');
    await expect(page.locator('[data-component="messages-system-template-detail"]')).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: '이 템플릿으로 보내기' }).click();

    await expect(page).toHaveURL(/\/messages\/new\?body=/);
    await expect(page.locator('form[data-form="messages-new-form"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByLabel('메시지 본문')).toHaveValue(templateFixture.content);
  });
});
