import { redirect } from "next/navigation";

// 발송 예정 was folded into the merged 발송 기록 screen (upcoming + past sends
// as two zones of one list). This route stays in place only so bookmarks and
// deep links to the old URL keep working.
export default function ScheduledMessagesPage() {
  redirect("/messages/history");
}
