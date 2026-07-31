import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function PricesLoading() {
  return (
    <ShellListSkeleton
      name="prices"
      title="바우처 요금표"
      outerWrapper={{
        className: "md:hidden",
        dataComponent: "mobile_prices_loading_page",
        dataSlot: "prices-page",
      }}
      listDataSlot="prices-content"
    />
  );
}
