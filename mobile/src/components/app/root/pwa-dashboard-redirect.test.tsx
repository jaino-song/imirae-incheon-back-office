import { render, screen, waitFor } from "@testing-library/react";

import { PwaDashboardRedirect } from "./pwa-dashboard-redirect";

const replace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("PwaDashboardRedirect", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("should keep the launch screen visible while replacing the home route", async () => {
    render(<PwaDashboardRedirect />);

    expect(screen.getByRole("status", { name: "아가잼잼을 불러오는 중" })).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});
