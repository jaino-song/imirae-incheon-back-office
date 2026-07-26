import type { FunnelStep } from "@/lib/observability/types";
import { cn } from "@/lib/utils";

interface FunnelBarsProps {
  dataComponent: string;
  steps: FunnelStep[];
  biggestDropStep?: number | null;
  /** Compact = overview card; verbose = full /stats/funnel detail page */
  variant?: "compact" | "verbose";
}

export function FunnelBars({
  dataComponent,
  steps,
  biggestDropStep,
  variant = "compact",
}: FunnelBarsProps) {
  if (steps.length === 0) {
    return (
      <p className="text-[0.78rem] text-v3-text-muted py-4 text-center">
        펀널 데이터가 아직 없어요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const isBiggestDrop = biggestDropStep === s.step;
        const showDropLabel = variant === "verbose" && i > 0;
        return (
          <div key={s.step}>
            <div
              data-component={`${dataComponent}_step-${s.step}`}
              className="flex items-center gap-3"
            >
              <div
                className={cn(
                  "shrink-0",
                  variant === "verbose" ? "w-[200px]" : "w-[150px]"
                )}
              >
                <div className="text-[0.78rem] font-medium text-v3-text leading-tight">
                  {s.label}
                  {isBiggestDrop ? (
                    <span className="ml-1.5 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[0.6rem] font-semibold text-red-600 align-middle">
                      이탈
                    </span>
                  ) : null}
                </div>
                <div className="text-[0.6rem] font-mono text-v3-text-muted truncate">
                  {s.event}
                </div>
              </div>
              <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-md transition-all",
                    i === steps.length - 1
                      ? "bg-gradient-to-r from-green-600 to-green-700"
                      : isBiggestDrop
                        ? "bg-gradient-to-r from-red-500 to-red-600"
                        : "bg-gradient-to-r from-v3-primary to-blue-700"
                  )}
                  style={{ width: `${Math.max(s.pct, 1)}%` }}
                />
              </div>
              <div className="w-20 text-right text-[0.78rem] font-semibold text-v3-text tabular-nums">
                {s.count}
                <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">
                  {s.pct.toFixed(0)}%
                </span>
              </div>
            </div>
            {showDropLabel && i > 0 ? (
              <div
                className={cn(
                  "mt-1 text-[0.65rem] tabular-nums",
                  variant === "verbose" ? "pl-[200px]" : "pl-[150px]",
                  isBiggestDrop ? "text-red-600 font-semibold" : "text-v3-text-muted"
                )}
              >
                ↓ {Math.round(steps[i - 1].count - s.count)}명 감소 ({s.dropFromPrevPct.toFixed(0)}%)
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
