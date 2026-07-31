import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function NotificationsLoading() {
  return <ShellListSkeleton name="notifications" title="알림" useDetailSheet={false} />;
}
