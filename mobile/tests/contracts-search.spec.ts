import { expect, test, type Page } from '@playwright/test';

import {
  routeContractsApi,
  type ContractListRequest,
  type ContractMockDocument,
} from './helpers/contracts-api-mock';

const SEARCH_PLACEHOLDER = '고객명, 문서명, 문서 번호 검색';

const MOCK_DOCUMENTS: { documents: ContractMockDocument[] } = {
  documents: [
    {
      id: 'doc-1',
      document_number: 'DOC-001',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길동 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now(),
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now(),
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길동' }],
      },
    },
    {
      id: 'doc-2',
      document_number: 'DOC-002',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '김철수 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 86_400_000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 86_400_000,
      current_status: {
        status_type: '002',
        step_recipients: [{ recipient_type: 'signer', name: '김철수' }],
      },
    },
    {
      id: 'doc-3',
      document_number: 'DOC-003',
      template: { id: 'tpl-1', name: 'Contract' },
      document_name: '홍길순 계약서',
      creator: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      created_date: Date.now() - 172_800_000,
      last_editor: { recipient_type: 'sender', id: 'admin', name: 'Admin' },
      updated_date: Date.now() - 172_800_000,
      current_status: {
        status_type: '003',
        step_recipients: [{ recipient_type: 'signer', name: '홍길순' }],
      },
    },
  ],
};

const MOCK_EMPTY_DOCUMENTS: { documents: ContractMockDocument[] } = {
  documents: [],
};

async function routeContractsList(
  page: Page,
  payload = MOCK_DOCUMENTS,
  onListRequest?: (request: ContractListRequest) => void,
): Promise<void> {
  // Mock the auth identity so the run doesn't depend on the backend having
  // the storage-state user (local dev DBs lack it; the auth check otherwise
  // races the test and kills the page at a random point).
  for (const authPattern of ['**/api/auth/me', '**/auth/me']) {
    await page.route(authPattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user',
          name: '테스트 사용자',
          email: 'test@example.com',
          profile_image: '',
          role: 'admin',
          branchId: 'e2e-branch',
          branchName: 'E2E Branch',
        }),
      });
    });
  }

  await page.route('**/api/access-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await routeContractsApi(page, {
    getDocuments: () => payload.documents,
    onListRequest,
  });

  await page.route('**/api/eformsign-docs/client-names**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        payload.documents.map((doc, index) => ({
          documentId: doc.id,
          clientId: 1000 + index,
          clientName: doc.current_status?.step_recipients?.[0]?.name ?? doc.document_name,
          clientPhone: '010-0000-0000',
          providerName: '테스트 제공인력',
        })),
      ),
    });
  });

  await page.route('**/api/message-logs?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

// The contract list rows ([data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]) only mount
// in the mobile layout — at the default desktop viewport the row tree is
// absent (run #7 evidence: page renders, row count stays 0).
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Contracts Page Search Feature', () => {
  test('renders the current mobile search and filter shell', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_search"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_filters"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_header_action"]')).toContainText(
      '계약 작성',
    );
  });

  test('filters contract rows by customer name as the query changes', async ({ page }) => {
    const listRequests: ContractListRequest[] = [];
    await routeContractsList(page, MOCK_DOCUMENTS, (request) => {
      listRequests.push(request);
    });

    await page.goto('/contracts');
    const searchField = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(searchField).toBeVisible({ timeout: 15000 });

    // Anchor on the mocked rows landing before exercising the search.
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(3, {
      timeout: 15000,
    });
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();

    await searchField.fill('홍길');

    await expect.poll(() =>
      listRequests.some(
        (request) =>
          request.search === '홍길'
          && request.limit === 9
          && request.skip === 0
          && request.excludeDeleted
          && request.section === 'maternity',
      ),
    ).toBe(true);
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
    await expect(page.getByText('김철수')).not.toBeVisible();
  });

  test('restores the full list when the search query is cleared', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    const searchField = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(searchField).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(3, {
      timeout: 15000,
    });

    await searchField.fill('홍길동');
    await expect(page.getByText('김철수')).not.toBeVisible();

    await searchField.clear();

    await expect(page.getByText('홍길동')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('김철수')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
  });

  test('applies the completed filter via the mobile filter pills', async ({ page }) => {
    await routeContractsList(page);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(3, {
      timeout: 15000,
    });

    const completedFilter = page
      .locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_filters_pill"]')
      .filter({ hasText: '계약 완료' });
    await expect(completedFilter.locator('.count')).toHaveText('2');
    await completedFilter.click();

    await expect(completedFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('홍길순')).toBeVisible();
    await expect(page.getByText('김철수')).not.toBeVisible();
  });

  test('shows the current empty-state copy when no contracts match', async ({ page }) => {
    await routeContractsList(page, MOCK_EMPTY_DOCUMENTS);

    await page.goto('/contracts');
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible({ timeout: 15000 });

    // The empty copy is scoped to the active section label ("산모 계약서" by default).
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_empty"]')).toContainText(
      '등록된 산모 계약서가 없습니다.',
    );
  });
});
