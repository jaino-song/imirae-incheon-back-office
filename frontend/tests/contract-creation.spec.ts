import { expect, Page, test } from "@playwright/test";

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

const CONTRACT_DOC_ID = "doc-create-test";
const MOCK_CLIENT = {
  id: 1,
  name: "홍테스트",
  phone: "01012345678",
  birthday: "900101",
  address: "인천 남동구 테스트로 123",
  dueDate: "2026-05-30",
};
const MOCK_EMPLOYEES = [
  {
    id: 1,
    name: "테스트직원",
    workArea: ["남동구"],
    phone: "01000000000",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-01-01T00:00:00.000Z",
    status: "available",
  },
  {
    id: 2,
    name: "보조직원",
    workArea: ["남동구"],
    phone: "01000000001",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-01-02T00:00:00.000Z",
    status: "available",
  },
];
const MOCK_AREA_TEMPLATES = [
  {
    id: "area-template-1",
    areaId: "namdong",
    templateId: "tpl-create-test",
    templateName: "남동구 계약서",
  },
];
const MOCK_AREA_TEMPLATE_DISPLAY_LABEL = "남동구";
const MOCK_VOUCHER_PRICE_INFOS = [
  {
    id: 2,
    type: "A가1형",
    duration: "10",
    fullPrice: "1234567",
    grant: "1000000",
    actualPrice: "234567",
  },
];
const MOCK_DOCUMENT_LIST: {
  documents: unknown[];
  total_rows: number;
  limit: number;
  skip: number;
} = {
  documents: [],
  total_rows: 0,
  limit: 100,
  skip: 0,
};
const MOCK_EXISTING_DOCUMENT = {
  id: "doc-existing-test",
  document_number: "BJJ-2026-001",
  template: { id: "tpl-existing-test", name: "남동구 계약서" },
  document_name: "기존 전자문서",
  creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
  created_date: Date.parse("2026-05-01T09:00:00.000Z"),
  last_editor: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
  updated_date: Date.parse("2026-05-01T09:00:00.000Z"),
  recipients: [{ recipient_type: "02", name: "기존고객", sms: "01099998888" }],
  current_status: {
    status_type: "060",
    status_doc_type: "대기",
    status_doc_detail: "대기",
    step_type: "05",
    step_index: "2",
    step_name: "이용자 서명",
    step_recipients: [{ recipient_type: "02", name: "기존고객", sms: "01099998888" }],
    step_group: 1,
    expired_date: Date.parse("2026-06-01T09:00:00.000Z"),
    _expired: false,
  },
  fields: [],
  next_status: [],
  previous_status: [],
  histories: [],
};
const MOCK_SDK_OPTIONS = {
  company: { id: "company-id", country_code: "kr", user_key: "staff@example.com" },
  layout: { lang_code: "ko", header: true, footer: false, viewer_toolbar: true },
  user: {
    type: "01",
    id: "staff@example.com",
    access_token: "fake-token",
    refresh_token: "fake-refresh",
  },
  mode: { type: "01", template_id: "tpl-create-test" },
  prefill: {
    document_name: "산모신생아건강관리서비스 계약서",
    fields: [
      { id: "고객명", value: MOCK_CLIENT.name, enabled: true, required: false },
    ],
  },
};

async function installCommonRoutes(
  page: Page,
  options: {
    documentList?: typeof MOCK_DOCUMENT_LIST;
    detailDocument?: typeof MOCK_EXISTING_DOCUMENT;
  } = {},
) {
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

    if (url.pathname === "/api/eformsign-docs/dispatch-headless") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "headless disabled in offline contract-creation spec",
          fallbackHint: "iframe",
          durationMs: 1,
        }),
      });
    }

    return route.fallback();
  });

  await page.route("**/api/eformsign/auth-status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true }),
    })
  );
  await page.route("**/api/eformsign/documents**", (route) => {
    const url = new URL(route.request().url());
    if (options.detailDocument && url.pathname.endsWith(`/api/eformsign/documents/${options.detailDocument.id}`)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(options.detailDocument),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.documentList ?? MOCK_DOCUMENT_LIST),
    });
  });
  await page.route("**/api/eformsign-docs/client-names", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/clients/1", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CLIENT) })
  );
  await page.route("**/api/clients", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_CLIENT]),
      });
    }

    return route.fallback();
  });
  await page.route("**/api/employees", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EMPLOYEES) })
  );
  await page.route("**/api/voucher-price-infos/years", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([2026]) })
  );
  await page.route("**/api/voucher-price-infos/type**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_VOUCHER_PRICE_INFOS),
    })
  );
  await page.route("**/api/area-templates", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_AREA_TEMPLATES),
    })
  );
  await page.route("**/api/bank-account-infos", (route) =>
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

async function gotoContractsPage(page: Page) {
  await page.goto("/contracts");
}

async function openContractCreationForm(page: Page) {
  await gotoContractsPage(page);
  await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]').click();
  await expect(page.locator('[data-component="contract-creation-form"]')).toBeVisible();
  await expect(page.locator('[data-component="stepped-wizard-stepper-desktop"]')).toBeVisible();
  await expect(page.locator('[data-component="stepped-wizard-stepper-desktop"]')).toContainText("전자문서 생성");
}

async function selectClient(page: Page, name: string) {
  await page.locator('[data-component="clients-autocomplete-input"]').click();
  await page.locator('[data-component="clients-autocomplete-dropdown"] input').fill(name);
  await page.locator('[data-component="clients-autocomplete-dropdown"]').getByText(name, { exact: true }).click();
  await expect(page.locator('[data-component="clients-autocomplete-input"]')).toContainText(name);
}

async function selectDocType(page: Page, label: string) {
  await page.locator('[data-component="contract-creation-doc-type-trigger"]').click();
  await page.locator('[data-component="contract-creation-doc-type-dropdown"]').getByText(label, { exact: true }).click();
  await expect(page.locator('[data-component="contract-creation-doc-type-trigger"]')).toContainText(label);
}

async function selectEmployee(page: Page, index: number, name: string) {
  const autocomplete = page.getByTestId("employee-autocomplete").nth(index);
  await autocomplete.locator('[data-component="employee-autocomplete-input"]').click();
  await page.locator('[data-component="employee-autocomplete-dropdown"] input').fill(name);
  await page.locator('[data-component="employee-autocomplete-dropdown"]').getByText(name, { exact: true }).click();
  await expect(autocomplete.locator('[data-component="employee-autocomplete-input"]')).toContainText(name);
}

async function fillVoucherStep(page: Page) {
  const selects = page.locator('[data-component="stepped-wizard-step-content"] select');
  await selects.nth(0).selectOption("2026");
  await selects.nth(1).selectOption("A가1형");
  await expect(selects).toHaveCount(3);
  await selects.nth(2).selectOption("10");
  await expect(page.locator('input[value="1,234,567"]')).toBeVisible();
  await expect(page.locator('input[value="1,000,000"]')).toBeVisible();
  await expect(page.locator('input[value="234,567"]')).toBeVisible();
}

async function fillContractDates(page: Page, values: { startDate: string; endDate: string; paymentDate: string }) {
  const dateInputs = page.getByPlaceholder("YYYY-MM-DD");
  await dateInputs.nth(0).fill(values.startDate);
  await dateInputs.nth(1).fill(values.endDate);
  await dateInputs.nth(2).fill(values.paymentDate);
}

async function completeContractWizard(page: Page) {
  await selectClient(page, MOCK_CLIENT.name);
  await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
  await page.getByTestId("contract-creation-next").click();

  await selectEmployee(page, 0, MOCK_EMPLOYEES[0].name);
  await page.getByTestId("contract-creation-next").click();

  await fillVoucherStep(page);
  await page.getByTestId("contract-creation-next").click();

  await fillContractDates(page, {
    startDate: "2026-06-01",
    endDate: "2026-06-15",
    paymentDate: "2026-06-03",
  });
}

test.describe("Contract creation iframe + success flow", () => {
  test.describe.configure({ mode: "serial" });

  test("persists the selected provider assignment before creating an electronic document", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);

    const requestOrder: string[] = [];
    let capturedClientUpdateBody: Record<string, unknown> | null = null;
    await page.route("**/api/clients/1", async (route) => {
      if (route.request().method() === "PATCH") {
        requestOrder.push("assignment");
        capturedClientUpdateBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_CLIENT),
        });
      }
      return route.fallback();
    });
    await page.route("**/api/eformsign-docs/dispatch-headless", (route) => {
      requestOrder.push("document");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "stop after request ordering assertion",
          fallbackHint: "iframe",
          durationMs: 1,
        }),
      });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await page.getByTestId("contract-creation-submit").click();

    await expect.poll(() => requestOrder).toEqual(["assignment", "document"]);
    expect(capturedClientUpdateBody).toEqual(expect.objectContaining({
      primaryEmployeeId: MOCK_EMPLOYEES[0].id,
      secondaryEmployeeId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-15",
    }));
  });

  test("keeps voucher duration and price fields visible but disabled before voucher selections", async ({ page }) => {
    await installCommonRoutes(page);
    await openContractCreationForm(page);
    await selectClient(page, MOCK_CLIENT.name);
    await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
    await page.getByTestId("contract-creation-next").click();

    await selectEmployee(page, 0, MOCK_EMPLOYEES[0].name);
    await page.getByTestId("contract-creation-next").click();

    const stepContent = page.locator('[data-component="stepped-wizard-step-content"]');
    const selects = stepContent.locator("select");
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(2)).toBeVisible();
    await expect(selects.nth(2)).toBeDisabled();

    const priceFields = page.locator('[data-component="contract-creation-price-fields"]');
    await expect(priceFields).toBeVisible();

    const priceInputs = priceFields.locator("input");
    await expect(priceInputs).toHaveCount(3);
    await expect(priceInputs.nth(0)).toBeDisabled();
    await expect(priceInputs.nth(1)).toBeDisabled();
    await expect(priceInputs.nth(2)).toBeDisabled();

    await selects.nth(1).selectOption("A가1형");
    await expect(selects.nth(2)).toBeEnabled();
    await expect(priceInputs.nth(0)).toBeDisabled();
    await expect(priceInputs.nth(1)).toBeDisabled();
    await expect(priceInputs.nth(2)).toBeDisabled();

    await selects.nth(2).selectOption("10");
    await expect(priceInputs.nth(0)).toBeEnabled();
    await expect(priceInputs.nth(1)).toBeEnabled();
    await expect(priceInputs.nth(2)).toBeEnabled();
  });

  test("walks the wizard, opens the SDK iframe, and persists the doc record after success", async ({ page }) => {
    await stubEformsignSdk(page);
    let capturedGenerateBody: Record<string, unknown> | null = null;
    let capturedCreateDocRecordBody: Record<string, unknown> | null = null;
    let capturedClientUpdateBody: Record<string, unknown> | null = null;

    await installCommonRoutes(page);
    await page.route("**/api/clients/1", async (route) => {
      if (route.request().method() === "PATCH") {
        capturedClientUpdateBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_CLIENT),
        });
      }
      return route.fallback();
    });
    await page.route("**/api/generate-document", async (route) => {
      capturedGenerateBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SDK_OPTIONS),
      });
    });
    await page.route("**/api/eformsign-docs", async (route) => {
      if (route.request().method() === "POST") {
        capturedCreateDocRecordBody = route.request().postDataJSON() as Record<string, unknown>;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: 99,
            documentId: CONTRACT_DOC_ID,
            clientId: MOCK_CLIENT.id,
            statusType: "060",
          }),
        });
      }

      return route.fallback();
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
    await page.getByTestId("contract-creation-submit").click();

    await expect.poll(() => capturedClientUpdateBody).not.toBeNull();
    expect(capturedClientUpdateBody).toEqual(expect.objectContaining({
      primaryEmployeeId: MOCK_EMPLOYEES[0].id,
      secondaryEmployeeId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-15",
    }));

    await expect(page.getByTestId("contract-creation-progress-step-client-started")).toHaveAttribute(
      "data-state",
      "error"
    );
    await expect(page.getByTestId("contract-creation-progress-step-client-started")).toContainText(
      "전자문서 클라이언트 시작 실패"
    );
    await expect(page.getByTestId("contract-creation-progress-step-client-started")).toContainText(
      "수동으로 입력해 주세요"
    );
    await expect(page.getByTestId("contract-creation-progress-error-client-started")).toBeVisible();
    await expect(page.getByTestId("contract-creation-retry")).toBeVisible();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.locator("#eformsign_iframe")).toHaveCount(0);

    await page.getByTestId("contract-creation-manual").click();
    await expect.poll(() => capturedGenerateBody).not.toBeNull();
    expect(capturedGenerateBody).toEqual(expect.objectContaining({
      clientId: MOCK_CLIENT.id,
      contractData: expect.objectContaining({
        customerName: MOCK_CLIENT.name,
        customerContact: "010-1234-5678",
        customerDOB: MOCK_CLIENT.birthday,
        customerAddress: MOCK_CLIENT.address,
        caretaker1Name: MOCK_EMPLOYEES[0].name,
        caretaker1Contact: "010-0000-0000",
        type: "A가1형",
        days: "10",
        area: MOCK_AREA_TEMPLATES[0].areaId,
        fullPrice: MOCK_VOUCHER_PRICE_INFOS[0].fullPrice,
        grant: MOCK_VOUCHER_PRICE_INFOS[0].grant,
        actualPrice: MOCK_VOUCHER_PRICE_INFOS[0].actualPrice,
        startDate: "2026-06-01",
        paymentYear: "26",
        paymentMonth: "06",
        paymentDay: "03",
      }),
    }));

    await expect.poll(async () => {
      return page.evaluate(() => (window as Window & { __eformsignCalls?: unknown[] }).__eformsignCalls?.length ?? 0);
    }).toBeGreaterThan(0);
    const manualDialog = page.locator('[data-component="messages-contract-form-dialog"]');
    await expect(manualDialog).toBeVisible();
    await expect(page.locator("#eformsign_iframe")).toBeVisible();
    await expect(page.getByTestId("contract-creation-progress-stepper")).toHaveCount(1);
    await expect(manualDialog.locator('[data-testid="contract-creation-progress-stepper"]')).toHaveCount(0);

    const sdkCall = await page.evaluate(() => {
      const calls = (window as Window & {
        __eformsignCalls: Array<{ options: unknown; iframeId: string }>;
      }).__eformsignCalls;
      return calls[0];
    });
    expect(sdkCall.iframeId).toBe("eformsign_iframe");
    expect(sdkCall.options).toMatchObject({
      mode: { type: "01", template_id: "tpl-create-test" },
    });

    await page.evaluate(() => {
      const calls = (window as Window & {
        __eformsignCalls: Array<{ actionCallback?: (response: unknown) => void }>;
      }).__eformsignCalls;
      calls[0].actionCallback?.({
        type: "document",
        fn: "actionCallback",
        data: [
          { name: "전송", code: "21" },
          { name: "func_get_return_fields", code: "99" },
        ],
      });
    });

    await page.evaluate((documentId) => {
      const calls = (window as Window & {
        __eformsignCalls: Array<{ successCallback?: (response: unknown) => void }>;
      }).__eformsignCalls;
      calls[0].successCallback?.({ code: "-1", document_id: documentId, type: "document" });
    }, CONTRACT_DOC_ID);
    const successModal = page.locator('[data-component="contract-creation-success-notification"]');
    await expect(successModal).toBeVisible();
    await expect(successModal).toContainText("계약서가 성공적으로 생성되었습니다.");
    await successModal.getByRole("button", { name: "확인" }).click();

    await expect.poll(() => capturedCreateDocRecordBody).not.toBeNull();
    expect(capturedCreateDocRecordBody).toMatchObject({
      documentId: CONTRACT_DOC_ID,
      clientId: MOCK_CLIENT.id,
      statusType: "060",
      stepRecipientName: MOCK_CLIENT.name,
      stepRecipientSms: MOCK_CLIENT.phone,
      linkToClient: true,
    });
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-progress-step-sent")).toHaveAttribute("data-state", "done");
    const actions = page.locator('[data-component="stepped-wizard-actions"]');
    await expect(actions.getByRole("button", { name: "취소" })).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-new-send")).toBeVisible();

    await page.getByTestId("contract-creation-new-send").click();
    await expect(actions.getByRole("button", { name: "취소" })).toBeVisible();
    await expect(page.getByTestId("contract-creation-next")).toBeDisabled();
    await expect(page.getByTestId("contract-creation-progress-stepper")).toHaveCount(0);
  });

  test("step 1 keeps 다음 disabled until the required selections are complete", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);

    await openContractCreationForm(page);

    const nextButton = page.getByTestId("contract-creation-next");
    await expect(nextButton).toBeDisabled();

    await selectClient(page, MOCK_CLIENT.name);
    await expect(nextButton).toBeDisabled();

    await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
    await expect(nextButton).toBeEnabled();
  });

  test("shows backend headless progress inline while dispatch is pending", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);

    let releaseDispatch: () => void = () => undefined;
    const dispatchCanFinish = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });

    await page.route("**/api/eformsign-docs/dispatch-headless/progress**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: progress\ndata: {"step":"client-started"}\n\n',
          'event: progress\ndata: {"step":"info-inserted"}\n\n',
          'event: progress\ndata: {"step":"creating"}\n\n',
        ].join(""),
      })
    );
    await page.route("**/api/eformsign-docs/dispatch-headless", async (route) => {
      await dispatchCanFinish;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "release to iframe fallback after progress assertion",
          fallbackHint: "iframe",
          durationMs: 1,
        }),
      });
    });
    await page.route("**/api/generate-document", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SDK_OPTIONS),
      })
    );

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await page.getByTestId("contract-creation-submit").click();

    await expect(page.locator('[data-component="stepped-wizard-stepper-desktop-circle"]').nth(4)).toHaveClass(/scale-110/);
    await expect(page.getByTestId("contract-creation-progress-stepper")).toHaveCount(1);
    await expect.poll(async () => page.getByTestId("contract-creation-progress-stepper").evaluate((el) => el.tagName))
      .toBe("OL");
    await expect(page.getByTestId("contract-creation-progress-step-client-started")).toHaveAttribute(
      "data-state",
      "done"
    );
    await expect(page.getByTestId("contract-creation-progress-step-info-inserted")).toHaveAttribute(
      "data-state",
      "done"
    );
    await expect(page.getByTestId("contract-creation-progress-step-creating")).toHaveAttribute(
      "data-state",
      "active"
    );
    await expect(page.getByTestId("contract-creation-progress-spinner-creating")).toBeVisible();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.locator("#eformsign_iframe")).toHaveCount(0);

    releaseDispatch();
    await expect(page.getByTestId("contract-creation-progress-step-creating")).toHaveAttribute(
      "data-state",
      "error"
    );
    await expect(page.getByTestId("contract-creation-progress-step-creating")).toContainText("전자문서 생성 실패");
    await expect(page.getByTestId("contract-creation-progress-error-creating")).toBeVisible();
    await expect(page.getByTestId("contract-creation-retry")).toBeVisible();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.locator("#eformsign_iframe")).toHaveCount(0);
  });

  test("returns to the in-progress creation detail instead of starting a new send session", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page, {
      documentList: {
        documents: [MOCK_EXISTING_DOCUMENT],
        total_rows: 1,
        limit: 100,
        skip: 0,
      },
      detailDocument: MOCK_EXISTING_DOCUMENT,
    });

    let releaseDispatch: () => void = () => undefined;
    const dispatchCanFinish = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });

    await page.route("**/api/eformsign-docs/dispatch-headless/progress**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'event: progress\ndata: {"step":"client-started"}\n\n',
          'event: progress\ndata: {"step":"info-inserted"}\n\n',
          'event: progress\ndata: {"step":"creating"}\n\n',
        ].join(""),
      })
    );
    await page.route("**/api/eformsign-docs/dispatch-headless", async (route) => {
      await dispatchCanFinish;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          reason: "release after retained-session assertion",
          fallbackHint: "iframe",
          durationMs: 1,
        }),
      });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await page.getByTestId("contract-creation-submit").click();

    await expect(page.getByTestId("contract-creation-progress-step-creating")).toHaveAttribute(
      "data-state",
      "active"
    );
    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item_content"]').getByText("기존고객").click();
    await expect(page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_content"]')).toBeVisible();
    await expect(page.locator('[data-component="contract-creation-form"]')).toBeHidden();

    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]').click();
    await expect(page.locator('[data-component="contract-creation-form"]')).toBeVisible();
    await expect(page.getByTestId("contract-creation-progress-step-creating")).toHaveAttribute(
      "data-state",
      "active"
    );
    await expect(page.getByTestId("contract-creation-submit")).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-progress-stepper")).toHaveCount(1);

    releaseDispatch();
    await expect(page.getByTestId("contract-creation-progress-step-creating")).toHaveAttribute(
      "data-state",
      "error"
    );
  });

  test("marks the failed backend step and retries headless dispatch", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);

    let progressRequests = 0;
    let dispatchCalls = 0;

    await page.route("**/api/eformsign-docs/dispatch-headless/progress**", (route) => {
      progressRequests += 1;
      const events = progressRequests === 1
        ? [
          'event: progress\ndata: {"step":"client-started"}\n\n',
          'event: progress\ndata: {"step":"info-inserted"}\n\n',
          'event: progress\ndata: {"step":"failed","failedStep":"info-inserted","reason":"selector miss"}\n\n',
        ]
        : [
          'event: progress\ndata: {"step":"client-started"}\n\n',
          'event: progress\ndata: {"step":"info-inserted"}\n\n',
          'event: progress\ndata: {"step":"creating"}\n\n',
          'event: progress\ndata: {"step":"sent"}\n\n',
        ];

      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events.join(""),
      });
    });
    await page.route("**/api/eformsign-docs/dispatch-headless", async (route) => {
      dispatchCalls += 1;
      if (dispatchCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          dispatchCalls === 1
            ? {
              ok: false,
              reason: "selector miss",
              fallbackHint: "iframe",
              durationMs: 1,
            }
            : {
              ok: true,
              documentId: CONTRACT_DOC_ID,
              durationMs: 2,
            },
        ),
      });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await page.getByTestId("contract-creation-submit").click();

    const failedStep = page.getByTestId("contract-creation-progress-step-info-inserted");
    await expect(failedStep).toHaveAttribute("data-state", "error");
    await expect(failedStep).toContainText("이용자 정보 입력 실패");
    await expect(failedStep).toContainText("수동으로 입력해 주세요");
    await expect(page.getByTestId("contract-creation-progress-error-info-inserted")).toBeVisible();
    await expect(page.getByTestId("contract-creation-retry")).toBeVisible();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.locator("#eformsign_iframe")).toHaveCount(0);

    await page.getByTestId("contract-creation-retry").click();
    const successModal = page.locator('[data-component="contract-creation-success-notification"]');
    await expect(successModal).toBeVisible();
    await expect(successModal).toContainText("계약서가 성공적으로 생성되었습니다.");
    await successModal.getByRole("button", { name: "확인" }).click();

    expect(dispatchCalls).toBe(2);
    await expect(page.getByTestId("contract-creation-progress-step-sent")).toHaveAttribute("data-state", "done");
    const actions = page.locator('[data-component="stepped-wizard-actions"]');
    await expect(actions.getByRole("button", { name: "취소" })).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-new-send")).toBeVisible();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    await expect(page.locator("#eformsign_iframe")).toHaveCount(0);
  });

  test("manual fallback failure shows an error and returns to the contract info step", async ({ page }) => {
    await stubEformsignSdk(page);
    await installCommonRoutes(page);
    await page.route("**/api/generate-document", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    );

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await page.getByTestId("contract-creation-submit").click();
    await expect(page.getByTestId("contract-creation-manual")).toBeVisible();
    await page.getByTestId("contract-creation-manual").click();

    await expect(page.locator('[data-component="messages-contract-form-error"]')).toContainText(
      "Request failed with status code 500"
    );
    await expect(page.getByPlaceholder("YYYY-MM-DD")).toHaveCount(3);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
    await expect(page.locator('[data-component="messages-contract-form-dialog"]')).toHaveCount(0);
    const sdkCallCount = await page.evaluate(
      () => (window as Window & { __eformsignCalls?: unknown[] }).__eformsignCalls?.length ?? 0
    );
    expect(sdkCallCount).toBe(0);
  });
});
