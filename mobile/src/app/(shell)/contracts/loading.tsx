import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function ContractsLoading() {
  return (
    <div
      data-component="mobile_contracts_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_contracts_loading_list-card"
        title="최근 현황"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={["전체", "조치 필요", "시작 예정", "종료 예정"]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_contracts_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
