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

  await page.route('**/api/message-trigger-rules', async (route: Route, request: Request) => {
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
}

test.describe('System Template Detail Secondary Actions', () => {
  test('surfaces the desktop-only rollback guidance and links to trigger settings', async ({
    page,
  }) => {
    await mockMessagesApproval(page);
    await mockTemplateApi(page);

    await page.goto('/messages/system-templates/THANKS');
    await expect(page.locator('[data-component="messages-system-template-detail"]')).toBeVisible({
      timeout: 15000,
    });

    await expect(
      page.getByText('시스템 템플릿 본문 편집·버전 롤백은 데스크톱에서만 가능합니다.'),
    ).toBeVisible();

    await page.locator('[data-component="mobile_messages_system-templates_template-key-detail_detail-panel_trigger-link"]').click();

    await expect(page).toHaveURL('/messages/automation');
    await expect(page.locator('[data-slot="messages-page"]')).toBeVisible({ timeout: 15000 });
  });
});
