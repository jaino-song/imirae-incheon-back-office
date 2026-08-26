import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { toast } from "@/hooks/use-toast";

import { Toaster } from "./toaster";

describe("Toaster", () => {
  it("renders an existing toast and dismisses it through its close action", async () => {
    render(<Toaster />);

    act(() => {
      toast({
        description: "저장되었습니다.",
        title: "테스트 알림",
      });
    });

    expect(await screen.findByText("테스트 알림")).toBeInTheDocument();
    expect(screen.getByText("저장되었습니다.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-component",
      "mobile_shell_toaster",
    );

    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));

    await waitFor(() => {
      expect(screen.queryByText("테스트 알림")).not.toBeInTheDocument();
    });
  });
});
