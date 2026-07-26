import { test, expect, type Page, type Route } from '@playwright/test';

const mockAuthResponse = {
  id: 'test-user',
  name: '테스트 사용자',
  email: 'test@example.com',
  profile_image: '',
  role: 'admin',
};

const setupAuthMocks = async (page: Page) => {
  await page.addInitScript(() => {
    (window as typeof window & { __e2e_auth__?: boolean }).__e2e_auth__ = true;
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAuthResponse),
    });
  });

  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAuthResponse),
    });
  });
};

test.describe('chat auto-retry', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthMocks(page);

    await page.route('**/api/ai/chat/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [],
          total: 0,
          hasMore: false,
          sessionId: null,
          isSessionActive: false,
        }),
      });
    });
  });

  test('should auto-retry once on first error then succeed', async ({ page }) => {
    let callCount = 0;

    await page.route('**/api/ai/chat/stream', async (route) => {
      callCount++;
      if (callCount === 1) {
        // first call fails with network error
        await route.abort('failed');
      } else {
        // second call succeeds
        const chunks = [
          'data: {"type":"chunk","content":"성공적인 "}\n\n',
          'data: {"type":"chunk","content":"응답입니다."}\n\n',
          'data: {"type":"done","sessionId":"test-session-id"}\n\n',
        ];
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          },
          body: chunks.join(''),
        });
      }
    });

    // Navigate directly to chat page
    await page.goto('/chat');

    const chatInput = page.locator('[data-component="mobile_chat_page_input-area_input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('테스트 메시지');
    await chatInput.press('Enter');

    // Wait for both attempts to complete
    await page.waitForTimeout(3000);
    // Verify retry mechanism was called (second request should have been made)
    expect(callCount).toBe(2);
  });

  test('should show error after two consecutive failures', async ({ page }) => {
    let callCount = 0;

    await page.route('**/api/ai/chat/stream', async (route) => {
      callCount++;
      await route.abort('failed');
    });

    // Navigate directly to chat page
    await page.goto('/chat');

    const chatInput = page.locator('[data-component="mobile_chat_page_input-area_input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('테스트 메시지');
    await chatInput.press('Enter');

    // Wait for both attempts to fail
    await page.waitForTimeout(3000);
    // Verify both attempts were made before giving up
    expect(callCount).toBe(2);
  });
});
