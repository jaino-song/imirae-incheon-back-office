import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ContractAutomationEditor } from "../ContractAutomationEditor";
import { settingsApi } from "@/services/api";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getContractAutomationPolicies: jest.fn(),
    updateContractAutoFinalizeConfig: jest.fn(),
  },
}));

const getPolicies = settingsApi.getContractAutomationPolicies as jest.Mock;
const updateConfig = settingsApi.updateContractAutoFinalizeConfig as jest.Mock;

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ContractAutomationEditor onClose={jest.fn()} /></QueryClientProvider>);
}

describe("ContractAutomationEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicies.mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 0, maxAttempts: 3 } });
    updateConfig.mockResolvedValue({ enabled: true, graceDays: 7, maxAttempts: 3 });
  });

  it("enables 저장 after changing the execution timing and saves the draft", async () => {
    renderEditor();
    await screen.findByText("자동화 설정");
    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("실행 시점"), { target: { value: "7" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual({ enabled: true, graceDays: 7, maxAttempts: 3 }));
  });
});
