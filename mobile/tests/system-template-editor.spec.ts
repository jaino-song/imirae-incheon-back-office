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

async function mockTemplateApi(page: Page): Promise<void> {
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
}

test.describe('System Template Detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockMessagesApproval(page);
    await mockTemplateApi(page);
    await page.goto('/messages/system-templates/THANKS');
    await expect(page.locator('[data-component="messages-system-template-detail"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test('displays the current read-only template content and required variables', async ({ page }) => {
    await expect(page.getByText('감사', { exact: true })).toBeVisible();
    await expect(page.getByText('감사 메시지')).toBeVisible();
    await expect(page.locator('[data-component="messages-system-template-content"]')).toContainText(
      templateFixture.content,
    );
    await expect(page.getByText('필수 변수')).toBeVisible();
    await expect(page.getByText('이름')).toBeVisible();
  });

  test('shows the current mobile-only guidance instead of the old editor UI', async ({ page }) => {
    await expect(page.getByRole('button', { name: '상세 닫기' })).toBeVisible();
    await expect(page.getByRole('button', { name: '이 템플릿으로 보내기' })).toBeVisible();
    await expect(
      page.getByText('시스템 템플릿 본문 편집·버전 롤백은 데스크톱에서만 가능합니다.'),
    ).toBeVisible();
  });
});
