import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function FilesLoading() {
  return (
    <ShellListSkeleton
      name="files"
      title="파일"
      action={{ label: "업로드", href: "/files/upload" }}
    />
  );
}
