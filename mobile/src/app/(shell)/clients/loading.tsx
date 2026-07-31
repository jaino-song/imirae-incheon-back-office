import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function ClientsLoading() {
  return (
    <div
      data-component="mobile_clients_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_clients_loading_list-card"
        title="전체 고객"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={["전체", "계약서 필요", "신규"]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_clients_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
