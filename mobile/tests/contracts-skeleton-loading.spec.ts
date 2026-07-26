import { expect, test, type Page } from '@playwright/test';

import {
  routeContractsApi,
  type ContractMockDocument,
} from './helpers/contracts-api-mock';

const FILTER_SKELETON_COUNT = 6;
const LOADING_ROW_COUNT = 9;

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
  ],
};

const MOCK_EMPTY_DOCUMENTS: { documents: ContractMockDocument[] } = {
  documents: [],
};

async function routeSharedContractDependencies(page: Page): Promise<void> {
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

  await page.route('**/api/eformsign-docs/client-names**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          documentId: 'doc-1',
          clientId: 1001,
          clientName: '홍길동',
          clientPhone: '010-0000-0001',
          providerName: '테스트 제공인력',
        },
        {
          documentId: 'doc-2',
          clientId: 1002,
          clientName: '김철수',
          clientPhone: '010-0000-0002',
          providerName: '테스트 제공인력',
        },
      ]),
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

test.describe('Contracts Page Skeleton Loading', () => {
  test('shows the current mobile loading shell while documents are pending', async ({ page }) => {
    let releaseAuth!: () => void;
    let releaseDocuments!: () => void;
    const authReady = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const documentsReady = new Promise<void>((resolve) => {
      releaseDocuments = resolve;
    });

    await page.route('**/api/access-token', async (route) => {
      await authReady;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsApi(page, {
      getDocuments: () => MOCK_DOCUMENTS.documents,
      beforeListResponse: async () => {
        await documentsReady;
      },
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');

    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_search"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_filters_pill"][data-loading="true"]')).toHaveCount(
      FILTER_SKELETON_COUNT,
    );
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_loading-row"]')).toHaveCount(
      LOADING_ROW_COUNT,
    );
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_load-more_placeholder"]')).toBeVisible();

    releaseAuth();
    releaseDocuments();

    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(2, {
      timeout: 15000,
    });
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_loading-row"]')).toHaveCount(0);
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_filters_pill"][data-loading="true"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_load-more_placeholder"]')).toHaveCount(0);
  });

  test('keeps the search and filter chrome visible after loading completes', async ({ page }) => {
    await page.route('**/api/access-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsApi(page, {
      getDocuments: () => MOCK_DOCUMENTS.documents,
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_row"]')).toHaveCount(2, {
      timeout: 15000,
    });

    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_search"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_filters"]')).toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_header"]')).toContainText('2건');
  });

  // NOTE (review follow-up, 2026-06-08): a dedicated documents-API error
  // state does not exist post-redesign (the old MuiAlert tests covered dead
  // UI). Observed current behavior on a hard documents 500: the eformsign
  // reauth path ends in a LOGOUT/login redirect — encode no test until the
  // intended failure UX is decided (tracked as a product/UX finding).

  test('shows the current empty-state copy when no contracts exist', async ({ page }) => {
    await page.route('**/api/access-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await routeContractsApi(page, {
      getDocuments: () => MOCK_EMPTY_DOCUMENTS.documents,
    });

    await routeSharedContractDependencies(page);

    await page.goto('/contracts');
    // The empty copy is scoped to the active section label ("산모 계약서" by default).
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_list-page_content_list-card_body_empty"]')).toContainText(
      '등록된 산모 계약서가 없습니다.',
      { timeout: 15000 },
    );
  });
});
