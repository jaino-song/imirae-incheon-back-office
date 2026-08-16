import { fireEvent, render, screen } from "@testing-library/react";
import { Clock3 } from "lucide-react";

import {
  ContractDocumentJobsPopover,
  type ContractDocumentJobsData,
} from "./ContractDocumentJobsPopover";
import { ContractStatsBar } from "./ContractStatsBar";

const JOBS: ContractDocumentJobsData = {
  active: [
    {
      jobId: "job-active",
      jobType: "finalize_document",
      status: "processing",
      documentId: "document-1",
      progressStep: "전자문서 최종 확인중",
      attempts: 1,
    },
  ],
  requiresAttention: [
    {
      jobId: "job-attention",
      jobType: "finalize_document",
      status: "requires_attention",
      documentId: "document-2",
      attempts: 3,
    },
  ],
  recent: [
    {
      jobId: "job-recent",
      jobType: "create_document",
      status: "completed",
      documentId: "document-3",
      completedAt: "2026-08-13T01:00:00.000Z",
    },
  ],
};

function renderOpenPopover(overrides: Partial<React.ComponentProps<typeof ContractDocumentJobsPopover>> = {}) {
  return render(
    <ContractDocumentJobsPopover
      open
      summary={{ activeCount: 4, requiresAttentionCount: 1 }}
      documentJobs={JOBS}
      trigger={<button type="button">전자문서 처리중</button>}
      {...overrides}
    />,
  );
}

describe("ContractDocumentJobsPopover", () => {
  it("renders the three read-only sections and deep-links rows with a document id", () => {
    renderOpenPopover();

    expect(screen.getByRole("heading", { name: "처리 중" })).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByText("최근 처리")).toBeInTheDocument();
    expect(screen.getByText("전자문서 최종 확인중")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /전자문서 최종 처리/ })[0]).toHaveAttribute(
      "href",
      "/contracts?documentId=document-1",
    );
  });

  it("closes on Escape and mobile backdrop clicks", () => {
    const onOpenChange = jest.fn();
    renderOpenPopover({ onOpenChange });

    const content = screen.getByRole("dialog");
    fireEvent.keyDown(content, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const backdrop = document.querySelector('[data-slot="popover-backdrop"]');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows safe copy and no navigation for a job without a document id", () => {
    renderOpenPopover({
      documentJobs: {
        active: [{ ...JOBS.active[0], documentId: null }],
        requiresAttention: [],
        recent: [],
      },
    });

    expect(screen.getByTitle("연결된 계약서가 없어 이동할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /전자문서 최종 처리/ })).not.toBeInTheDocument();
  });

  it("uses only the summary active count in the far-right processing tile", () => {
    render(
      <ContractStatsBar
        name="desktop_contracts"
        items={Array.from({ length: 5 }, (_, index) => ({
          icon: Clock3,
          value: index + 1,
          label: `통계 ${index + 1}`,
          counter: "건",
        }))}
        summary={{ activeCount: 7, requiresAttentionCount: 99 }}
        documentJobs={{ active: JOBS.active.slice(0, 1), requiresAttention: JOBS.requiresAttention, recent: [] }}
      />,
    );

    const stats = document.querySelector('[data-component="desktop_contracts_stats"]');
    expect(stats).toBeInTheDocument();
    const statLabels = Array.from(stats?.querySelectorAll("p") ?? []).map((node) => node.textContent);
    expect(statLabels).toContain("전자문서 처리중");
    expect(statLabels).toContain("7");
    const processingTile = screen.getByRole("button", { name: "전자문서 처리중 작업 보기" });
    expect(processingTile).toHaveTextContent("7");
    expect(processingTile).not.toHaveTextContent("99");

    expect(processingTile).toHaveClass("ms-auto");
    expect(processingTile.compareDocumentPosition(stats?.querySelector('[data-component="desktop_contracts_stats_stat-4"]') as Node)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });
});
