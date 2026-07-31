import {
  ListCard,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

export default function ConsultationsLoading() {
  return (
    <MobileDetailSheet
      data-component="mobile_consultations_loading_detail-sheet"
      name="consultations"
      isOpen={false}
      onClose={() => {}}
      list={
        <div className="shell-content" data-component="mobile_consultations_loading_list-content">
          <ListCard
            data-component="mobile_consultations_loading_list-card"
            title="상담 조회"
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
      }
      detail={<div className="detail-body" />}
    />
  );
}
