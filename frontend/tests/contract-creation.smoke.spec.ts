import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";

interface SmokeClient {
  id: number;
  name: string;
}

interface SmokeEmployee {
  id: number;
  name: string;
}

interface VoucherPriceInfo {
  duration: string;
}

interface CreateDocRecordBody {
  documentId?: string;
}

const REAL_TENANT_SKIP_MESSAGE = "Set RUN_SMOKE_TESTS=1 to run real-tenant smoke tests";
const REAL_SEND_SUCCESS_TITLE = "계약서가 성공적으로 생성되었습니다.";
const CONTRACT_ROW_CONTENT = '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item_content"]';
const EFORMSIGN_GATE_TIMEOUT_MS = 60_000;
const EFORMSIGN_GATE_POLL_MS = 500;
const EFORMSIGN_READY_TEXT = "필수 입력 항목을 모두 작성했습니다.";
const REQUEST_SEND_DIALOG_SELECTOR = "#requestWithInputCommentPopup";

let createdDocumentId: string | null = null;

function formatIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function skipSmoke(message: string): never {
  test.skip(true, message);
  throw new Error(`unreachable after skip: ${message}`);
}

async function fetchJson<T>(page: Page, pathname: string): Promise<T> {
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await result.text();

    return {
      ok: result.ok,
      status: result.status,
      text,
    };
  }, pathname);

  if (!response.ok) {
    throw new Error(`Request to ${pathname} failed with ${response.status}: ${response.text}`);
  }

  return JSON.parse(response.text) as T;
}

async function cleanupCreatedDocument(page: Page, documentId: string): Promise<void> {
  const response = await page.evaluate(async (id) => {
    const result = await fetch("/api/eformsign/documents?is_permanent=true", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_ids: [id],
      }),
    });

    const text = await result.text();

    return {
      ok: result.ok,
      status: result.status,
      text,
    };
  }, documentId);

  expect(response.ok, `cleanup failed for ${documentId}: ${response.status} ${response.text}`).toBeTruthy();
}

async function selectClient(page: Page, client: SmokeClient): Promise<void> {
  const trigger = page.locator('[data-component="clients-autocomplete-input"]');
  await trigger.click();

  const dropdown = page.locator('[data-component="clients-autocomplete-dropdown"]');
  await expect(dropdown).toBeVisible();

  await dropdown.locator("input").fill(client.name);

  const option = dropdown.getByText(client.name, { exact: true }).first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(trigger).toContainText(client.name);
}

async function selectFirstDocType(page: Page): Promise<string> {
  const trigger = page.locator('[data-component="contract-creation-doc-type-trigger"]');
  await trigger.click();

  const firstOption = page.locator('[data-component="contract-creation-doc-type-option"]').first();
  await expect(firstOption).toBeVisible();

  const label = (await firstOption.textContent())?.trim();
  if (!label) {
    throw new Error("contract doc type dropdown rendered without visible text");
  }

  await firstOption.click();
  await expect(trigger).toContainText(label);

  return label;
}

async function selectEmployee(page: Page, employee: SmokeEmployee): Promise<void> {
  const autocomplete = page.getByTestId("employee-autocomplete").first();
  const trigger = autocomplete.locator('[data-component="employee-autocomplete-input"]');
  await trigger.click();

  const dropdown = page.locator('[data-component="employee-autocomplete-dropdown"]');
  await expect(dropdown).toBeVisible();

  const option = dropdown.getByText(employee.name, { exact: true }).first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(trigger).toContainText(employee.name);
}

async function findVoucherYear(page: Page): Promise<number | null> {
  const availableYears = await fetchJson<number[]>(page, "/api/voucher-price-infos/years");
  const candidateYears = [2026, ...availableYears.filter((year) => year !== 2026)];

  for (const year of candidateYears) {
    const search = new URLSearchParams({
      type: "A가1형",
      year: String(year),
    });
    const prices = await fetchJson<VoucherPriceInfo[]>(
      page,
      `/api/voucher-price-infos/type?${search.toString()}`
    );

    if (prices.some((price) => price.duration === "10")) {
      return year;
    }
  }

  return null;
}

async function fillVoucherStep(page: Page, voucherYear: number): Promise<void> {
  const selects = page.locator('[data-component="stepped-wizard-step-content"] select');

  await selects.nth(0).selectOption(String(voucherYear));
  await selects.nth(1).selectOption("A가1형");

  await expect.poll(async () => selects.count()).toBe(3);
  await selects.nth(2).selectOption("10");
}

async function fillContractDates(page: Page): Promise<void> {
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  const startDate = addDays(baseDate, 7);
  const endDate = addDays(startDate, 14);
  const paymentDate = addDays(startDate, 3);

  const inputs = page.getByPlaceholder("YYYY-MM-DD");
  await inputs.nth(0).fill(formatIsoDate(startDate));
  await inputs.nth(1).fill(formatIsoDate(endDate));
  await inputs.nth(2).fill(formatIsoDate(paymentDate));
}

async function waitForContractsListReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item_content"]')) ||
      document.body.innerText.includes("계약 문서가 없습니다"),
    null,
    { timeout: 30_000 }
  );
}

async function findVisibleLocator(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

async function getEformsignGateSnapshot(eformsignFrame: FrameLocator): Promise<{
  visibleButtons: string[];
  guideButtonLabel: string | null;
  footerMessages: string[];
  requestSendDialogVisible: boolean;
}> {
  return eformsignFrame.locator("body").evaluate(
    (body, { readyText, requestDialogSelector }) => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const visibleButtons = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
        .filter((button) => isVisible(button))
        .map((button) => normalize(button.innerText))
        .filter(Boolean);

      const footerMessages = Array.from(body.querySelectorAll<HTMLElement>("*"))
        .filter((element) => isVisible(element))
        .map((element) => normalize(element.innerText))
        .filter((text) => text.includes(readyText) || text.startsWith("필수 입력 항목("));

      const guideButton = body.querySelector<HTMLElement>("#guideBtn");
      const requestSendDialog = body.querySelector<HTMLElement>(requestDialogSelector);

      return {
        visibleButtons: Array.from(new Set(visibleButtons)),
        guideButtonLabel: isVisible(guideButton) ? normalize(guideButton.innerText) : null,
        footerMessages: Array.from(new Set(footerMessages)).slice(0, 5),
        requestSendDialogVisible: isVisible(requestSendDialog),
      };
    },
    {
      readyText: EFORMSIGN_READY_TEXT,
      requestDialogSelector: REQUEST_SEND_DIALOG_SELECTOR,
    }
  );
}

async function runEformsignCreationGates(
  page: Page,
  eformsignFrame: FrameLocator,
  hasSeenSuccessModal: () => boolean
): Promise<"success-modal" | "request-send-clicked"> {
  const deadline = Date.now() + EFORMSIGN_GATE_TIMEOUT_MS;
  let lastAction = "none";

  while (Date.now() < deadline) {
    if (hasSeenSuccessModal()) {
      return "success-modal";
    }

    const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);
    const confirmButton = await findVisibleLocator(eformsignFrame.getByRole("button", { name: "확인" }));
    if (confirmButton) {
      console.log("[smoke][eformsign] clicked 회사 도장 확인");
      await confirmButton.click();
      lastAction = "clicked 회사 도장 확인";
      await page.waitForTimeout(250);
      continue;
    }

    const requestSendButton = await findVisibleLocator(
      requestSendDialog.getByRole("button", { name: "전송" })
    );
    if (requestSendButton) {
      console.log("[smoke][eformsign] clicked 문서 전송 dialog 전송");
      await requestSendButton.click();
      return "request-send-clicked";
    }

    const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
    const topLevelSendButton = requestSendDialogVisible
      ? null
      : await findVisibleLocator(eformsignFrame.getByRole("button", { name: "전송" }));
    if (topLevelSendButton) {
      console.log("[smoke][eformsign] clicked top-level 전송");
      await topLevelSendButton.click();
      lastAction = "clicked top-level 전송";
      await page.waitForTimeout(250);
      continue;
    }

    const nextButton = await findVisibleLocator(eformsignFrame.getByRole("button", { name: "다음" }));
    if (nextButton) {
      console.log("[smoke][eformsign] clicked 다음");
      await nextButton.click();
      lastAction = "clicked 다음";
      await page.waitForTimeout(250);
      continue;
    }

    const startButton = await findVisibleLocator(
      eformsignFrame.getByRole("button", { name: "입력 시작" })
    );
    if (startButton) {
      console.log("[smoke][eformsign] clicked 입력 시작");
      await startButton.click();
      lastAction = "clicked 입력 시작";
      await page.waitForTimeout(250);
      continue;
    }

    const readyMessage = await findVisibleLocator(
      eformsignFrame.getByText(EFORMSIGN_READY_TEXT, { exact: true })
    );
    if (readyMessage) {
      await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
      continue;
    }

    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
  }

  const snapshot = await getEformsignGateSnapshot(eformsignFrame);
  throw new Error(
    `Timed out after ${EFORMSIGN_GATE_TIMEOUT_MS}ms while advancing eformsign creation gates. ` +
      `Last action: ${lastAction}. Snapshot: ${JSON.stringify(snapshot)}`
  );
}

test.describe.serial("contract creation smoke (real tenant)", () => {
  test.skip(!process.env.RUN_SMOKE_TESTS, REAL_TENANT_SKIP_MESSAGE);
  test.setTimeout(120_000);

  test.afterEach(async ({ page }) => {
    if (!createdDocumentId) {
      return;
    }

    await cleanupCreatedDocument(page, createdDocumentId);
    createdDocumentId = null;
  });

  test("creates a real contract end-to-end and the new doc appears in the list", async ({ page }) => {
    createdDocumentId = null;

    await page.goto("/contracts");

    if (page.url().includes("/login")) {
      throw new Error("expected /contracts with globalSetup auth, but the app redirected to /login");
    }

    await expect(page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]')).toBeVisible();
    await waitForContractsListReady(page);

    const clients = await fetchJson<SmokeClient[]>(page, "/api/clients");
    const selectedClient = clients[0] ?? skipSmoke("no clients in dev tenant");

    const employees = await fetchJson<SmokeEmployee[]>(page, "/api/employees");
    const selectedEmployee = employees[0] ?? skipSmoke("no employees in dev tenant");

    const voucherYear = await findVoucherYear(page);
    const usableVoucherYear = voucherYear ?? skipSmoke("no voucher price for A가1형 / 10일 in dev tenant");

    const initialDocumentCount = await page.locator(CONTRACT_ROW_CONTENT).count();

    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]').click();
    await expect(page.locator('[data-component="contract-creation-form"]')).toBeVisible();

    await selectClient(page, selectedClient);
    await selectFirstDocType(page);
    await page.getByTestId("contract-creation-next").click();

    await selectEmployee(page, selectedEmployee);
    await page.getByTestId("contract-creation-next").click();

    await fillVoucherStep(page, usableVoucherYear);
    await page.getByTestId("contract-creation-next").click();

    await fillContractDates(page);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();

    const createDocRecordRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/eformsign-docs"),
      { timeout: 60_000 }
    );
    let successModalSeen = false;
    const successModal = page.locator('[data-component="contract-creation-success-notification"]');
    const successModalPromise = expect(successModal)
      .toBeVisible({ timeout: EFORMSIGN_GATE_TIMEOUT_MS })
      .then(() => {
        successModalSeen = true;
      });

    await page.getByTestId("contract-creation-submit").click();

    await page.waitForFunction(
      () => {
        const frame = document.getElementById("eformsign_iframe");
        return Boolean(
          frame &&
            frame instanceof HTMLIFrameElement &&
            frame.src.startsWith("https://www.eformsign.com/")
        );
      },
      null,
      { timeout: 30_000 }
    );

    const iframeSrcBeforeSend = await page.locator("iframe#eformsign_iframe").getAttribute("src");
    const eformsignFrame = page.frameLocator("iframe#eformsign_iframe");
    const gateLoopPromise = runEformsignCreationGates(page, eformsignFrame, () => successModalSeen);
    const firstResolved = await Promise.race([
      successModalPromise.then(() => ({ type: "modal" as const })),
      gateLoopPromise.then((terminalState) => ({ type: "gate" as const, terminalState })),
    ]);
    if (firstResolved.type === "gate") await successModalPromise;

    await expect(successModal).toContainText(REAL_SEND_SUCCESS_TITLE);
    await successModal.getByRole("button", { name: "확인" }).click();
    await gateLoopPromise;

    const createDocRecordRequest = await createDocRecordRequestPromise;
    const createDocRecordBody = createDocRecordRequest.postDataJSON() as CreateDocRecordBody;
    createdDocumentId = createDocRecordBody.documentId ?? null;

    if (!createdDocumentId && iframeSrcBeforeSend) {
      createdDocumentId = new URL(iframeSrcBeforeSend).searchParams.get("document_id");
    }

    if (!createdDocumentId) {
      throw new Error("contract creation succeeded but no documentId was captured for cleanup");
    }

    await expect
      .poll(async () => page.locator(CONTRACT_ROW_CONTENT).count(), { timeout: 30_000 })
      .toBe(initialDocumentCount + 1);
  });
});
