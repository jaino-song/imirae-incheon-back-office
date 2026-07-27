import { expect, test, type Page } from "@playwright/test";

import {
  DEFAULT_SERVICE_RECORD_TEMPLATE_IDS,
  routeContractsApi,
  type ContractListRequest,
  type ContractMockDocument,
  type RouteContractsApiOptions,
} from "./helpers/contracts-api-mock";

const MATERNAL_DOCUMENT: ContractMockDocument = {
  id: "maternal-contract",
  document_number: "CONTRACT-001",
  document_name: "김산모 계약서",
  template: { id: "maternal-template", name: "산모신생아 계약서" },
  created_date: Date.now(),
  current_status: {
    status_type: "003",
    step_recipients: [{ recipient_type: "signer", name: "김산모" }],
  },
};

const TIER_SERVICE_RECORD_DOCUMENT: ContractMockDocument = {
  id: "tier-service-record",
  document_number: "RECORD-010",
  document_name: "김산모 10회차 기록",
  template: {
    id: DEFAULT_SERVICE_RECORD_TEMPLATE_IDS[1],
    name: "산모신생아 건강관리 10회차",
  },
  created_date: Date.now() - 1_000,
  current_status: {
    status_type: "003",
    step_recipients: [{ recipient_type: "signer", name: "김산모" }],
  },
};

async function routeContractsPage(
  page: Page,
  options: Omit<RouteContractsApiOptions, "getDocuments"> = {},
): Promise<void> {
  for (const authPattern of ["**/api/auth/me", "**/auth/me"]) {
    await page.route(authPattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test-user",
          name: "테스트 사용자",
          email: "test@example.com",
          role: "admin",
          branchId: "e2e-branch",
          branchName: "E2E Branch",
        }),
      });
    });
  }

  await page.route("**/api/access-token", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  const documents = [MATERNAL_DOCUMENT, TIER_SERVICE_RECORD_DOCUMENT];
  await routeContractsApi(page, {
    getDocuments: () => documents,
    ...options,
  });

  await page.route("**/api/eformsign-docs/client-names**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        documents.map((document) => ({
          documentId: document.id,
          clientName: document.document_name,
        })),
      ),
    });
  });

  await page.route("**/api/message-logs?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("contracts service-record template filters", () => {
  test("joins every configured template id for document and status-count requests", async ({
    page,
  }) => {
    const listRequests: ContractListRequest[] = [];
    const statusCountsRequests: ContractListRequest[] = [];
    await routeContractsPage(page, {
      onListRequest: (request) => {
        listRequests.push(request);
      },
      onStatusCountsRequest: (request) => {
        statusCountsRequests.push(request);
      },
    });

    await page.goto("/contracts");

    const joinedTemplateIds = DEFAULT_SERVICE_RECORD_TEMPLATE_IDS.join(",");
    await expect.poll(() =>
      listRequests.some(
        (request) =>
          request.templateId === joinedTemplateIds
          && request.templateMatch === "exclude",
      ),
    ).toBe(true);
    await expect.poll(() =>
      statusCountsRequests.some(
        (request) =>
          request.templateId === joinedTemplateIds
          && request.templateMatch === "exclude",
      ),
    ).toBe(true);
  });

  test("excludes a tier template document from the maternal contracts section", async ({
    page,
  }) => {
    await routeContractsPage(page);

    await page.goto("/contracts");

    await expect(page.getByText("김산모 계약서")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("김산모 10회차 기록")).toHaveCount(0);
  });

  test("falls back to the legacy single template id response", async ({ page }) => {
    const listRequests: ContractListRequest[] = [];
    const statusCountsRequests: ContractListRequest[] = [];
    await routeContractsPage(page, {
      omitTemplateIds: true,
      onListRequest: (request) => {
        listRequests.push(request);
      },
      onStatusCountsRequest: (request) => {
        statusCountsRequests.push(request);
      },
    });

    await page.goto("/contracts");

    await expect.poll(() =>
      listRequests.some(
        (request) =>
          request.templateId === DEFAULT_SERVICE_RECORD_TEMPLATE_IDS[0]
          && request.templateMatch === "exclude",
      ),
    ).toBe(true);
    await expect.poll(() =>
      statusCountsRequests.some(
        (request) =>
          request.templateId === DEFAULT_SERVICE_RECORD_TEMPLATE_IDS[0]
          && request.templateMatch === "exclude",
      ),
    ).toBe(true);
  });
});
