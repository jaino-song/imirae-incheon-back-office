import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function FilesLoading() {
  return (
    <div
      data-component="mobile_files_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_files_loading_list-card"
        title="서류함"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
      >
        <ListRowsSkeleton
          data-component="mobile_files_loading_skeleton_rows"
          rowCount={5}
        />
      </ListCard>
    </div>
  );
}
