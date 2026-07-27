import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DetailTabPanels } from "../DetailTabPanels";
import { DetailTabs } from "../DetailTabs";

function DetailTabsHarness() {
  const [activeTab, setActiveTab] = useState("basic");
  const tabs = [
    { key: "basic", label: "기본 정보" },
    { key: "contracts", label: "계약서 정보" },
  ];

  return (
    <>
      <DetailTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="고객 상세 정보"
        idPrefix="dashboard-client-detail"
      />
      <DetailTabPanels
        panels={[
          { key: "basic", children: "기본 본문" },
          { key: "contracts", children: "계약서 본문" },
        ]}
        activeTab={activeTab}
        idPrefix="dashboard-client-detail"
      />
    </>
  );
}

describe("DetailTabs", () => {
  it("connects tabs to panels and supports arrow-key navigation", () => {
    render(<DetailTabsHarness />);

    const basicTab = screen.getByRole("tab", { name: "기본 정보" });
    const contractsTab = screen.getByRole("tab", { name: "계약서 정보" });
    const basicPanel = screen.getByRole("tabpanel", { name: "기본 정보" });
    const contractsPanel = document.querySelector<HTMLElement>(
      "#dashboard-client-detail-panel-contracts",
    );

    expect(screen.getByRole("tablist", { name: "고객 상세 정보" })).toBeInTheDocument();
    expect(basicTab).toHaveAttribute("aria-selected", "true");
    expect(basicTab).toHaveAttribute("aria-controls", basicPanel.id);
    expect(contractsPanel).toHaveAttribute("aria-hidden", "true");
    expect(contractsPanel).toHaveAttribute("inert");

    fireEvent.keyDown(basicTab, { key: "ArrowRight" });

    expect(contractsTab).toHaveAttribute("aria-selected", "true");
    expect(contractsTab).toHaveFocus();
    expect(contractsPanel).toHaveAttribute("aria-hidden", "false");
    expect(contractsPanel).not.toHaveAttribute("inert");
  });

  it("remeasures the underline on the next frame when the active tab changes", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
    const cancelFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const tabs = [
      { key: "basic", label: "기본 정보" },
      { key: "contracts", label: "계약서 정보" },
    ];
    const renderTabs = (activeTab: string) => (
      <DetailTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={jest.fn()}
        ariaLabel="측정 테스트"
      />
    );

    const { container, rerender } = render(renderTabs("basic"));
    const tabList = screen.getByRole("tablist", { name: "측정 테스트" });
    const basicTab = screen.getByRole("tab", { name: "기본 정보" });
    const contractsTab = screen.getByRole("tab", { name: "계약서 정보" });
    const indicator = container.querySelector<HTMLElement>(
      '[data-component="desktop_v3_detail-tabs_indicator"]',
    );

    if (!indicator) {
      throw new Error("DetailTabs indicator was not rendered");
    }

    tabList.getBoundingClientRect = () => ({
      x: 10,
      y: 0,
      width: 180,
      height: 32,
      top: 0,
      right: 190,
      bottom: 32,
      left: 10,
      toJSON: () => ({}),
    });
    basicTab.getBoundingClientRect = () => ({
      x: 20,
      y: 0,
      width: 64,
      height: 32,
      top: 0,
      right: 84,
      bottom: 32,
      left: 20,
      toJSON: () => ({}),
    });
    contractsTab.getBoundingClientRect = () => ({
      x: 100,
      y: 0,
      width: 80,
      height: 32,
      top: 0,
      right: 180,
      bottom: 32,
      left: 100,
      toJSON: () => ({}),
    });

    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(0));
    });
    expect(indicator).toHaveStyle({ transform: "translateX(10px)", width: "64px" });

    rerender(renderTabs("contracts"));
    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(16));
    });
    expect(indicator).toHaveStyle({ transform: "translateX(90px)", width: "80px" });

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });
});
