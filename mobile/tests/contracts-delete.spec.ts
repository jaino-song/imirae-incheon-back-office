import { expect, test, type Page } from "@playwright/test";

import {
  routeContractsApi,
  type ContractMockDocument,
} from "./helpers/contracts-api-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
  });
});

test.describe("Contracts delete flow", () => {
  test("opens confirm modal, supports cancel, and deletes selected contract", async ({ page }) => {
    const targetId = "doc-delete-target";

    let documents: ContractMockDocument[] = [
      {
        id: targetId,
        document_number: "DOC-DEL-001",
        template: { id: "tpl-1", name: "Contract" },
        document_name: "삭제 대상 계약서",
        creator: { recipient_type: "sender", id: "admin", name: "Admin" },
        created_date: Date.now(),
        last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
        updated_date: Date.now(),
        fields: [{ id: "이용자 성명", value: "삭제대상 고객" }],
        current_status: {
          status_type: "002",
          step_recipients: [{ recipient_type: "signer", name: "삭제대상 고객" }],
        },
      },
      {
        id: "doc-keep-1",
        document_number: "DOC-KEEP-001",
        template: { id: "tpl-1", name: "Contract" },
        document_name: "유지 계약서",
        creator: { recipient_type: "sender", id: "admin", name: "Admin" },
        created_date: Date.now() - 86_400_000,
        last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
        updated_date: Date.now() - 86_400_000,
        fields: [{ id: "이용자 성명", value: "유지고객" }],
        current_status: {
          status_type: "002",
          step_recipients: [{ recipient_type: "signer", name: "유지고객" }],
        },
      },
    ];

    let deleteRequestCount = 0;

    await routeContractsDependencies(page, () => documents);
    await routeContractsApi(page, {
      getDocuments: () => documents,
    });

    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route("**/api/eformsign/documents**", async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());

      if (method === "DELETE") {
        deleteRequestCount += 1;

        const body = route.request().postDataJSON() as { document_ids?: string[] };
        const deletedId = body.document_ids?.[0];
        expect(deletedId).toBe(targetId);

        documents = documents.filter((doc) => doc.id !== deletedId);

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            api_ver: "2.0",
            result: {
              success_result: [deletedId],
              fail_result: [],
            },
          }),
        });
        return;
      }

      if (method === "GET" && url.pathname.includes("/download_files")) {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
        });
        return;
      }

      if (method === "GET") {
        const documentId = /^\/api\/eformsign\/documents\/([^/]+)$/.exec(url.pathname)?.[1];
        if (documentId && documentId !== "status-counts") {
          const doc = documents.find((item) => item.id === documentId);
          await route.fulfill({
            status: doc ? 200 : 404,
            contentType: "application/json",
            body: JSON.stringify(doc ?? { error: "Not found" }),
          });
          return;
        }
      }

      await route.fallback();
    });

    await page.goto("/contracts");
    await expect(page.getByText("삭제대상 고객").first()).toBeVisible({ timeout: 15000 });

    await page.getByText("삭제대상 고객").first().click();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content"]')).toBeVisible();

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_header_menu-trigger"]').click();
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_header_menu_delete"]').click();
    const deleteModal = page.locator('[data-component="mobile_contracts_delete-confirmation_modal"]');
    await expect(deleteModal).toBeVisible();
    await expect(deleteModal.getByRole("heading", { name: "계약서 삭제" })).toBeVisible();
    await expect(
      deleteModal.getByText("전자문서가 취소되어 수신자가 더 이상 서명할 수 없습니다. 복구할 수 없습니다."),
    ).toBeVisible();

    await page.locator('[data-component="mobile_contracts_delete-confirmation_modal_actions"]').getByRole("button", { name: "취소" }).click();
    await expect(page.locator('[data-component="mobile_contracts_delete-confirmation_modal"]')).not.toBeVisible();
    expect(deleteRequestCount).toBe(0);

    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_header_menu-trigger"]').click();
    await page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page_content_header_menu_delete"]').click();
    await page.locator('[data-component="mobile_contracts_delete-confirmation_modal_actions"]').getByRole("button", { name: "삭제" }).click();

    await expect.poll(() => deleteRequestCount).toBe(1);
    await expect(page.locator('[data-component="mobile_shell_toaster_toast"]')).toContainText("삭제대상 고객 계약서를 삭제했습니다.");
    await expect(page.getByText("삭제대상 고객")).not.toBeVisible();
    await expect(page.locator('[data-component="mobile_contracts_detail-sheet_stack_detail-page"]')).toHaveAttribute("aria-hidden", "true");
  });
});

async function routeContractsDependencies(
  page: Page,
  getDocuments: () => Array<{
    id: string;
    current_status?: {
      step_recipients?: Array<{ name?: string }>;
    };
  }>,
) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-user",
        name: "E2E Tester",
        email: "e2e@example.com",
        role: "admin",
        branchId: "e2e-branch",
        branchName: "E2E Branch",
      }),
    });
  });

  await page.route("**/api/eformsign-docs/client-names**", async (route) => {
    const summaries = getDocuments().map((doc, index) => {
      const clientName = doc.current_status?.step_recipients?.[0]?.name ?? "고객";
      return {
        documentId: doc.id,
        clientId: 9000 + index,
        clientName,
        clientPhone: "010-0000-0000",
        providerName: "테스트 제공자",
      };
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summaries),
    });
  });

  await page.route("**/api/message-logs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}
