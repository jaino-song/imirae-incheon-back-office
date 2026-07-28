import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./InfoTooltip";

interface KpiCardProps {
  icon?: LucideIcon;
  iconEmoji?: string;
  label: string;
  value: string | number;
  unit?: string;
  meta?: string;
  delta?: { label: string; tone: "up" | "down" | "flat" };
  tone?: "default" | "warn" | "success";
  dataComponent: string;
  valueSize?: "lg" | "md" | "sm";
  /** When provided, shows an info (?) icon next to the label that reveals
   *  this text on hover. */
  infoText?: string;
}

const TONE_CLASSES = {
  default: "text-v3-text",
  warn: "text-red-600",
  success: "text-green-700",
} as const;

const DELTA_TONE_CLASSES = {
  up: "bg-green-100 text-green-700",
  down: "bg-red-100 text-red-700",
  flat: "bg-v3-dim-white text-v3-text-muted",
} as const;

export function KpiCard({
  icon: Icon,
  iconEmoji,
  label,
  value,
  unit,
  meta,
  delta,
  tone = "default",
  dataComponent,
  valueSize = "md",
  infoText,
}: KpiCardProps) {
  return (
    <div
      data-component={dataComponent}
      className="animate-v3-slide-up bg-white rounded-2xl shadow-v3 p-4.5 px-5 py-5"
    >
      <div data-component={`${dataComponent}_head`} className="flex items-center gap-2 mb-3">
        {Icon ? (
          <Icon className="w-4 h-4 text-v3-text-muted" />
        ) : iconEmoji ? (
          <span className="text-base leading-none">{iconEmoji}</span>
        ) : null}
        <span className="text-[0.7rem] font-medium text-v3-text-muted truncate">{label}</span>
        {infoText ? (
          <InfoTooltip
            text={infoText}
            ariaLabel={`${label} 도움말`}
            dataComponent={`${dataComponent}_head_info`}
            className="-ml-0.5"
          />
        ) : null}
      </div>
      <div data-component={`${dataComponent}_body`} className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-bold leading-none tabular-nums",
            valueSize === "lg" ? "text-[1.9rem]" : valueSize === "sm" ? "text-[1.15rem]" : "text-[1.55rem]",
            TONE_CLASSES[tone]
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[0.78rem] text-v3-text-muted font-medium">{unit}</span>
        ) : null}
        {delta ? (
          <span
            className={cn(
              "ml-auto text-[0.65rem] font-semibold rounded px-1.5 py-0.5 tabular-nums",
              DELTA_TONE_CLASSES[delta.tone]
            )}
          >
            {delta.label}
          </span>
        ) : null}
      </div>
      {meta ? (
        <div
          data-component={`${dataComponent}_meta`}
          className="mt-1.5 text-[0.68rem] text-v3-text-muted leading-tight"
        >
          {meta}
        </div>
      ) : null}
    </div>
  );
}
