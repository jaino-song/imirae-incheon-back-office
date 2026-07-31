import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function CallsLoading() {
  return <ShellListSkeleton name="calls" title="통화 기록" useDetailSheet={false} />;
}
