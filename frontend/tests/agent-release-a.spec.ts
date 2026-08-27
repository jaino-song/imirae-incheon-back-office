import { test, expect, type Page, type Route } from "@playwright/test";
import type { AgentCapabilityMeta } from "@babyjamjam/shared/agent";

const shellEnabled = ["1", "true"].includes((process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED ?? "").toLowerCase());
const runAgentE2E = process.env.RUN_AGENT_E2E === "1";
const runAgentRealE2E = process.env.RUN_AGENT_REAL_E2E === "1";

const authResponse = {
    id: "test-user",
    name: "테스트 사용자",
    email: "test@example.com",
    profile_image: "",
    role: "admin",
};

const releaseACapability = {
    name: "clients.search",
    domain: "clients",
    version: "1.0.0",
    description: "Search clients in the current branch by name or identifier",
    risk: "read",
    requiredRoles: ["owner", "admin", "manager", "user"],
    renderer: "entity-choice",
    flagKey: "agent.capability.clients.search",
    sideEffect: false,
} satisfies AgentCapabilityMeta;

async function setupRoutes(page: Page) {
    let sessionDeleted = false;
    let entityFollowupSent = false;
    let streamedMessageCount = 0;
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authResponse) }));
    await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authResponse) }));
    await page.route("**/api/ai/chat/history**", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [], total: 0, hasMore: false, sessionId: null, isSessionActive: false }),
    }));
    await page.route("**/api/ai/agent/capabilities", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(shellEnabled ? [releaseACapability] : []),
    }));
    await page.route("**/api/ai/agent/sessions", async (route: Route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessionDeleted ? [] : [{ id: "session-a", title: "홍길동 조회", updatedAt: "2026-08-03T00:00:00.000Z" }]) });
            return;
        }
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "session-b" }) });
    });
    await page.route("**/api/ai/agent/sessions/session-a", async (route: Route) => {
        if (route.request().method() === "GET") {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "session-a", title: "홍길동 조회", messages: [{ id: "assistant-a", role: "assistant", parts: [{ type: "text", text: "복원된 조회" }] }] }) });
            return;
        }
        sessionDeleted = true;
        await route.fulfill({ status: 204, body: "" });
    });
    await page.route("**/api/ai/agent/chat", async (route: Route) => {
        streamedMessageCount += 1;
        const messageId = `assistant-stream-${streamedMessageCount}`;
        const postData = route.request().postData() ?? "";
        if (postData.includes("선택한 엔티티 ID")) entityFollowupSent = true;
        if (postData.includes("중지 테스트")) {
            try {
                await new Promise((resolve) => setTimeout(resolve, 5_000));
                await route.fulfill({
                    status: 200,
                    headers: { "content-type": "text/event-stream", "x-agent-session-id": "session-a" },
                    body: 'data: {"type":"start","messageId":"assistant-stopped"}\n\n',
                });
            } catch {
                // The browser aborts this intentionally when the user presses Stop.
            }
            return;
        }
        await route.fulfill({
            status: 200,
            headers: { "content-type": "text/event-stream", "x-agent-session-id": "session-a" },
            body: [
                `data: {"type":"start","messageId":"${messageId}"}`,
                'data: {"type":"data-entity-choice","data":{"entityType":"clients","prompt":"어느 산모를 말씀하시는지 선택해 주세요.","choices":[{"id":"10","label":"홍길동 1"},{"id":"11","label":"홍길동 2"}]}}',
                'data: {"type":"text-start","id":"text-1"}',
                'data: {"type":"text-delta","id":"text-1","delta":"조회 결과입니다."}',
                'data: {"type":"text-end","id":"text-1"}',
                'data: {"type":"finish","finishReason":"stop"}',
                "",
            ].join("\n\n"),
        });
    });

    return {
        entityFollowupSent: () => entityFollowupSent,
    };
}

test.describe("Release A flag coexistence", () => {
    test("renders the selected shell, streams a response, and supports branch/session controls", async ({ page }) => {
        test.skip(!runAgentE2E || runAgentRealE2E, "Run with RUN_AGENT_E2E=1 against the authenticated Playwright environment");
        const routes = await setupRoutes(page);
        await page.goto("/chat");

        if (!shellEnabled) {
            await expect(page.getByText("AI 어시스턴트")).toBeVisible();
            await expect(page.getByText("고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.")).toBeVisible();
            return;
        }

        await expect(page.getByText("AI 운영 코파일럿")).toBeVisible();
        await expect(page.getByText("홍길동 조회")).toBeVisible();

        const input = page.getByLabel("질문 입력");
        await input.fill("홍길동 산모 찾아줘");
        await input.press("Enter");
        await expect(page.getByText("조회 결과입니다.")).toBeVisible();
        await expect(page.getByRole("button", { name: "홍길동 1" })).toBeVisible();
        await page.getByRole("button", { name: "홍길동 1" }).click();
        await expect.poll(routes.entityFollowupSent).toBe(true);

        await page.getByRole("button", { name: "홍길동 조회", exact: true }).click();
        await expect(page.getByText("복원된 조회")).toBeVisible();
        await expect(page.getByRole("button", { name: "지점 바꾸기" })).toBeVisible();

        await page.getByRole("button", { name: "홍길동 조회 삭제" }).click();
        await expect(page.getByText("홍길동 조회")).toHaveCount(0);
        await page.getByRole("button", { name: "지점 바꾸기" }).click();
        await expect(page).toHaveURL(/\/select-branch$/);

        await page.goto("/chat");
        const restoredInput = page.getByLabel("질문 입력");
        await expect(restoredInput).toHaveValue("");

        await restoredInput.fill("중지 테스트");
        await restoredInput.press("Enter");
        await expect(page.getByRole("button", { name: "중지" })).toBeVisible();
        await page.getByRole("button", { name: "중지" }).click();
        await expect(page.getByRole("button", { name: "전송" })).toBeVisible();

        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByLabel("질문 입력")).toBeVisible();
        const sidebar = page.locator('[data-component="desktop_chat_agent-shell_sidebar"]');
        await expect(sidebar).toHaveAttribute("aria-hidden", "true");
        await expect(page.getByRole("button", { name: "전송" })).toHaveAccessibleName("전송");
        await page.getByRole("button", { name: "사이드바 열기" }).click();
        await expect(sidebar).toHaveAttribute("aria-hidden", "false");
        await page.getByRole("button", { name: "사이드바 닫기" }).click();
    });

    test("uses the real Release A backend stream", async ({ page }) => {
        test.skip(!runAgentRealE2E, "Run with RUN_AGENT_REAL_E2E=1 against the real backend");
        await page.goto("/chat");
        await expect(page.getByText("AI 운영 코파일럿")).toBeVisible();

        const input = page.getByLabel("질문 입력");
        await input.fill("홍길동 산모 찾아줘");
        await input.press("Enter");
        await expect(page.getByText("[agent-e2e-stub] 조회 결과를 확인했습니다.")).toBeVisible();
        await expect(page.getByRole("button", { name: "중지" })).not.toBeVisible();
    });
});
