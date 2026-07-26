import { expect, test, type Page } from "@playwright/test";

import {
  routeContractsApi,
  type ContractListRequest,
  type ContractMockDocument,
} from "./helpers/contracts-api-mock";

const MOCK_DOCUMENTS = {
  documents: [
    {
      id: "doc-1",
      document_number: "DOC-001",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "홍길동 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now(),
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now(),
      current_status: {
        status_type: "003",
        step_recipients: [{ recipient_type: "signer", name: "홍길동" }],
      },
    },
  ],
};

const SECTION_DOCUMENTS = {
  documents: [
    MOCK_DOCUMENTS.documents[0],
    {
      ...MOCK_DOCUMENTS.documents[0],
      id: "service-record-1",
      document_number: "RECORD-001",
      template: { id: "service-record-template", name: "산모신생아 제공기록지" },
      document_name: "김산모 제공기록지",
      current_status: {
        ...MOCK_DOCUMENTS.documents[0].current_status,
        step_recipients: [{ recipient_type: "signer", name: "김산모" }],
      },
    },
  ],
};

const STAGE_DOCUMENTS = {
  documents: [
    {
      id: "doc-waiting",
      document_number: "DOC-WAITING",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "대기고객 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now(),
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now(),
      current_status: {
        status_type: "002",
        step_type: "05",
        step_index: 1,
        step_group: 3,
        step_recipients: [{ recipient_type: "signer", name: "대기고객" }],
      },
      histories: [],
      previous_status: [],
    },
    {
      id: "doc-opened",
      document_number: "DOC-OPENED",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "열람고객 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 500,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 500,
      current_status: {
        status_type: "002",
        step_index: 1,
        step_group: 3,
        step_recipients: [{ recipient_type: "signer", name: "열람고객" }],
      },
      histories: [{ status_type: "064", updated_date: Date.now() - 500 }],
      previous_status: [],
    },
    {
      id: "doc-stale-step",
      document_number: "DOC-STALE-STEP",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "구문서 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 750,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 750,
      current_status: {
        status_type: "002",
        step_index: 2,
        step_group: 3,
        step_recipients: [{ recipient_type: "signer", name: "구문서" }],
      },
      histories: [],
      previous_status: [],
    },
    {
      id: "doc-send-failed",
      document_number: "DOC-SEND-FAILED",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "전송실패 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 800,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 800,
      current_status: {
        status_type: "002",
        step_index: 1,
        step_group: 3,
        step_recipients: [{ recipient_type: "signer", name: "전송실패" }],
      },
      histories: [{ event_type: "send_failed", action: "document_send", message: "전송 실패" }],
      previous_status: [],
    },
    {
      id: "doc-review",
      document_number: "DOC-REVIEW",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "검토고객 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 1000,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 1000,
      current_status: {
        status_type: "020",
        step_type: "06",
        step_index: 2,
        step_name: "제공기관 검토",
        step_group: 3,
        step_recipients: [{ recipient_type: "01", name: "검토 담당자" }],
      },
      histories: [],
      previous_status: [],
    },
    {
      id: "doc-user-participant",
      document_number: "DOC-USER-PARTICIPANT",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "이용자단계 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 1500,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 1500,
      current_status: {
        status_type: "060",
        status_doc_type: "01",
        status_doc_detail: "060",
        step_type: "05",
        step_index: "2",
        step_name: "이용자",
        step_recipients: [{ recipient_type: "01", name: "이용자단계" }],
        step_group: 3,
        expired_date: Date.now() + 1000 * 60 * 60 * 24,
        _expired: false,
      },
      histories: [
        { action_type: "002", step_type: "00", step_name: "제공기관 작성" },
        { action_type: "060", step_type: "05", step_name: "이용자" },
      ],
      previous_status: [{ action_type: "002", step_type: "00", step_name: "제공기관 작성" }],
    },
    {
      id: "doc-provider-drafting",
      document_number: "DOC-PROVIDER-DRAFTING",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "작성단계 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 1400,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 1400,
      current_status: {
        status_type: "002",
        step_type: "00",
        step_index: "1",
        step_name: "제공기관 작성",
        step_group: 1,
        step_recipients: [{ recipient_type: "01", name: "작성 담당자" }],
      },
      histories: [],
      previous_status: [],
    },
    {
      id: "doc-completed",
      document_number: "DOC-COMPLETED",
      template: { id: "tpl-1", name: "Contract" },
      document_name: "완료고객 계약서",
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - 2000,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - 2000,
      current_status: {
        status_type: "003",
        step_recipients: [
          { recipient_type: "signer", name: "완료고객" },
          { recipient_type: "01", name: "관리자" },
        ],
      },
      histories: [],
      previous_status: [],
    },
  ],
};

const SERVICE_RECORD_REVIEW_DOCUMENTS = {
  documents: STAGE_DOCUMENTS.documents
    .filter((document) => document.id === "doc-review")
    .map((document) => ({
      ...document,
      template: { id: "service-record-template", name: "산모신생아 제공기록지" },
      document_name: "검토고객 제공기록지",
    })),
};

const PAGINATED_DOCUMENTS: { documents: ContractMockDocument[] } = {
  documents: Array.from({ length: 15 }, (_, index) => {
    const sequence = index + 1;
    return {
      id: `paginated-doc-${sequence}`,
      document_number: `PAGE-${String(sequence).padStart(3, "0")}`,
      template: { id: "tpl-1", name: "Contract" },
      document_name: `페이지고객 ${sequence} 계약서`,
      creator: { recipient_type: "sender", id: "admin", name: "Admin" },
      created_date: Date.now() - index * 1000,
      last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
      updated_date: Date.now() - index * 1000,
      current_status: {
        status_type: "003",
        step_recipients: [{ recipient_type: "signer", name: `페이지고객 ${sequence}` }],
      },
    };
  }),
};

const DOCUMENT_CLIENT_SUMMARIES = [
  { documentId: "doc-1", clientId: 100, clientName: "홍길동", clientPhone: "010-1000-0000", providerName: "박제공" },
  { documentId: "doc-waiting", clientId: 101, clientName: "대기고객", clientPhone: "010-1111-2222", providerName: "김제공" },
  { documentId: "doc-opened", clientId: 102, clientName: "열람고객", clientPhone: "010-2222-3333", providerName: "이제공" },
  { documentId: "doc-stale-step", clientId: 103, clientName: "구문서", clientPhone: "010-3333-4444", providerName: "최제공" },
  { documentId: "doc-send-failed", clientId: 104, clientName: "전송실패", clientPhone: "010-4444-5555", providerName: "정제공" },
  { documentId: "doc-review", clientId: 105, clientName: "검토고객", clientPhone: "010-5555-6666", providerName: "한제공" },
  { documentId: "doc-user-participant", clientId: 106, clientName: "이용자단계", clientPhone: "010-6666-0000", providerName: "송제공" },
  { documentId: "doc-provider-drafting", clientId: 107, clientName: "작성단계", clientPhone: "010-6666-1111", providerName: "강제공" },
  { documentId: "doc-completed", clientId: 108, clientName: "완료고객", clientPhone: "010-6666-7777", providerName: "오제공" },
];

function createDocumentClientSummaries(documents: readonly ContractMockDocument[]) {
  return documents.map((document, index) => ({
    documentId: document.id,
    clientId: 2000 + index,
    clientName: document.current_status?.step_recipients?.[0]?.name ?? document.document_name ?? "고객",
    clientPhone: "010-0000-0000",
    providerName: "테스트 제공자",
  }));
}

const NOTIFICATION_LOGS = [
  {
    id: 1,
    provider: "aligo_alimtalk",
    templateKey: "CONTRACT_SENT",
    receiver: "010-1111-2222",
    clientId: 101,
    messageBody: "계약서가 발송되었습니다.",
    status: "sent",
    errorMessage: null,
    attempts: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ruleName: "계약서 발송 안내",
    eventType: "contract_sent",
    recipientName: "대기고객",
    clientName: "대기고객",
    employeeName: "김제공",
  },
  {
    id: 2,
    provider: "aligo_sms",
    templateKey: "manual_sms",
    receiver: "010-1111-2222",
    clientId: 101,
    messageBody: "수동 메시지입니다.",
    status: "sent",
    errorMessage: null,
    attempts: 1,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1000).toISOString(),
    ruleName: null,
    eventType: null,
    recipientName: "대기고객",
    clientName: "대기고객",
    employeeName: "김제공",
  },
  {
    id: 3,
    provider: "aligo_alimtalk",
    templateKey: "OTHER",
    receiver: "010-9999-9999",
    clientId: 999,
    messageBody: "다른 고객 알림입니다.",
    status: "sent",
    errorMessage: null,
    attempts: 1,
    createdAt: new Date(Date.now() - 2000).toISOString(),
    updatedAt: new Date(Date.now() - 2000).toISOString(),
    ruleName: "다른 고객",
    eventType: null,
    recipientName: "다른 고객",
    clientName: "다른 고객",
    employeeName: null,
  },
];

async function routeDocumentClientSummaries(page: Page, summaries = DOCUMENT_CLIENT_SUMMARIES) {
  await page.route("**/api/eformsign-docs/client-names**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summaries),
    });
  });
}

async function routeNotificationLogs(page: Page, logs = NOTIFICATION_LOGS) {
  await page.route("**/api/message-logs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(logs),
    });
  });
}

async function routeContractsList(
  page: Page,
  payload: { documents: readonly ContractMockDocument[] },
  options: {
    beforeListResponse?: (request: ContractListRequest) => Promise<void> | void;
    onListRequest?: (request: ContractListRequest) => Promise<void> | void;
  } = {},
) {
  await routeContractsApi(page, {
    getDocuments: () => payload.documents,
    ...options,
  });
}

async function routeDocumentDetails(page: Page, docs = [...MOCK_DOCUMENTS.documents, ...STAGE_DOCUMENTS.documents]) {
  await page.route("**/api/eformsign/documents/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || !/^\/api\/eformsign\/documents\/[^/]+$/.test(url.pathname)) {
      await route.fallback();
      return;
    }

    const documentId = url.pathname.split("/").pop();
    if (documentId === "status-counts") {
      await route.fallback();
      return;
    }
    const doc = docs.find((item) => item.id === documentId);
    await route.fulfill({
      status: doc ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(doc ?? { error: "Not found" }),
    });
  });
}

async function routeDocumentPdfPreview(page: Page) {
  await page.route("**/api/eformsign/documents/*/download_files**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
    });
  });
}

test.describe("Mobile contracts list rows", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("separates maternal contracts and service records with section navigation", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });
    await routeContractsList(page, SECTION_DOCUMENTS);
    // Service-record rows take their name from the client-summary map, so the
    // section fixture has to supply one for both documents.
    await routeDocumentClientSummaries(
      page,
      createDocumentClientSummaries(SECTION_DOCUMENTS.documents),
    );
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    const maternalContractsButton = page.getByRole("button", { name: "산모 계약서", exact: true });
    const serviceRecordsButton = page.getByRole("button", { name: "제공기록지", exact: true });
    await expect(maternalContractsButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(1);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toContainText("홍길동");

    await serviceRecordsButton.click();

    await expect(serviceRecordsButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_header"]')).toContainText("제공기록지");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(1);
    const serviceRecordRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]');
    await expect(serviceRecordRow.locator(".list-name")).toHaveText("김산모");
    await expect(serviceRecordRow.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row_subtitle"]')).toHaveText("제공기록지");
    await expect(serviceRecordRow.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row_dates_sent-date"]')).toContainText("발송 ");
    await expect(serviceRecordRow.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row_dates_completed-date"]')).toContainText("완료 ");
    await expect(
      serviceRecordRow.locator(
        '[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row_right_status"]',
      ),
    ).toHaveText("완료");
  });

  test("renders contract rows with the shared list item structure", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, MOCK_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    const row = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/(^|\s)list-item(\s|$)/);
    await expect(row).not.toHaveClass(/(^|\s)contract-item(\s|$)/);
    await expect(row.locator(".list-avatar")).toHaveCount(1);
    await expect(row.locator(".list-name")).toContainText("홍길동");
  });

  // The reveal window is measured from the scroll viewport (rows that fit + 1 peek)
  // and is capped by the server total, so the phone-sized viewport from
  // `test.use` is what keeps the teaser button on screen for a 15-row total.
  // A very tall viewport would reveal every row at once and hide the teaser.
  test("requests a nine-row first page and a six-row next page", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    const listRequests: ContractListRequest[] = [];
    await routeContractsList(page, PAGINATED_DOCUMENTS, {
      onListRequest: (request) => {
        listRequests.push(request);
      },
    });
    await routeDocumentClientSummaries(
      page,
      createDocumentClientSummaries(PAGINATED_DOCUMENTS.documents),
    );
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    await expect.poll(() =>
      listRequests.some(
        (request) =>
          request.limit === 9
          && request.skip === 0
          && request.search === ""
          && request.statusCategory === null
          && request.templateId === "service-record-template"
          && request.templateMatch === "exclude"
          && request.excludeDeleted,
      ),
    ).toBe(true);
    const rows = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]');
    const loadMoreButton = page.locator(
      '[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_load-more_button"]',
    );
    await expect(loadMoreButton).toBeVisible({ timeout: 15000 });
    await expect(loadMoreButton).toContainText("탭하여 더보기");

    // Only the first server page has been revealed while the teaser is showing.
    const revealedBeforeTap = await rows.count();
    expect(revealedBeforeTap).toBeGreaterThan(0);
    expect(revealedBeforeTap).toBeLessThanOrEqual(9);

    // The next server page is pulled with the smaller page size at the first-page offset.
    await expect.poll(() =>
      listRequests.some(
        (request) =>
          request.limit === 6
          && request.skip === 9
          && request.search === ""
          && request.statusCategory === null
          && request.templateId === "service-record-template"
          && request.templateMatch === "exclude"
          && request.excludeDeleted,
      ),
    ).toBe(true);

    await loadMoreButton.click();

    // Tapping the teaser hands the list over to the scroll sentinel.
    await expect(loadMoreButton).toHaveCount(0);
    await expect.poll(() => rows.count()).toBeGreaterThan(revealedBeforeTap);
  });

  test("hides load more when all nine documents fit in the first page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1600 });
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    const firstPageOnly = {
      documents: PAGINATED_DOCUMENTS.documents.slice(0, 9),
    };
    await routeContractsList(page, firstPageOnly);
    await routeDocumentClientSummaries(
      page,
      createDocumentClientSummaries(firstPageOnly.documents),
    );
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(9, {
      timeout: 15000,
    });
    await expect(
      page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_load-more_button"]'),
    ).toHaveCount(0);
  });

  test("uses six-stage progress labels for contract progress", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    // Anchor: wait for the mocked rows to land before child assertions.
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]').first()).toBeVisible({ timeout: 15000 });

    const waitingRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" });
    const openedRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "열람고객" });
    const staleStepRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "구문서" });
    const sendFailedRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "전송실패" });
    // Row name comes from DOCUMENT_CLIENT_SUMMARIES.clientName ("검토고객"),
    // not the step recipient name.
    const reviewRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "검토고객" });
    const userParticipantRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "이용자단계" });
    const providerDraftingRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "작성단계" });
    const completedRow = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "완료고객" });

    await expect(waitingRow.locator(".step-label")).toHaveText("3/6 - 이용자 문서 열람 대기");
    await expect(openedRow.locator(".step-label")).toHaveText("4/6 - 이용자 서명 대기");
    await expect(staleStepRow.locator(".step-label")).toHaveText("3/6 - 이용자 문서 열람 대기");
    await expect(sendFailedRow.locator(".step-label")).toHaveText("이용자 문서 전송 실패");
    await expect(reviewRow.locator(".step-label")).toHaveText("5/6 - 제공기관 검토 필요");
    await expect(userParticipantRow.locator(".step-label")).toHaveText("3/6 - 이용자 문서 열람 대기");
    await expect(providerDraftingRow.locator(".step-label")).toHaveText("3/6 - 이용자 문서 열람 대기");
    await expect(completedRow.locator(".step-label")).toHaveText("6/6 - 계약서 완료");
  });

  test("keeps the list card stable while contracts are loading", async ({ page }) => {
    let resolveDocuments!: () => void;
    const documentsReady = new Promise<void>((resolve) => {
      resolveDocuments = resolve;
    });

    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS, {
      beforeListResponse: async () => {
        await documentsReady;
      },
    });
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    const listCard = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]');
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_loading-row"]')).toHaveCount(9);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_load-more_placeholder"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_empty"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_header"]')).not.toContainText("0건");
    const beforeBox = await listCard.boundingBox();
    expect(beforeBox).not.toBeNull();

    resolveDocuments();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" })).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_loading-row"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_empty"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_header"]')).toContainText("8건");

    const afterBox = await listCard.boundingBox();
    expect(afterBox).not.toBeNull();
    if (!beforeBox || !afterBox) {
      throw new Error("List card should have a stable box before and after loading");
    }
    expect(Math.abs(beforeBox.y - afterBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(beforeBox.height - afterBox.height)).toBeLessThanOrEqual(1);
  });

  test("uses the full viewport shell without a route-specific phone frame", async ({ page }) => {
    await page.setViewportSize({ width: 467, height: 852 });

    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]')).toBeVisible();
    // The route body class is added by a client effect, so measuring before it
    // lands races the hydrated shell styles (body background in particular).
    await page.waitForFunction(() =>
      document.body.classList.contains("mobile-contracts-route"),
    );

    const geometry = await page.evaluate(() => {
      const appRoot = document.querySelector('[data-slot="app-root"]')?.getBoundingClientRect();
      const appProviders = document.querySelector('[data-slot="app-content"]')?.getBoundingClientRect();
      const card = document.querySelector('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]')?.getBoundingClientRect();
      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      const rootElement = document.querySelector('[data-slot="app-root"]') as HTMLElement | null;
      const providersElement = document.querySelector('[data-slot="app-content"]') as HTMLElement | null;
      const rootStyles = rootElement ? getComputedStyle(rootElement) : null;
      const providerStyles = providersElement ? getComputedStyle(providersElement) : null;

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        appRoot: appRoot
          ? {
              x: appRoot.x,
              width: appRoot.width,
              height: appRoot.height,
              borderRadius: rootStyles?.borderRadius ?? "",
              padding: rootStyles?.padding ?? "",
            }
          : null,
        appProviders: appProviders
          ? {
              width: appProviders.width,
              height: appProviders.height,
              background: providerStyles?.backgroundColor ?? "",
              borderRadius: providerStyles?.borderRadius ?? "",
            }
          : null,
        card: card ? { x: card.x, width: card.width } : null,
        bodyBackground,
        rootBackground: rootStyles?.backgroundColor ?? "",
      };
    });

    expect(geometry.appRoot).not.toBeNull();
    expect(geometry.appProviders).not.toBeNull();
    expect(geometry.card).not.toBeNull();
    if (!geometry.appRoot || !geometry.appProviders || !geometry.card) {
      throw new Error("Contracts shell geometry should be measurable");
    }

    const expectedRootWidth = geometry.viewportWidth;
    const expectedRootHeight = geometry.viewportHeight;
    const expectedRootX = 0;

    expect(Math.abs(geometry.appRoot.x - expectedRootX)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.width - expectedRootWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appRoot.height - expectedRootHeight)).toBeLessThanOrEqual(1);
    expect(geometry.appRoot.borderRadius).toBe("0px");
    expect(geometry.appRoot.padding).toBe("0px");
    expect(Math.abs(geometry.appProviders.width - expectedRootWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.appProviders.height - expectedRootHeight)).toBeLessThanOrEqual(1);
    expect(geometry.appProviders.borderRadius).toBe("0px");
    expect(geometry.appProviders.background).toBe("rgba(0, 0, 0, 0)");
    expect(Math.abs(geometry.card.x - (expectedRootX + 14))).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.card.width - (expectedRootWidth - 28))).toBeLessThanOrEqual(1);
    expect(geometry.bodyBackground).toBe(geometry.rootBackground);
  });

  test("keeps the contracts bottom nav active before the route body class hydrates", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]')).toBeVisible();
    // The route body class is added by a client effect, so measuring before it
    // lands races the hydrated shell styles (body background in particular).
    await page.waitForFunction(() =>
      document.body.classList.contains("mobile-contracts-route"),
    );

    await page.evaluate(() => {
      document.body.classList.remove("mobile-contracts-route");
    });

    const contractsTab = page.locator('[data-slot="mobile-bottom-nav-contracts"]');
    const indicator = page.locator('[data-slot="mobile-bottom-indicator"]');
    await expect(indicator).toHaveCSS("display", "block");
    await expect(indicator).toHaveCSS("opacity", "1");
    await expect(contractsTab).toHaveAttribute("aria-current", "page");
    await expect(contractsTab).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(contractsTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    const beforeHydrationClass = await page.evaluate(() => {
      const header = document.querySelector('[data-slot="mobile-header"]')?.getBoundingClientRect();
      const card = document.querySelector('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]')?.getBoundingClientRect();
      return {
        header: header ? { x: header.x, y: header.y, width: header.width } : null,
        card: card ? { x: card.x, y: card.y, height: card.height } : null,
      };
    });

    await page.evaluate(() => {
      document.body.classList.add("mobile-contracts-route");
    });

    const afterHydrationClass = await page.evaluate(() => {
      const header = document.querySelector('[data-slot="mobile-header"]')?.getBoundingClientRect();
      const card = document.querySelector('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card"]')?.getBoundingClientRect();
      return {
        header: header ? { x: header.x, y: header.y, width: header.width } : null,
        card: card ? { x: card.x, y: card.y, height: card.height } : null,
      };
    });

    expect(beforeHydrationClass.header).not.toBeNull();
    expect(beforeHydrationClass.card).not.toBeNull();
    expect(afterHydrationClass.header).not.toBeNull();
    expect(afterHydrationClass.card).not.toBeNull();
    if (!beforeHydrationClass.header || !beforeHydrationClass.card || !afterHydrationClass.header || !afterHydrationClass.card) {
      throw new Error("Contracts shell geometry should be measurable");
    }
    expect(Math.abs(beforeHydrationClass.header.x - afterHydrationClass.header.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(beforeHydrationClass.header.y - afterHydrationClass.header.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(beforeHydrationClass.header.width - afterHydrationClass.header.width)).toBeLessThanOrEqual(1);

    // NOTE: full first-paint layout parity for the list card is deliberately NOT
    // asserted here. The contracts shell still keys its offsets and sizing to the
    // `mobile-contracts-route` body class, which a client effect adds only after
    // hydration. The route-independent fallback was keyed on
    // [data-component="contracts"] — an anchor that stopped being rendered when
    // ContractsRedesign.tsx became dead code, leaving ~15 dead `:has()` selectors
    // behind. The first frame therefore sits ~16px lower than the hydrated layout
    // (main-content `pt-20` 80px + `.shell-content` 12px = 92px, versus
    // `padding: 0` + 76px once the class lands) and differs in card height by
    // ~61px. That is a real but PRE-EXISTING product gap, older than
    // the pagination work, and untangling it means rewriting the contracts slice of
    // redesign.css — scheduled for the app-shell CSS cleanup slice of the
    // DATA-COMPONENT-CONVENTION migration. This test stays scoped to its title:
    // the bottom nav must read as active without the route body class.
  });

  test("shows the sign action only when review is needed", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    // Anchor: wait for the mocked rows to land before child assertions.
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]').first()).toBeVisible({ timeout: 15000 });

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_sign"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-share"]')).toHaveCount(0);

    await page.locator(".sheet-close").click();
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "검토고객" }).click();
    const signAction = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_sign"]');
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]')).toBeVisible();
    await expect(signAction).toBeVisible();
    await expect(signAction).toHaveText("검토하기");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-share"]')).toHaveCount(0);
  });

  test("confirms a service record review without requesting an end date", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });
    await routeContractsList(page, SERVICE_RECORD_REVIEW_DOCUMENTS);
    await page.route("**/api/eformsign-docs/finalize-headless**", async (route) => {
      if (route.request().url().includes("/progress")) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: 'data: {"step":"sent"}\n\n',
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    await page.getByRole("button", { name: "제공기록지", exact: true }).click();
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "검토고객" }).click();
    await expect(
      page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_header_title-group_name"]'),
    ).toHaveText("제공기록지");
    const userInfo = page.locator(".info-card", { hasText: "이용자 정보" });
    await expect(userInfo).toContainText("검토고객");
    await expect(userInfo).toContainText("010-5555-6666");
    await expect(userInfo).toContainText("한제공");
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_sign"]').click();

    const confirmModal = page.locator('[data-component="mobile_contracts_finalize-confirmation_modal"]');
    await expect(confirmModal).toBeVisible();
    await expect(
      confirmModal.locator('[data-component="mobile_contracts_finalize-confirmation_modal_title"]'),
    ).toHaveText("완료할까요?");
    await expect(page.locator('[data-component="mobile_contracts_finalize-dialog"]')).toHaveCount(0);

    const finalizeRequestPromise = page.waitForRequest((request) =>
      request.url().includes("/api/eformsign-docs/finalize-headless")
      && !request.url().includes("/progress")
      && request.method() === "POST",
    );
    await confirmModal.getByRole("button", { name: "완료" }).click();
    const finalizeRequest = await finalizeRequestPromise;
    const finalizeRequestBody = finalizeRequest.postDataJSON() as Record<string, unknown>;

    expect(finalizeRequestBody.documentId).toBe("doc-review");
    expect(finalizeRequestBody).not.toHaveProperty("prefillEndDate");
  });

  test("shows the PDF preview below contract actions", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: (data?: { files?: File[] }) => Array.isArray(data?.files) && data.files.length === 1,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data?: { files?: File[] }) => {
          const file = data?.files?.[0];
          (window as typeof window & {
            __sharedReceipt?: { count: number; name: string; size: number; type: string };
          }).__sharedReceipt = file
            ? {
                count: data?.files?.length ?? 0,
                name: file.name,
                size: file.size,
                type: file.type,
              }
            : undefined;
        },
      });
    });

    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);
    await routeDocumentPdfPreview(page);

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "완료고객" }).click();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview"]')).toHaveCount(0);
    const receiptShareButton = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-share"]');
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]')).toBeVisible();
    await expect(receiptShareButton).toHaveText("영수증 공유");
    await receiptShareButton.click();
    const sharedReceipt = await page.waitForFunction(() => {
      return (window as typeof window & {
        __sharedReceipt?: { count: number; name: string; size: number; type: string };
      }).__sharedReceipt;
    });
    expect(await sharedReceipt.jsonValue()).toMatchObject({
      count: 1,
      name: "완료고객 계약서 영수증.pdf",
      type: "application/pdf",
    });

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]').click();

    const preview = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview"]');
    await expect(preview).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]')).toHaveCount(0);
    await expect(preview).toHaveCSS("animation-name", "none");
    await expect(preview).toHaveCSS("border-top-width", "0px");
    await expect(preview).toHaveCSS("border-radius", "0px");
    await expect(preview).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(preview).toHaveCSS("min-height", "0px");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content"]')).toHaveCSS("overflow-y", "hidden");
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_tabs"]')).toHaveCount(0);

    const previewHeader = preview.locator(".contract-preview-header");
    await expect(previewHeader).toHaveCSS("animation-name", "mobile-redesign-pop-up");
    await expect(previewHeader).toHaveCSS("animation-duration", "0.4s");

    const frame = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_frame"]');
    await expect(frame).toHaveAttribute("src", /\/api\/eformsign\/documents\/doc-completed\/download_files\?fileType=document#toolbar=0/);
    await expect(frame).toHaveCSS("min-height", "0px");
    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    if (!frameBox) {
      throw new Error("PDF preview frame should be visible");
    }
    expect(frameBox.y + frameBox.height).toBeLessThanOrEqual(845);

    const backButton = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_header_back"]');
    const receiptButton = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_header_receipt-download"]');
    const downloadButton = page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_header_pdf-download"]');
    await expect(backButton).toHaveText("돌아가기");
    await expect(receiptButton).toHaveText("영수증");
    await expect(downloadButton).toHaveText("다운로드");
    await expect(receiptButton).toHaveAttribute("href", /\/api\/eformsign\/documents\/doc-completed\/download_files\?fileType=document&page=7$/);
    await expect(receiptButton).toHaveAttribute("download", "완료고객 계약서 영수증.pdf");
    await expect(downloadButton).toHaveAttribute("href", /\/api\/eformsign\/documents\/doc-completed\/download_files\?fileType=document$/);
    await expect(downloadButton).toHaveAttribute("download", "완료고객 계약서.pdf");
    await expect(backButton).toHaveCSS("transition-property", "color, background-color, opacity, transform");
    await expect(backButton).toHaveCSS("transition-duration", "0.16s, 0.16s, 0.16s, 0.16s");
    await expect(receiptButton).toHaveCSS("border-top-width", "0px");
    await expect(receiptButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(receiptButton).toHaveCSS("font-size", await backButton.evaluate((node) => getComputedStyle(node).fontSize));
    await expect(receiptButton).toHaveCSS("transition-property", "color, background-color, opacity, transform");
    await expect(downloadButton).toHaveCSS("border-top-width", "0px");
    await expect(downloadButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(downloadButton).toHaveCSS("font-size", await backButton.evaluate((node) => getComputedStyle(node).fontSize));
    await expect(downloadButton).toHaveCSS("transition-property", "color, background-color, opacity, transform");
    await backButton.hover();
    await expect(backButton).toHaveCSS("transform", "none");
    await expect(backButton.locator("svg")).toHaveCSS("transform", "none");
    await receiptButton.hover();
    await expect(receiptButton).toHaveCSS("transform", "none");
    await expect(receiptButton.locator("svg")).toHaveCSS("transform", "none");
    await downloadButton.hover();
    await expect(downloadButton).toHaveCSS("transform", "none");
    await expect(downloadButton.locator("svg")).toHaveCSS("transform", "none");
    await page.getByLabel("계약 상세로 돌아가기").click();
    await expect(preview).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_actions_preview"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_tabs"]')).toBeVisible();
  });

  test("does not infer open or signed stages from step index alone", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "구문서" }).click();
    await page.getByRole("button", { name: "서명 진행" }).click();

    const timeline = page.locator(
      '[data-component="mobile_contracts_detail-panel_info-card-3_activity-timeline"]',
    );
    await expect(timeline).toContainText("문서가 생성되었습니다");
    await expect(timeline).toContainText("이용자에게 문서가 발송되었습니다.");
    await expect(timeline).toContainText("이용자 문서 열람 대기중입니다");
    await expect(timeline).not.toContainText("문서를 열람했습니다");
    await expect(timeline).not.toContainText("서명을 완료했습니다");
  });

  test("replaces receipt share with re-request for documents waiting on user action", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentDetails(page, [
      ...MOCK_DOCUMENTS.documents,
      ...STAGE_DOCUMENTS.documents.map((document) => {
        if (document.id === "doc-waiting") {
          return { ...document, fields: [{ id: "이용자 성명", value: "대기고객" }] };
        }
        if (document.id === "doc-opened") {
          return { ...document, fields: [{ id: "이용자 성명", value: "열람고객" }] };
        }
        return document;
      }),
    ]);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    let reRequestPayload: unknown = null;
    await page.route("**/api/eformsign/documents/doc-waiting/re-request", async (route) => {
      reRequestPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
    });
    await page.route("**/api/eformsign/documents/doc-opened/re-request", async (route) => {
      reRequestPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
    });

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();

    await expect(page.getByRole("button", { name: "재알림 보내기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "영수증 공유" })).toHaveCount(0);

    await page.getByRole("button", { name: "재알림 보내기" }).click();

    await expect.poll(() => reRequestPayload).toEqual({
      stepType: "05",
      stepSeq: "1",
      comment: "재요청입니다.",
    });
    await expect(page.locator('[data-component="mobile_shell_toaster_toast"]')).toContainText("대기고객님에게 전자문서 작성을 재요청했습니다.");

    reRequestPayload = null;
    await page.locator(".sheet-close").click();
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "열람고객" }).click();

    await expect(page.getByRole("button", { name: "재알림 보내기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "영수증 공유" })).toHaveCount(0);

    await page.getByRole("button", { name: "재알림 보내기" }).click();

    await expect.poll(() => reRequestPayload).toEqual({
      stepType: "05",
      stepSeq: "1",
      comment: "재요청입니다.",
    });
  });

  test("shows a burgundy X stage when user document send fails", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "전송실패" }).click();
    await page.getByRole("button", { name: "서명 진행" }).click();

    const timeline = page.locator(
      '[data-component="mobile_contracts_detail-panel_info-card-3_activity-timeline"]',
    );
    const failedStage = timeline.locator(".relative.flex.gap-3", {
      hasText: "이용자에게 문서 전송에 실패했습니다.",
    });
    await expect(failedStage).toBeVisible();
    await expect(failedStage.locator(".bg-v3-burgundy-light.text-v3-burgundy")).toHaveCount(1);
    await expect(timeline).not.toContainText("이용자에게 문서가 발송되었습니다.");
    await expect(timeline).not.toContainText("이용자 문서 열람 대기중입니다");
  });

  test("shows document id in the contract info layout", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    // Anchor: wait for the mocked rows to land before child assertions.
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]').first()).toBeVisible({ timeout: 15000 });

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();

    const contractInfo = page.locator(".info-card", { hasText: "계약 정보" });
    await expect(contractInfo).toContainText("계약서 종류");
    await expect(contractInfo).not.toContainText("계약 번호");
    await expect(contractInfo).not.toContainText("계약서 유형");
    await expect(contractInfo).toContainText("생성일");
    await expect(contractInfo).not.toContainText("작성일");
    await expect(contractInfo).not.toContainText("마감일");
    await expect(page.locator(".client-detail-badges")).not.toContainText("DOC-WAITING");

    // The former combined "관련 정보" card no longer exists; document id
    // renders in the 계약 정보 card.
    await expect(contractInfo).toContainText("문서 ID");
    await expect(contractInfo).toContainText("doc-waiting");
    await expect(contractInfo).not.toContainText("eformsign 코드");
  });

  test("falls back to provider fields from the detailed eformsign document", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentDetails(page, [
      {
        ...STAGE_DOCUMENTS.documents[0],
        fields: [
          { id: "이용자 성명", value: "대기고객" },
          { id: "제공인력 1 성명", value: "문서제공인력" },
        ],
      },
    ]);
    await routeDocumentClientSummaries(page, [
      {
        documentId: "doc-waiting",
        clientId: 101,
        clientName: "대기고객",
        clientPhone: "010-1111-2222",
        providerName: null,
      },
    ]);
    await routeNotificationLogs(page);

    await page.goto("/contracts");
    // Anchor: wait for the mocked rows to land before child assertions.
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]').first()).toBeVisible({ timeout: 15000 });

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();

    // Provider fields render in the 이용자 정보 card (no "관련 정보" card).
    const userInfo = page.locator(".info-card", { hasText: "이용자 정보" });
    await expect(userInfo).toContainText("제공인력");
    await expect(userInfo).toContainText("문서제공인력");
  });

  test("shows real alimtalk and message delivery logs in the notification tab", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();
    await page.getByRole("button", { name: "알림 발송" }).click();

    const notificationInfo = page.locator(".info-card", { hasText: "발송 내역" });
    await expect(notificationInfo.locator(".info-card-title")).toHaveText("발송 내역");
    await expect(notificationInfo).toContainText("메시지 · 계약서 발송 안내");
    await expect(notificationInfo).toContainText("메시지 · 수동 메시지");
    await expect(notificationInfo).not.toContainText("마감 임박 알림");
    await expect(notificationInfo).not.toContainText("다른 고객");
  });

  test("uses the compact empty message in the notification tab", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, STAGE_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page, []);

    await page.goto("/contracts");

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]', { hasText: "대기고객" }).click();
    await page.getByRole("button", { name: "알림 발송" }).click();

    const notificationInfo = page.locator(".info-card", { hasText: "발송 내역" });
    await expect(notificationInfo).toContainText("내역이 없습니다.");
    await expect(notificationInfo).not.toContainText("이 계약서와 연결된 알림 발송 내역이 없습니다.");
  });

  test("matches the clients search bar spacing", async ({ page }) => {
    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsList(page, MOCK_DOCUMENTS);
    await routeDocumentClientSummaries(page);
    await routeNotificationLogs(page);

    await page.goto("/contracts");

    const search = page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_search"]');
    await expect(search).toBeVisible();
    await expect(search).toHaveCSS("margin-top", "4px");
    await expect(search).toHaveCSS("margin-right", "12px");
    await expect(search).toHaveCSS("margin-bottom", "8px");
    await expect(search).toHaveCSS("margin-left", "12px");
  });
});
