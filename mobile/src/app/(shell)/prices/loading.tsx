import {
  ListCard,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

export default function PricesLoading() {
  return (
    <div data-component="mobile_prices_loading_page" data-slot="prices-page" className="md:hidden">
      <MobileDetailSheet
        data-component="mobile_prices_loading_detail-sheet"
        name="prices"
        isOpen={false}
        onClose={() => {}}
        list={
          <div className="shell-content"
            data-component="mobile_prices_loading_list-content"
            data-slot="prices-content">
            <ListCard
              data-component="mobile_prices_loading_list-card"
              title="바우처 요금표"
              count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
              filters={[]}
            >
              <ListRowsSkeleton
                data-component="mobile_prices_loading_skeleton_rows"
                rowCount={6}
              />
            </ListCard>
          </div>
        }
        detail={<div className="detail-body" />}
      />
    </div>
  );
}
