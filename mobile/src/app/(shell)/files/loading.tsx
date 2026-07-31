import {
  ListCard,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

export default function FilesLoading() {
  return (
    <MobileDetailSheet
      data-component="mobile_files_loading_detail-sheet"
      name="files"
      isOpen={false}
      onClose={() => {}}
      list={
        <div className="shell-content" data-component="mobile_files_loading_list-content">
          <ListCard
            data-component="mobile_files_loading_list-card"
            title="파일"
            count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
            filters={[]}
            actionLabel="업로드"
            actionHref="/files/upload"
          >
            <ListRowsSkeleton
              data-component="mobile_files_loading_skeleton_rows"
              rowCount={6}
            />
          </ListCard>
        </div>
      }
      detail={<div className="detail-body" />}
    />
  );
}
