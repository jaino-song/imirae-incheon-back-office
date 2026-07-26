import { test, expect, type Page, type Route } from '@playwright/test';

const MOCK_AUTH_RESPONSE = {
  id: 'test-user',
  name: '테스트 사용자',
  email: 'test@example.com',
  profile_image: '',
  role: 'admin',
};

const setupAuthMocks = async (page: Page) => {
  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });

  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUTH_RESPONSE),
    });
  });
};

test.describe('Chat client registration wizard', () => {
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

    await page.route('**/api/ai/chat/persist', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route('**/api/voucher-price-infos/years', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([2026]),
      });
    });

    await page.route('**/api/voucher-price-infos/type**', async (route) => {
      const url = new URL(route.request().url());
      const type = url.searchParams.get('type');
      const year = url.searchParams.get('year');

      if (type === 'A가1형' && year === '2026') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 1,
              type: 'A가1형',
              duration: '10',
              fullPrice: '100000',
              grant: '50000',
              actualPrice: '50000',
            },
          ]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('opens wizard via 산모 등록 message and submits to /api/clients without SSE', async ({ page }) => {
    let sseCalled = 0;
    await page.route('**/api/ai/chat/stream', async (route) => {
      sseCalled += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'SSE should not be called for local wizard' }),
      });
    });

    let createCalled = 0;
    await page.route('**/api/clients', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }

      createCalled += 1;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        name: '홍길동',
        phone: '010-1234-5678',
        birthday: '900101',
        address: '인천 연수구',
        dueDate: '2026-02-01',
        voucherClient: true,
        type: 'A가1형',
        duration: 10,
        fullPrice: '100000',
        grant: '50000',
        actualPrice: '50000',
      });

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 123, name: '홍길동' }),
      });
    });

    await page.goto('/chat');

    // The wizard is triggered by sending the literal "산모 등록" message —
    // useChatStream intercepts it locally and renders the wizard inline
    // without calling the SSE endpoint.
    const chatInput = page.locator('[data-component="mobile_chat_page_input-area_input"]');
    await expect(chatInput).toBeVisible({ timeout: 15000 });
    await chatInput.fill('산모 등록');
    await chatInput.press('Enter');

    await expect(page.getByLabel('이름')).toBeVisible({ timeout: 5000 });

    await page.getByLabel('이름').fill('홍길동');
    await page.getByLabel('연락처').fill('01012345678');
    await page.getByLabel('생년월일').fill('900101');
    await page.getByLabel('주소').fill('인천 연수구');
    await page.getByLabel('출산 예정일').fill('2026-02-01');
    await page.getByRole('button', { name: '다음' }).click();

    // Voucher info step: pick type + duration
    await page.getByLabel('바우처 유형').click();
    await page.locator('[role="option"]').filter({ hasText: 'A가-1형' }).first().click();

    await page.getByLabel('기간').click();
    await page.locator('[role="option"]').filter({ hasText: '10일' }).first().click();

    await page.getByRole('button', { name: '다음' }).click();

    await page.getByRole('checkbox', { name: '조리원 여부' }).check();
    await page.getByRole('button', { name: '제출' }).click();

    await expect(page.getByText('산모 등록 완료: 홍길동 (ID: 123)')).toBeVisible({ timeout: 5000 });
    expect(createCalled).toBe(1);
    expect(sseCalled).toBe(0);
  });
});
