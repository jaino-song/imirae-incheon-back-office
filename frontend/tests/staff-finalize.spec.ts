import { test, expect, Page } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  const appUrl = baseURL ?? "http://localhost:3000";
  await page.context().addCookies([
    {
      name: "e2e_auth",
      value: "1",
      url: appUrl,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
    sessionStorage.clear();
  });
});

const REVIEW_DOC_ID = "doc-finalize-test";
const REVIEW_DOC = {
  id: REVIEW_DOC_ID,
  document_number: "DOC-FT",
  template: { id: "tpl-test", name: "남동구 계약서" },
  document_name: "산모신생아건강관리서비스 계약서",
  creator: { recipient_type: "sender", id: "admin", name: "Admin" },
  created_date: Date.now() - 60_000,
  last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
  updated_date: Date.now() - 30_000,
  current_status: {
    status_type: "060",
    step_index: "3",
    step_type: "05",
    step_recipients: [{ recipient_type: "01", name: "Staff" }],
    expired_date: Date.now() + 7 * 86400000,
  },
  recipients: [
    { recipient_type: "02", name: "송테스트" },
  ],
  fields: [
    { id: "계약 종료 년도", value: "2026" },
    { id: "계약 종료 월", value: "06" },
    { id: "계약 종료 일", value: "03" },
  ],
};

const MOCK_DOCUMENT_LIST = {
  documents: [REVIEW_DOC],
  total_rows: 1,
  limit: 20,
  skip: 0,
};

const MOCK_SDK_OPTIONS = {
  company: { id: "company-id", country_code: "kr", user_key: "staff@example.com" },
  layout: { lang_code: "ko", zoom: "0.75" },
  user: { type: "01", id: "staff@example.com", access_token: "fake-token", refresh_token: "fake-refresh" },
  mode: { type: "02", template_id: "tpl-test", document_id: REVIEW_DOC_ID },
  prefill: {
    fields: [
      { id: "계약 종료 년도", value: "2026", enabled: true, required: false },
      { id: "계약 종료 월", value: "07", enabled: true, required: false },
      { id: "계약 종료 일", value: "15", enabled: true, required: false },
    ],
  },
};

async function installCommonRoutes(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/clients/alerts") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.pathname === "/api/consultation-inquiries") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          total: 0,
          page: 1,
          limit: Number(url.searchParams.get("limit") ?? "1"),
          totalPages: 0,
        }),
      });
    }

    if (url.pathname === "/api/notifications/vapid-key") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ publicKey: "test-public-key" }),
      });
    }

    if (url.pathname === "/api/notifications/unread/count") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
    }

    if (url.pathname === "/api/notifications") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.pathname === "/api/eformsign/webhook/stream") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ":ok\n\n" });
    }

    return route.fallback();
  });

  await page.route("**/api/eformsign/auth-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true }) })
  );
  await page.route("**/api/eformsign/documents**", (route) => {
    if (route.request().url().includes(REVIEW_DOC_ID)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REVIEW_DOC) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_DOCUMENT_LIST) });
  });
  await page.route("**/api/eformsign-docs/document-id**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clientId: 1, documentId: REVIEW_DOC_ID }) })
  );
  await page.route("**/api/eformsign-docs/client-names", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ documentId: REVIEW_DOC_ID, clientName: "송테스트" }]) })
  );
  await page.route("**/api/clients/1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        name: "송테스트",
        address: "인천 남동구 테스트로 123",
        phone: "01012345678",
        eDocId: REVIEW_DOC_ID,
      }),
    })
  );
  await page.route("**/api/voucher-price-infos/type**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/access-token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) })
  );
}

async function stubEformsignSdk(page: Page) {
  // Intercept the SDK script + jQuery loads with no-op responses so
  // useEformsign.loadScript resolves; then inject a fake EformSignDocument
  // that records calls and exposes triggers.
  await page.route("https://www.eformsign.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stub */" })
  );

  await page.addInitScript(() => {
    interface CallRecord {
      options: unknown;
      iframeId: string;
      successCallback?: (response: unknown) => void;
      errorCallback?: (response: unknown) => void;
      actionCallback?: (response: unknown) => void;
    }
    const w = window as unknown as Record<string, unknown>;
    w.__eformsignCalls = [] as CallRecord[];
    w.jQuery = function () { return {}; };
    class FakeEformSignDocument {
      private record: CallRecord = { options: null, iframeId: "" };
      document(
        options: unknown,
        iframeId: string,
        success?: (response: unknown) => void,
        error?: (response: unknown) => void,
        action?: (response: unknown) => void,
      ) {
        this.record = {
          options,
          iframeId,
          successCallback: success,
          errorCallback: error,
          actionCallback: action,
        };
      }
      open() {
        const calls = (window as unknown as { __eformsignCalls: CallRecord[] }).__eformsignCalls;
        calls.push(this.record);
      }
    }
    w.EformSignDocument = FakeEformSignDocument;
  });
}

async function fillEndDateAndSubmit(page: Page, value: string) {
  const dateInput = page.getByPlaceholder("YYYY-MM-DD");
  await dateInput.fill(value);
  await page.getByRole("button", { name: "완료" }).click();
}

async function gotoContractsPage(page: Page) {
  await page.goto("/contracts");
}

test.describe("Staff finalize iframe + prefill flow", () => {
  test.describe.configure({ mode: "serial" });

  test("opens dialog, sends prefillEndDate, mounts iframe modal, fires success", async ({ page }) => {
    await stubEformsignSdk(page);
    let capturedGenerateBody: Record<string, unknown> | null = null;

    await installCommonRoutes(page);
    await page.route("**/api/generate-staff-document", async (route) => {
      capturedGenerateBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SDK_OPTIONS) });
    });

    await gotoContractsPage(page);

    // Locate the 검토 필요 list item and select it.
    const reviewItem = page.locator('[data-component="animated-slot-list-item"]').filter({ hasText: "검토 필요" }).first();
    await expect(reviewItem).toBeVisible();
    await reviewItem.click();

    // 확인하기 button only appears for 검토 필요 docs.
    const finalizeTrigger = page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_header_review-trigger"]');
    await expect(finalizeTrigger).toBeVisible();
    await finalizeTrigger.click();

    // Dialog opens with the existing end date pre-filled in YYYY-MM-DD form.
    const dateInput = page.getByPlaceholder("YYYY-MM-DD");
    await expect(dateInput).toHaveValue("2026-06-03");

    // Type a new date and submit.
    await dateInput.fill("2026-07-15");
    await page.getByRole("button", { name: "완료" }).click();

    // Backend was called with the new prefillEndDate.
    await expect.poll(() => capturedGenerateBody).not.toBeNull();
    expect(capturedGenerateBody).toMatchObject({
      documentId: REVIEW_DOC_ID,
      prefillEndDate: "2026-07-15",
    });

    // The eformsign SDK was invoked with the prefill block intact.
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { __eformsignCalls?: unknown[] }).__eformsignCalls?.length ?? 0);
    }).toBeGreaterThan(0);
    const sdkCall = await page.evaluate(() => {
      const calls = (window as unknown as { __eformsignCalls: Array<{ options: unknown; iframeId: string }> }).__eformsignCalls;
      return calls[0];
    });
    expect(sdkCall.iframeId).toBe("contracts_staff_completion_iframe");
    expect(sdkCall.options).toMatchObject({
      mode: { type: "02", document_id: REVIEW_DOC_ID },
      prefill: {
        fields: expect.arrayContaining([
          expect.objectContaining({ id: "계약 종료 년도", value: "2026" }),
          expect.objectContaining({ id: "계약 종료 월", value: "07" }),
          expect.objectContaining({ id: "계약 종료 일", value: "15" }),
        ]),
      },
    });

    // Trigger the SDK success callback to simulate staff approving inside iframe.
    await page.evaluate(() => {
      const calls = (window as unknown as {
        __eformsignCalls: Array<{ successCallback?: (r: unknown) => void }>;
      }).__eformsignCalls;
      calls[0].successCallback?.({ code: "-1", type: "document" });
    });

    // Toast confirms completion (success path closes the iframe modal too).
    await expect(page.getByText("최종 확인 완료")).toBeVisible();
  });

  test("invalid (incomplete) date keeps 완료 disabled", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);
    await page.route("**/api/generate-staff-document", async (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SDK_OPTIONS) })
    );

    await gotoContractsPage(page);
    const reviewItem = page.locator('[data-component="animated-slot-list-item"]').filter({ hasText: "검토 필요" }).first();
    await expect(reviewItem).toBeVisible();
    await reviewItem.click();
    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_header_review-trigger"]').click();

    const dateInput = page.getByPlaceholder("YYYY-MM-DD");
    await dateInput.fill("");
    await dateInput.fill("2026-07");
    await expect(page.getByRole("button", { name: "완료" })).toBeDisabled();
    await dateInput.fill("2026-07-15");
    await expect(page.getByRole("button", { name: "완료" })).toBeEnabled();
  });

  test("backend failure surfaces an error toast and keeps the dialog open", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);
    await page.route("**/api/generate-staff-document", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    );

    await gotoContractsPage(page);
    const reviewItem = page.locator('[data-component="animated-slot-list-item"]').filter({ hasText: "검토 필요" }).first();
    await expect(reviewItem).toBeVisible();
    await reviewItem.click();
    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_header_review-trigger"]').click();
    await fillEndDateAndSubmit(page, "2026-07-15");

    await expect(page.getByText("최종 확인 실패")).toBeVisible();
    // Date dialog remains open so staff can retry.
    await expect(page.getByPlaceholder("YYYY-MM-DD")).toBeVisible();
  });
});
