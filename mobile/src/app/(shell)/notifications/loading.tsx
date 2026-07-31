import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function NotificationsLoading() {
  return (
    <div
      data-component="mobile_notifications_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_notifications_loading_list-card"
        title="알림 목록"
      >
        <ListRowsSkeleton
          data-component="mobile_notifications_loading_skeleton_rows"
          rowCount={5}
        />
      </ListCard>
    </div>
  );
}
