import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function FilesLoading() {
  return (
    <ShellListSkeleton
      name="files"
      title="파일"
      searchPlaceholder="파일명, 카테고리 검색"
      action={{ label: "업로드", href: "/files/upload" }}
    />
  );
}
