import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function ConsultationsLoading() {
  return (
    <div
      data-component="mobile_consultations_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_consultations_loading_list-card"
        title="상담 관리"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={[
          { label: "전체", count: "", skeleton: true },
          { label: "상담 대기", count: "", skeleton: true },
          { label: "상담 완료", count: "", skeleton: true },
        ]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_consultations_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
