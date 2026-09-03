import { test, expect, type Page, type Route } from '@playwright/test';

interface MockAuthUser {
  id: string;
  name: string;
  email: string;
  profile_image: string;
  role: string;
}

// Mock for admin user
const MOCK_ADMIN_USER = {
  id: 'admin-user',
  name: '관리자',
  email: 'admin@example.com',
  profile_image: '',
  role: 'admin',
};

// Mock feedback data
const MOCK_FEEDBACK_LIST = {
  data: [
    {
      id: 'feedback-1',
      type: 'positive',
      comment: null,
      createdAt: '2024-01-15T10:00:00.000Z',
      user: { id: 'user-1', name: '홍길동', email: 'hong@example.com' },
      message: { id: 'msg-1', content: '답변 내용입니다', role: 'assistant', timestamp: '2024-01-15T09:59:00.000Z' },
    },
    {
      id: 'feedback-2',
      type: 'negative',
      comment: '답변이 부정확합니다',
      createdAt: '2024-01-15T11:00:00.000Z',
      user: { id: 'user-2', name: '김철수', email: 'kim@example.com' },
      message: { id: 'msg-2', content: '다른 답변입니다', role: 'assistant', timestamp: '2024-01-15T10:59:00.000Z' },
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const MOCK_FEEDBACK_STATS = {
  positive: 10,
  negative: 5,
  total: 15,
};

// Helper to setup auth mocks
const setupAuthMocks = async (page: Page, user: MockAuthUser) => {
  await page.addInitScript(() => {
    (window as typeof window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });
  
  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
  });
  
  await page.route('**/auth/me', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
  });
};

test.describe('Admin Feedback Page', () => {
  test('admin user can access /admin page', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    // Should see the feedback list
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('홍길동')).toBeVisible();
  });

  test('filter tabs work correctly', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    let lastUrl = '';
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      lastUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    // Click negative filter
    // The old shape — click, sleep 500ms, read the URL — fails two independent ways.
    // A click that lands before React attaches its handler is swallowed with no
    // error, and even a click that lands is not guaranteed to have issued its
    // request inside a fixed 500ms on a three-worker CI runner. Retry the click
    // until the request the filter is supposed to send has actually gone out;
    // `lastUrl` is the record of that, so it is both the retry condition and the
    // assertion. The guard stops re-clicking once it has fired.
    await expect(async () => {
      if (!lastUrl.includes('type=negative')) {
        await page.getByRole('button', { name: '부정적' }).click();
      }
      expect(lastUrl).toContain('type=negative');
    }).toPass({ timeout: 15_000 });
  });

  test('displays feedback stats correctly', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    await expect(page.getByText('전체').first()).toBeVisible();
    await expect(page.getByText('긍정적').first()).toBeVisible();
    await expect(page.getByText('부정적').first()).toBeVisible();
    
    // Stats render via the v3 StatsBar/StatMini cards now.
    // Scope to the StatMini roots — the `_icon` child also matches the prefix.
    const statsCards = page.locator(
      '[data-component^="mobile_admin_feedback_stats_stat-mini-"][data-slot="stat-mini"]'
    );
    await expect(statsCards.nth(0)).toContainText('15');
    await expect(statsCards.nth(1)).toContainText('10');
    await expect(statsCards.nth(2)).toContainText('5');
  });

  test('displays feedback list with correct data', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    // The redesigned list renders icon + name + truncated comment + date per
    // row (no table headers anymore).
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('답변이 부정확합니다')).toBeVisible();
  });

  test('shows empty state when no feedback exists', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ positive: 0, negative: 0, total: 0 }) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    await expect(page.getByText('피드백이 없습니다')).toBeVisible();
  });

  test('positive filter shows only positive feedback', async ({ page }) => {
    await setupAuthMocks(page, MOCK_ADMIN_USER);
    
    let lastUrl = '';
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      lastUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    // Click positive filter
    // The old shape — click, sleep 500ms, read the URL — fails two independent ways.
    // A click that lands before React attaches its handler is swallowed with no
    // error, and even a click that lands is not guaranteed to have issued its
    // request inside a fixed 500ms on a three-worker CI runner. Retry the click
    // until the request the filter is supposed to send has actually gone out;
    // `lastUrl` is the record of that, so it is both the retry condition and the
    // assertion. The guard stops re-clicking once it has fired.
    await expect(async () => {
      if (!lastUrl.includes('type=positive')) {
        await page.getByRole('button', { name: '긍정적' }).click();
      }
      expect(lastUrl).toContain('type=positive');
    }).toPass({ timeout: 15_000 });
  });

  test('owner user can access /admin page', async ({ page }) => {
    const MOCK_OWNER_USER = { ...MOCK_ADMIN_USER, role: 'owner' };
    await setupAuthMocks(page, MOCK_OWNER_USER);
    
    await page.route('**/api/admin/feedback/stats', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_STATS) });
    });
    
    await page.route('**/api/admin/feedback?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FEEDBACK_LIST) });
    });
    
    await page.goto('/admin');
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 15000 });
    
    // Should see the feedback list
    await expect(page.getByText('피드백 목록')).toBeVisible({ timeout: 5000 });
  });
});
