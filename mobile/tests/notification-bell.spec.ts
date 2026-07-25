import { test, expect } from '@playwright/test';

const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    title: '테스트 알림 1',
    body: '첫 번째 테스트 알림',
    data: { url: '/clients/1' },
    sentAt: new Date().toISOString(),
    readAt: null,
    isRead: false,
  },
  {
    id: 2,
    title: '테스트 알림 2',
    body: '두 번째 테스트 알림',
    data: { url: '/employees/2' },
    sentAt: new Date().toISOString(),
    readAt: null,
    isRead: false,
  },
  {
    id: 3,
    title: '읽은 알림',
    body: '이미 읽은 알림',
    data: { url: '/messages' },
    sentAt: new Date().toISOString(),
    readAt: new Date().toISOString(),
    isRead: true,
  },
];

const INITIAL_UNREAD_COUNT = 2;

const ensureNotificationBell = async (page) => {
  const bell = page.locator('[data-testid="notification-bell"]');
  await expect(bell).toBeVisible({ timeout: 15000 });
  return bell;
};

test.describe('Notification Bell Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;

      class MockNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
      }

      class MockPushManager {}

      const windowWithNotifications = window as unknown as {
        Notification: typeof MockNotification;
        PushManager: typeof MockPushManager;
      };

      windowWithNotifications.Notification = MockNotification;
      windowWithNotifications.PushManager = MockPushManager;

      const mockSubscription = {
        endpoint: 'https://example.com/push',
        getKey: () => new Uint8Array([1, 2, 3]),
      };

      const mockRegistration = {
        pushManager: {
          getSubscription: async () => mockSubscription,
        },
      };

      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          ready: Promise.resolve(mockRegistration),
          register: async () => mockRegistration,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
        configurable: true,
      });
    });


    const mockAuthResponse = {
      id: 'test-user',
      name: '테스트 사용자',
      email: 'test@example.com',
      profile_image: '',
      role: 'admin',
    };

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAuthResponse),
      });
    });

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAuthResponse),
      });
    });

    await page.route('**/api/notifications?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_NOTIFICATIONS),
      });
    });

    await page.route('**/api/notifications/vapid-key', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ publicKey: 'test-vapid-key' }),
      });
    });

    let currentUnreadCount = INITIAL_UNREAD_COUNT;
    await page.route('**/api/notifications/unread/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: currentUnreadCount }),
      });
    });

    await page.route('**/api/notifications/*/read', async (route) => {
      currentUnreadCount = Math.max(0, currentUnreadCount - 1);
      const notificationId = Number(route.request().url().split('/').slice(-2, -1)[0]);
      const notification =
        MOCK_NOTIFICATIONS.find((item) => item.id === notificationId) ?? MOCK_NOTIFICATIONS[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...notification,
          isRead: true,
          readAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/clients');
    await ensureNotificationBell(page);

    const e2eFlag = await page.evaluate(() => (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__);
    if (!e2eFlag) {
      await page.evaluate(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
      });
      await page.reload();
      await ensureNotificationBell(page);
    }
  });

  test('clicking notification should navigate without showing splash screen', async ({ page }) => {
    await expect(page).toHaveURL(/\/clients/);

    const bell = await ensureNotificationBell(page);

    await bell.click();
    await expect(page.locator('[data-testid="notification-popover"]')).toBeVisible();

    await page.locator('[data-testid="notification-item-unread"]').first().click();

    await page.waitForURL(/\/(clients|employees|messages)/);

    await expect(page.locator('img[alt="Splash"]')).not.toBeVisible();
    await expect(page).toHaveURL('/clients/1');
  });

  test('badge count should update after clicking unread notification', async ({ page }) => {
    const bell = await ensureNotificationBell(page);

    const badge = page.locator('[data-testid="notification-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');

    await bell.click();
    await expect(page.locator('[data-testid="notification-popover"]')).toBeVisible();

    await page.locator('[data-testid="notification-item-unread"]').first().click();

    await page.waitForURL(/\/clients\/1/);

    await page.goBack();
    await ensureNotificationBell(page);

    await expect(badge).toHaveText('1');
  });

  test('popover should close immediately when notification is clicked', async ({ page }) => {
    const bell = await ensureNotificationBell(page);

    await bell.click();

    const popover = page.locator('[data-testid="notification-popover"]');
    await expect(popover).toBeVisible();

    await page.locator('[data-testid="notification-item-unread"]').first().click();

    await expect(popover).not.toBeVisible({ timeout: 2000 });
    await expect(page).toHaveURL('/clients/1');
  });


  // 'splash screen on PWA launch' test removed: no in-DOM splash exists in src
  // (only iOS apple-touch-startup-image meta links, which never render in Chromium).

});
