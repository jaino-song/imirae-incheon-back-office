import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function DashboardLoading() {
  return (
    <div
      data-component="mobile_dashboard_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 rounded-2xl bg-white p-3 shadow-sm animate-pulse" />
        <div className="h-20 rounded-2xl bg-white p-3 shadow-sm animate-pulse" />
      </div>
      <ListCard
        data-component="mobile_dashboard_loading_list-card"
        title="현황 요약"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
      >
        <ListRowsSkeleton
          data-component="mobile_dashboard_loading_skeleton_rows"
          rowCount={4}
        />
      </ListCard>
    </div>
  );
}
