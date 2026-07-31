import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function AllLoading() {
  return <ShellListSkeleton name="all" title="전체 메뉴" useDetailSheet={false} />;
}
