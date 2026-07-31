import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function AllMenuLoading() {
  return (
    <div
      data-component="mobile_all_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_all_loading_list-card"
        title="전체 메뉴"
        filters={[]}
      >
        <div className="flex flex-col gap-3 p-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-12 w-full rounded-xl bg-v3-dim-white animate-pulse" />
          ))}
        </div>
      </ListCard>
    </div>
  );
}
