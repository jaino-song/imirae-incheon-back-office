import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { settingsApi } from "@/services/api";

import { ClientRegistrationPolicyDetail } from "../ClientRegistrationPolicyDetail";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
  },
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedSettingsApi = jest.mocked(settingsApi);

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ClientRegistrationPolicyDetail data-component="mobile_messages_settings_client-registration-policy-detail" />
    </QueryClientProvider>,
  );
}

describe("ClientRegistrationPolicyDetail", () => {
  beforeEach(() => {
    mockedSettingsApi.getClientRegistrationPolicy.mockReset();
    mockedSettingsApi.updateClientRegistrationPolicy.mockReset();
    mockedSettingsApi.getClientRegistrationPolicy.mockResolvedValue({
      clientAutoRegistration: false,
      greetingOnAutoRegistration: true,
    });
    mockedSettingsApi.updateClientRegistrationPolicy.mockImplementation(
      async (patch) => ({
        clientAutoRegistration: false,
        greetingOnAutoRegistration: true,
        ...patch,
      }),
    );
  });

  it("renders both switches and disables greeting messages while auto registration is off", async () => {
    renderDetail();

    const autoRegistration = await screen.findByRole("switch", {
      name: "eformsign 계약서 도착 시 고객 자동 등록",
    });
    const greeting = screen.getByRole("switch", {
      name: "자동 등록 시 인사 문자 발송",
    });

    await waitFor(() => {
      expect(autoRegistration).not.toBeChecked();
      expect(autoRegistration).not.toBeDisabled();
      expect(greeting).toBeChecked();
      expect(greeting).toBeDisabled();
    });
    expect(
      screen.getByText(
        "eformsign 계약서가 도착하거나 완결되면 산모를 고객 목록에 자동으로 등록합니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("자동 등록된 고객에게 인사 문자를 함께 발송합니다."),
    ).toBeInTheDocument();
  });

  it("sends a partial update when auto registration is toggled", async () => {
    renderDetail();

    const autoRegistration = await screen.findByRole("switch", {
      name: "eformsign 계약서 도착 시 고객 자동 등록",
    });
    await waitFor(() => expect(autoRegistration).not.toBeDisabled());
    fireEvent.click(autoRegistration);

    await waitFor(() => {
      expect(mockedSettingsApi.updateClientRegistrationPolicy).toHaveBeenCalledWith(
        { clientAutoRegistration: true },
        expect.anything(),
      );
    });
  });
});
