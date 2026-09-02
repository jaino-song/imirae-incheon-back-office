import { expect, test, type Page } from "@playwright/test";

import {
  DEFAULT_SERVICE_RECORD_TEMPLATE_IDS,
  routeContractsApi,
  type ContractListRequest,
  type ContractMockDocument,
  type RouteContractsApiOptions,
} from "./helpers/contracts-api-mock";
import { selectContractsSection } from "./helpers/contracts-ui";

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
  // Until 8601e809b the client joined the tier ids into templateId+templateMatch
  // itself. It now names the section and the server resolves the whitelist, so the
  // assertion is that the client sends the section and stops sending the template
  // filter at all — sending both would mean two sources of truth for one decision.
  test("names the section on document and status-count requests, and sends no template filter", async ({
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

    await expect.poll(() =>
      listRequests.some((request) => request.section === "maternity"),
    ).toBe(true);
    await expect.poll(() =>
      statusCountsRequests.some((request) => request.section === "maternity"),
    ).toBe(true);
    expect(listRequests.every((request) => request.templateId === null)).toBe(true);
    expect(statusCountsRequests.every((request) => request.templateId === null)).toBe(true);
  });

  test("excludes a tier template document from the maternal contracts section", async ({
    page,
  }) => {
    await routeContractsPage(page);

    await page.goto("/contracts");

    await expect(page.getByText("김산모 계약서")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("김산모 10회차 기록")).toHaveCount(0);
  });

  // The legacy single-id response no longer shapes any request — the server owns the
  // filter now. What it still decides is whether the 제공기록지 tab may query at all:
  // sectionFilterReady keeps that section inert on an installation with no configured
  // template, so the `templateIds ?? [templateId]` fallback is what stops a legacy
  // installation from being treated as unconfigured. Asserting the old request shape
  // here would only duplicate the section test above and prove nothing about that.
  test("keeps the 제공기록지 section usable on a legacy single-template installation", async ({
    page,
  }) => {
    const listRequests: ContractListRequest[] = [];
    await routeContractsPage(page, {
      omitTemplateIds: true,
      // A legacy installation knows exactly one 제공기록지 template, and its records
      // carry that id — so point the single configured id at the fixture's record.
      templateId: DEFAULT_SERVICE_RECORD_TEMPLATE_IDS[1],
      onListRequest: (request) => {
        listRequests.push(request);
      },
    });

    await page.goto("/contracts");

    await selectContractsSection(page, "제공기록지");

    // The section queried at all — that is what the fallback decides.
    await expect.poll(() =>
      listRequests.some((request) => request.section === "service-records"),
    ).toBe(true);
    // And the single configured id still classifies: the record belongs to this
    // section, the maternal contract does not.
    await expect(page.getByText("김산모 10회차 기록")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("김산모 계약서")).toHaveCount(0);
  });
});
