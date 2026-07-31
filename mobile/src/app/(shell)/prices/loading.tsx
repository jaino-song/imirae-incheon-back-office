import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function PricesLoading() {
  return (
    <div
      data-component="mobile_prices_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_prices_loading_list-card"
        title="가격표 및 이용안내"
        filters={[]}
      >
        <ListRowsSkeleton
          data-component="mobile_prices_loading_skeleton_rows"
          rowCount={5}
        />
      </ListCard>
    </div>
  );
}
