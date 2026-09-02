import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ContractAutomationsPanel } from "../ContractAutomationsPanel";
import { settingsApi } from "@/services/api";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getContractAutomationPolicies: jest.fn(),
    updateContractAutoFinalizeConfig: jest.fn(),
  },
}));

const getPolicies = settingsApi.getContractAutomationPolicies as jest.Mock;
const updateConfig = settingsApi.updateContractAutoFinalizeConfig as jest.Mock;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ContractAutomationsPanel data-component="contracts-automation" onEdit={jest.fn()} /></QueryClientProvider>);
}

describe("ContractAutomationsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicies.mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 3, maxAttempts: 5 } });
    updateConfig.mockResolvedValue({ enabled: false, graceDays: 3, maxAttempts: 5 });
  });

  it("renders the rule summary and toggles the saved config", async () => {
    renderPanel();
    expect(await screen.findByText("계약 종료일 자동 완료")).toBeInTheDocument();
    expect(screen.getByText("검토 필요 → 계약 완료 · 종료일 3일 후 · 매일 17:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "계약 종료일 자동 완료 활성화" }));
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual({ enabled: false, graceDays: 3, maxAttempts: 5 }));
  });
});
