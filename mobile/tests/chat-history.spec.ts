import { test, expect, type Page } from '@playwright/test';

// The dashboard chat widget was removed in the mobile redesign (ChatWidget is
// unmounted); chat lives at /chat. These specs drive the page directly.

const MOCK_CHAT_MESSAGES = [
    { role: 'user', content: '안녕하세요', timestamp: '2026-01-19T10:00:00.000Z' },
    { role: 'assistant', content: '안녕하세요! 무엇을 도와드릴까요?', timestamp: '2026-01-19T10:00:01.000Z' },
    { role: 'user', content: '고객 목록 보여줘', timestamp: '2026-01-19T10:01:00.000Z' },
    { role: 'assistant', content: '고객 목록을 조회합니다...', timestamp: '2026-01-19T10:01:01.000Z' },
];

const MOCK_AUTH_RESPONSE = {
    id: 'test-user',
    name: '테스트 사용자',
    email: 'test@example.com',
    profile_image: '',
    role: 'admin',
};

const CHAT_INPUT = '[data-component="mobile_chat_page_input-area_input"]';
const CHAT_MESSAGES = '[data-component="mobile_chat_page_content_messages"]';
const ANY_BUBBLE = '[data-component="mobile_chat_page_content_messages_message-user"], [data-component="mobile_chat_page_content_messages_message-assistant"]';

const setupAuthMocks = async (page: Page) => {
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
    });

    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_AUTH_RESPONSE),
        });
    });

    await page.route('**/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_AUTH_RESPONSE),
        });
    });
};

const setupChatSideEffectMocks = async (page: Page) => {
    await page.route('**/api/ai/chat/persist', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
        });
    });

    await page.route('**/api/ai/chat/sessions/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
        });
    });
};

test.describe('Chat History Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuthMocks(page);
        await setupChatSideEffectMocks(page);

        await page.route('**/api/ai/chat/history**', async (route) => {
            const url = new URL(route.request().url());
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const limit = parseInt(url.searchParams.get('limit') || '20');

            const total = MOCK_CHAT_MESSAGES.length;
            const endIndex = total - offset;
            const startIndex = Math.max(0, endIndex - limit);
            const messages = MOCK_CHAT_MESSAGES.slice(startIndex, endIndex);
            const hasMore = startIndex > 0;

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    messages,
                    total,
                    hasMore,
                    sessionId: 'test-session-id',
                    isSessionActive: true,
                }),
            });
        });

        await page.route('**/api/ai/chat/stream', async (route) => {
            const chunks = [
                'event: message\ndata: {"type":"chunk","content":"테스트 "}\n\n',
                'event: message\ndata: {"type":"chunk","content":"응답입니다."}\n\n',
                'event: message\ndata: {"type":"done","sessionId":"test-session-id"}\n\n',
            ];

            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
                body: chunks.join(''),
            });
        });
    });

    test('loads persisted history on /chat', async ({ page }) => {
        await page.goto('/chat');

        await expect(page.locator(CHAT_MESSAGES)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('무엇을 도와드릴까요?').first()).toBeVisible();
        await expect(page.getByText('고객 목록 보여줘')).toBeVisible();
    });

    test('shows an empty conversation when no history exists', async ({ page }) => {
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

        await page.goto('/chat');

        await expect(page.locator(CHAT_MESSAGES)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(ANY_BUBBLE)).toHaveCount(0);
        await expect(page.locator(CHAT_INPUT)).toBeEnabled();
    });

    test('sends a message and renders the streamed response', async ({ page }) => {
        await page.goto('/chat');

        const chatInput = page.locator(CHAT_INPUT);
        await expect(chatInput).toBeVisible({ timeout: 15000 });

        await chatInput.fill('새로운 메시지');
        await chatInput.press('Enter');

        await expect(page.getByText('새로운 메시지')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('테스트 응답입니다.')).toBeVisible({ timeout: 10000 });
    });

    test('reload restores the persisted conversation', async ({ page }) => {
        await page.goto('/chat');
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 15000 });

        await page.reload();

        await expect(page.locator(CHAT_MESSAGES)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('고객 목록 보여줘')).toBeVisible();
    });

    test('page stays interactive while history is still loading', async ({ page }) => {
        let resolveHistory: () => void;
        const historyPromise = new Promise<void>((resolve) => {
            resolveHistory = resolve;
        });

        await page.route('**/api/ai/chat/history**', async (route) => {
            await historyPromise;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    messages: MOCK_CHAT_MESSAGES,
                    total: MOCK_CHAT_MESSAGES.length,
                    hasMore: false,
                    sessionId: 'test-session-id',
                    isSessionActive: true,
                }),
            });
        });

        await page.goto('/chat');

        // History fetch is non-blocking: composer must render before it lands.
        await expect(page.locator(CHAT_INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(ANY_BUBBLE)).toHaveCount(0);

        resolveHistory!();

        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 5000 });
    });

    test('새 대화 clears the current session', async ({ page }) => {
        await page.goto('/chat');
        await expect(page.getByText('안녕하세요').first()).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: '새 대화' }).click();

        await expect(page.locator(ANY_BUBBLE)).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator(CHAT_INPUT)).toBeEnabled();
    });
});

test.describe('Chat History API Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuthMocks(page);
        await setupChatSideEffectMocks(page);
    });

    test('handles a history 500 without crashing the page', async ({ page }) => {
        await page.route('**/api/ai/chat/history**', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        });

        await page.goto('/chat');

        await expect(page.locator(CHAT_INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(CHAT_MESSAGES)).toBeVisible();
    });

    test('handles a history 401 without crashing the page', async ({ page }) => {
        await page.route('**/api/ai/chat/history**', async (route) => {
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Unauthorized' }),
            });
        });

        await page.goto('/chat');

        await expect(page.locator(CHAT_INPUT)).toBeVisible({ timeout: 15000 });
        await expect(page.locator(CHAT_MESSAGES)).toBeVisible();
    });
});
