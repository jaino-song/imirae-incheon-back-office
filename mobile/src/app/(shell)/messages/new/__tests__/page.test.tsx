import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "../page";
import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

const FORM_CARD_CONTENT =
  "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content";

const mockPush = jest.fn();
const mockUseAllClients = jest.fn();
const mockUseSystemTemplate = jest.fn();
const mockGetMessageSenderApproval = jest.fn();
const mockUseBankAccountInfos = jest.fn();
const mockUseVoucherPriceInfos = jest.fn();
const mockClipboardWriteText = jest.fn();
let mockSearchParams = new URLSearchParams();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mockClipboardWriteText },
  });
});

const mockClients: Client[] = [
  {
    id: 7,
    name: "박서연",
    createdAt: null,
    updatedAt: null,
    birthday: null,
    dueDate: null,
    address: "인천 연수구",
    phone: "01077778888",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: "A통합-2형",
    duration: 10,
    fullPrice: "2196000",
    grant: "1734000",
    actualPrice: "462000",
    startDate: "2026-06-10T00:00:00.000Z",
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: null,
    eDocId: null,
    areaId: "Seogu",
    hasSigned: false,
    documentStatus: null,
  },
];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => mockUseAllClients(),
}));

jest.mock("@/hooks", () => ({
  useBankAccountInfos: () => mockUseBankAccountInfos(),
  useVoucherPriceInfos: (type: string, year?: number) => mockUseVoucherPriceInfos(type, year),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: () => mockGetMessageSenderApproval(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NewMessagePage />
    </QueryClientProvider>,
  );
}

async function addManualRecipient(value: string) {
  const receiverInput = screen.getByLabelText(/휴대 전화번호/);

  fireEvent.focus(receiverInput);
  fireEvent.change(receiverInput, { target: { value } });
  fireEvent.keyDown(receiverInput, { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /수신자 제거/ })).toBeInTheDocument();
  });
}

async function openTemplateSelect() {
  const trigger = screen.getByRole("combobox", { name: /템플릿 선택/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("option", { name: "인사 메시지" });
}

describe("NewMessagePage", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockGetMessageSenderApproval.mockReset();
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "approved",
      isApproved: true,
      canRequest: true,
      requestedAt: "2026-06-04T00:00:00.000Z",
      approvedAt: "2026-06-04T00:00:00.000Z",
    });
    mockUseAllClients.mockReset();
    mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });
    mockUseBankAccountInfos.mockReset();
    mockUseBankAccountInfos.mockReturnValue({
      data: [
        { area: "Seogu", bankName: "농협은행", accNum: "351-1268-7728-43" },
        { area: "Namdonggu", bankName: "농협은행", accNum: "171777-52-129984" },
      ],
      isLoading: false,
    });
    mockUseVoucherPriceInfos.mockReset();
    mockUseVoucherPriceInfos.mockImplementation((type: string) => ({
      data: type
        ? [
          {
            id: 13,
            type,
            duration: "10",
            fullPrice: "2196000",
            grant: "1734000",
            actualPrice: "462000",
          },
          {
            id: 14,
            type,
            duration: "15",
            fullPrice: "2848000",
            grant: "2114000",
            actualPrice: "734000",
          },
        ]
        : [],
      isLoading: false,
    }));
    mockUseSystemTemplate.mockReset();
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "GREETING") {
        return {
          data: {
            id: "system-greeting",
            templateKey: "GREETING",
            name: "인사 메시지",
            description: "고객 인사 메시지",
            content: "안녕하세요, 인천 아이미래로 입니다 :)",
            requiredVariables: [],
            customVariables: [],
            updatedAt: "2026-06-04T00:00:00.000Z",
          },
        };
      }

      if (key === "SERVICE_INFO") {
        return {
          data: {
            id: "system-service-info",
            templateKey: "SERVICE_INFO",
            name: "서비스 안내",
            description: "서비스 안내 메시지",
            content: "{{name}} 산모님~♡\n서비스 시작일: {{serviceDate}}\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
            requiredVariables: [
              {
                key: "name",
                label: "산모명",
                type: "string",
                required: true,
              },
              {
                key: "serviceDate",
                label: "서비스 시작일",
                type: "string",
                required: true,
              },
            ],
            customVariables: [],
            updatedAt: "2026-06-04T00:00:00.000Z",
          },
        };
      }

      return { data: null };
    });
    (api.post as jest.Mock).mockReset();
    (api.post as jest.Mock).mockResolvedValue({ data: { result: { resultCode: 1, errorCount: 0 } } });
    mockClipboardWriteText.mockReset();
    mockClipboardWriteText.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();
  });

  it("refreshes route-provided message body when search params change in place", () => {
    mockSearchParams = new URLSearchParams({
      body: "첫 번째 템플릿 본문",
      template: "service-start-d-1",
    });

    const { rerender } = renderPage();
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("첫 번째 템플릿 본문");

    mockSearchParams = new URLSearchParams({
      body: "두 번째 템플릿 본문",
      template: "visit-change",
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("메시지 본문")).toHaveValue("두 번째 템플릿 본문");
  });

  it("shows the message section navigation without a back button", () => {
    const { container } = renderPage();
    const listCard = container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card"]');

    expect(screen.getByRole("button", { name: "전송하기" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(listCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_header"]'),
    );
    expect(listCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body"]'),
    );
    expect(screen.getByText("새 메시지")).toHaveClass("list-title-text");
    expect(container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_header"]')).toContainElement(
      screen.getByRole("button", { name: "즉시 발송" }),
    );
    expect(screen.queryByRole("button", { name: "메시지 목록으로 돌아가기" }))
      .not.toBeInTheDocument();
  });

  it("groups the recipient, template, variables, and body sections in one form card", () => {
    const { container } = renderPage();
    const formCards = container.querySelectorAll('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card"]');
    const formCard = formCards[0];

    expect(formCards).toHaveLength(1);
    expect(formCard?.firstElementChild).not.toHaveClass("p-6", "pt-0");
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient"]'),
    );
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template"]'),
    );
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body"]'),
    );
  });

  it("orders the send fields like the frontend form with template selection first", () => {
    const { container } = renderPage();
    const orderedSections = Array.from(
      container.querySelectorAll(
        '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body"]',
      ),
    ).map((element) => element.getAttribute("data-component"));

    expect(orderedSections).toEqual([
      `${FORM_CARD_CONTENT}_template`,
      `${FORM_CARD_CONTENT}_recipient`,
      `${FORM_CARD_CONTENT}_message-body`,
    ]);
    expect(screen.getByLabelText(/휴대 전화번호/)).toHaveAttribute("placeholder", "010-0000-0000");
    expect(screen.queryByLabelText(/산모님 성함/)).not.toBeInTheDocument();
  });

  it("submits new messages through the SMS channel", async () => {
    renderPage();

    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-1234-5678");
    fireEvent.change(bodyInput, { target: { value: "테스트 발송 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          msgType: "AUTO",
          receiver: "010-1234-5678",
        }),
      );
    });
  });

  it("restores the selected template body with empty variables after sending", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(screen.getByLabelText("메시지 본문")).toHaveValue(
        "{{name}} 산모님~♡\n서비스 시작일: {{serviceDate}}\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
      );
    });
  });

  it("excludes decimal client ids from the delivery payload", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "1.2" });

    renderPage();
    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-9999-0000");
    fireEvent.change(bodyInput, { target: { value: "본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.not.objectContaining({
          clientId: expect.anything(),
        }),
      );
    });
  });

  it("prefills the customer recipient from a valid client id", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "7" });

    renderPage();

    expect(await screen.findByRole("button", { name: "박서연 수신자 제거" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          receiver: "010-7777-8888",
          clientId: 7,
          recipientName: "박서연",
        }),
      );
    });
  });

  it("blocks submissions with more than 50 recipients", async () => {
    renderPage();

    const tooManyRecipients = Array.from({ length: 51 }, (_, index) => (
      `010-0000-${String(index + 1).padStart(4, "0")}`
    )).join(",");

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: tooManyRecipients } });
    fireEvent.keyDown(receiverInput, { key: "Enter" });

    expect(await screen.findByText("수신자는 한 번에 최대 50명까지 선택할 수 있습니다.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("adds an existing client recipient from autocomplete", async () => {
    renderPage();

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    const bodyInput = screen.getByLabelText("메시지 본문");

    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.change(bodyInput, { target: { value: "고객 선택 발송" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          receiver: "010-7777-8888",
          clientId: 7,
          recipientName: "박서연",
        }),
      );
    });
  });

  it("opens the recipient dropdown when the receiver input is clicked", () => {
    renderPage();

    fireEvent.click(screen.getByLabelText(/휴대 전화번호/));

    expect(
      screen.getByTestId(
        "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row_autocomplete_dropdown",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("박서연")).toBeInTheDocument();
  });

  it("starts with the greeting template selected by default", () => {
    renderPage();

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("인사 메시지");
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("안녕하세요, 인천 아이미래로 입니다 :)");
  });

  it("copies the current message body from the body header", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(mockClipboardWriteText).toHaveBeenCalledWith("안녕하세요, 인천 아이미래로 입니다 :)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables immediate send until a recipient is selected", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
  });

  it("does not show the draft save action", () => {
    renderPage();

    expect(screen.queryByRole("button", { name: "임시저장" })).not.toBeInTheDocument();
  });

  it("does not expose channel selection on the new message form", () => {
    renderPage();

    expect(screen.queryByText("채널")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "알림톡" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "SMS" })).not.toBeInTheDocument();
  });

  it("loads the greeting template from the template dropdown", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "인사 메시지" }));

    expect(screen.getByLabelText("메시지 본문")).toHaveValue("안녕하세요, 인천 아이미래로 입니다 :)");
  });

  it("includes the service information template in the template dropdown", async () => {
    const { container } = renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("서비스 안내");
    expect(screen.getByLabelText(/산모님 성함/)).toBeInTheDocument();
    expect(screen.getByLabelText(/서비스 시작일/)).toBeInTheDocument();
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row"]',
        ),
      ).map((element) => element.getAttribute("data-component")),
    ).toEqual([
      `${FORM_CARD_CONTENT}_recipient_name-row`,
      `${FORM_CARD_CONTENT}_recipient_row`,
    ]);

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });
    fireEvent.change(screen.getByLabelText(/서비스 시작일/), { target: { value: "2026. 06. 10." } });

    expect(screen.getByLabelText("메시지 본문")).toHaveValue(
      "김지니 산모님~♡\n서비스 시작일: 2026. 06. 10.\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
    );
  });

  it("uses the shared mobile input specification for message text fields", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    for (const input of [
      screen.getByLabelText(/휴대 전화번호/),
      screen.getByLabelText(/산모님 성함/),
      screen.getByLabelText(/서비스 시작일/),
    ]) {
      expect(input).toHaveAttribute("data-source-component", "Input");
      expect(input).toHaveClass(
        "h-[44px]",
        "rounded-[12px]",
        "border-[1.5px]",
        "px-[14px]",
        "py-0",
        "text-[0.9rem]",
      );
    }
  });

  it("includes the remaining frontend fallback templates in the template dropdown", async () => {
    renderPage();

    await openTemplateSelect();

    expect(screen.getByRole("option", { name: "정보 수집" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "금액 및 계좌번호" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "상담 후 리마인더" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "예약 완료" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "모니터링 설문" })).toBeInTheDocument();
  });

  it("loads a frontend fallback template that requires the client name variable", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "예약 완료" }));

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("예약 완료");
    expect(screen.getByLabelText(/산모님 성함/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });

    expect((screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value).toContain("김지니 산모님");
  });

  it("auto-fills price information variables from select controls", async () => {
    const { container } = renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "금액 및 계좌번호" }));

    expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "서비스 기간 *" })).toBeDisabled();
    expect(screen.queryByLabelText("서비스 주수")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("총 서비스 금액")).not.toBeInTheDocument();
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info"] > [data-template-variable-key]',
        ),
      ).map((element) => element.getAttribute("data-template-variable-key")),
    ).toEqual(["type", "duration", "bankAccount", "voucherYear"]);

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });

    fireEvent.keyDown(screen.getByRole("combobox", { name: "바우처 유형 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "A통합-2형" }));

    expect(screen.getByRole("combobox", { name: "서비스 기간 *" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "서비스 기간 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "10일" }));

    fireEvent.keyDown(screen.getByRole("combobox", { name: "지역 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /서구/ }));

    expect(screen.getByText("2,196,000")).toBeInTheDocument();
    expect(screen.getByText("462,000")).toBeInTheDocument();
    expect(screen.getByText("농협은행 351-1268-7728-43")).toBeInTheDocument();
    const bodyValue = (screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value;
    expect(bodyValue).toContain("출퇴근 2주");
    expect(bodyValue).toContain("평일기준 10일");
    expect(bodyValue).toContain("2,196,000원");
    expect(bodyValue).toContain("농협은행 351-1268-7728-43");
  });

  it("prefills price information variables and account from a selected client recipient", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "금액 및 계좌번호" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toBeInTheDocument();
    });

    const recipientNameInput = screen.getByLabelText(/산모님 성함/);
    const receiverInput = screen.getByLabelText(/휴대 전화번호/);

    expect(recipientNameInput).toHaveAttribute(
      "data-component",
      "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row_autocomplete_input",
    );
    expect(receiverInput).toHaveAttribute("data-component", `${FORM_CARD_CONTENT}_recipient_row_input`);

    fireEvent.focus(recipientNameInput);
    fireEvent.change(recipientNameInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));

    expect(recipientNameInput).toHaveValue("");
    expect(screen.queryByRole("button", { name: "선택 해제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "목록 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "박서연 수신자 제거" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toHaveTextContent("A통합-2형");
      expect((screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value).toContain("2,196,000원");
    });

    expect(screen.getByRole("combobox", { name: "지역 *" })).toHaveTextContent("서구");

    const bodyValue = (screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value;
    expect(bodyValue).toContain("박서연 산모님");
    expect(bodyValue).toContain("출퇴근 2주");
    expect(bodyValue).toContain("평일기준 10일");
    expect(bodyValue).toContain("A통합2형");
    expect(bodyValue).toContain("2,196,000원");
    expect(bodyValue).toContain("462,000원");
    expect(bodyValue).toContain("농협은행 351-1268-7728-43");

    fireEvent.click(screen.getByRole("button", { name: "박서연 수신자 제거" }));

    await waitFor(() => {
      expect(recipientNameInput).toHaveValue("");
      expect(screen.queryByRole("button", { name: "박서연 수신자 제거" })).not.toBeInTheDocument();
    });
  });

  it("prefills service information variables from a selected client recipient", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));

    expect(screen.getByLabelText(/산모님 성함/)).toHaveValue("박서연");
    expect(screen.getByLabelText(/서비스 시작일/)).toHaveValue("2026. 06. 10.");
    expect(screen.getByLabelText("메시지 본문")).toHaveValue(
      "박서연 산모님~♡\n서비스 시작일: 2026. 06. 10.\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
    );
  });

  it("sends long template messages as auto type with an LMS title", async () => {
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "SERVICE_INFO") {
        return { data: null };
      }

      if (key === "GREETING") {
        return {
          data: {
            id: "system-greeting",
            templateKey: "GREETING",
            name: "인사 메시지",
            description: "고객 인사 메시지",
            content: "안녕하세요, 인천 아이미래로 입니다. 산모님과 아기의 건강한 회복을 위해 서비스 안내를 드립니다.",
            requiredVariables: [],
            customVariables: [],
            updatedAt: "2026-06-04T00:00:00.000Z",
          },
        };
      }

      return { data: null };
    });

    renderPage();
    await addManualRecipient("010-1234-5678");
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          msgType: "AUTO",
          title: "인사 메시지",
        }),
      );
    });
  });
});
