import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function CallsLoading() {
  return (
    <div
      data-component="mobile_calls_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_calls_loading_list-card"
        title="통화 요약"
        filters={[]}
      >
        <ListRowsSkeleton
          data-component="mobile_calls_loading_skeleton_rows"
          rowCount={5}
        />
      </ListCard>
    </div>
  );
}
