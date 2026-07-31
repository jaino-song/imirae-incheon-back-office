import {
  ListCard,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

export default function EmployeesLoading() {
  return (
    <MobileDetailSheet
      data-component="mobile_employees_loading_detail-sheet"
      name="employees"
      isOpen={false}
      onClose={() => {}}
      list={
        <div className="shell-content"
          data-component="mobile_employees_loading_list-content"
          data-slot="employees-content">
          <ListCard
            data-component="mobile_employees_loading_list-card"
            title="제공인력"
            count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
            filters={[
              { label: "전체", count: "", skeleton: true },
              { label: "활동 중", count: "", skeleton: true },
              { label: "휴직", count: "", skeleton: true },
            ]}
            activeFilter="전체"
          >
            <ListRowsSkeleton
              data-component="mobile_employees_loading_skeleton_rows"
              rowCount={6}
            />
          </ListCard>
        </div>
      }
      detail={<div className="detail-body" />}
    />
  );
}
