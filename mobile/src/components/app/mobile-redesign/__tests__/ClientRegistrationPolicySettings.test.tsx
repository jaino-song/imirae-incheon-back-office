import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { settingsApi } from "@/services/api";
import { ClientRegistrationPolicySettings } from "../ClientRegistrationPolicySettings";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
  },
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockedSettingsApi = jest.mocked(settingsApi);

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ClientRegistrationPolicySettings /></QueryClientProvider>);
}

describe("ClientRegistrationPolicySettings", () => {
  beforeEach(() => {
    mockedSettingsApi.getClientRegistrationPolicy.mockResolvedValue({ clientAutoRegistration: true, greetingOnAutoRegistration: false });
    mockedSettingsApi.updateClientRegistrationPolicy.mockImplementation(async (patch) => ({ clientAutoRegistration: true, greetingOnAutoRegistration: false, ...patch }));
  });

  it("renders both switches and sends a partial update", async () => {
    renderSettings();
    const greeting = await screen.findByRole("switch", { name: "자동 등록 시 인사 문자 발송" });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "eformsign 계약서 도착 시 고객 자동 등록" })).toBeChecked();
      expect(greeting).not.toBeDisabled();
    });
    fireEvent.click(greeting);
    await waitFor(() => expect(mockedSettingsApi.updateClientRegistrationPolicy).toHaveBeenCalledWith(
      { greetingOnAutoRegistration: true },
      expect.anything(),
    ));
  });

  it("rolls an optimistic switch update back when saving fails", async () => {
    mockedSettingsApi.updateClientRegistrationPolicy.mockRejectedValueOnce(new Error("failed"));
    renderSettings();
    const autoRegistration = await screen.findByRole("switch", { name: "eformsign 계약서 도착 시 고객 자동 등록" });
    await waitFor(() => expect(autoRegistration).toBeChecked());

    fireEvent.click(autoRegistration);
    await waitFor(() => expect(autoRegistration).toBeChecked());
  });
});
