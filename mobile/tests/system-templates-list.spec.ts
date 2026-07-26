import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const templatesFixture = [
  {
    id: 'tpl-price',
    templateKey: 'PRICE_INFO',
    name: '비용 안내',
    description: '바우처 비용 안내 메시지',
    content: '비용 안내 메시지: {{name}}',
    requiredVariables: [{ key: 'name', label: '이름', type: 'string', required: true }],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-greeting',
    templateKey: 'GREETING',
    name: '인사(소개)',
    description: '첫 인사 메시지',
    content: '안녕하세요!',
    requiredVariables: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
] as const;

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

function mockSystemTemplatesApi(page: Page): Promise<void> {
  return page.route('**/api/system-templates', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templatesFixture),
    });
  });
}

test.describe('Templates List', () => {
  test('shows the current sectioned mobile template list', async ({ page }) => {
    await mockMessagesApproval(page);
    await mockSystemTemplatesApi(page);
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

    await page.goto('/messages/templates');
    await expect(page.getByText('템플릿 관리')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-component="mobile_messages_templates_page_content_list-card_search"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /전체\s*2/ })).toBeVisible();
    await expect(page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_header"]').first()).toContainText(
      '기본 템플릿',
    );
    await expect(page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_row"]')).toHaveCount(2);
    // The row-name node also contains the channel badge ("알림톡"), so an
    // exact-text match can never resolve — scope to the name node instead.
    await expect(
      page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_row_info_name"]').filter({ hasText: '비용 안내' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_row_info_name"]').filter({ hasText: '인사(소개)' }),
    ).toBeVisible();
  });

  test('does not render mock templates or fake send counts when APIs are empty', async ({ page }) => {
    await mockMessagesApproval(page);
    await page.route('**/api/system-templates', async (route: Route, request: Request) => {
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

    await page.goto('/messages/templates');

    await expect(page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_empty"]')).toHaveText(
      '등록된 템플릿이 없습니다.',
    );
    await expect(page.locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_row"]')).toHaveCount(0);
    await expect(page.getByText(/5월 \d+건 발송/)).toHaveCount(0);
  });

  test('navigates to the current system template detail page on click', async ({ page }) => {
    await mockMessagesApproval(page);
    await mockSystemTemplatesApi(page);
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
    await page.route('**/api/system-templates/PRICE_INFO', async (route: Route, request: Request) => {
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(templatesFixture[0]),
      });
    });

    await page.goto('/messages/templates');
    await expect(page.getByText('템플릿 관리')).toBeVisible({ timeout: 15000 });

    await page
      .locator('[data-component="mobile_messages_templates_page_content_list-card_body_section_row"]')
      .filter({ hasText: '비용 안내' })
      .click();

    await expect(page).toHaveURL(/\/messages\/system-templates\/PRICE_INFO/);
    await expect(page.locator('[data-component="messages-system-template-detail"]')).toBeVisible();
    await expect(page.locator('[data-component="messages-system-template-detail"]')).toContainText('비용 안내');
  });
});
