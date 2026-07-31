import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function MessagesLoading() {
  return (
    <div
      data-component="mobile_messages_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_messages_loading_list-card"
        title="메시지 전송 내역"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={[
          { label: "전체", count: "", skeleton: true },
          { label: "발송 성공", count: "", skeleton: true },
          { label: "발송 실패", count: "", skeleton: true },
        ]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_messages_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
