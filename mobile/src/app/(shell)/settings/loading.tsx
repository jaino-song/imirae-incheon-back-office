import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function SettingsLoading() {
  return (
    <div
      data-component="mobile_settings_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component="mobile_settings_loading_list-card"
        title="설정"
      >
        <div className="flex flex-col gap-3 p-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-12 w-full rounded-xl bg-v3-dim-white animate-pulse" />
          ))}
        </div>
      </ListCard>
    </div>
  );
}
