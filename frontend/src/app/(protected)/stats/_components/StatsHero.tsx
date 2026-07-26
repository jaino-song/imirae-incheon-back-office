import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatsHeroProps {
  title: string;
  subtitle?: string;
  rightLabel?: string;
  rightValue?: string;
  rightAccent?: "default" | "warn";
  backHref?: string;
  backLabel?: string;
  ariaLabel?: string;
  dataComponent: string;
}

export function StatsHero({
  title,
  subtitle = "",
  rightLabel,
  rightValue,
  rightAccent = "default",
  backHref,
  backLabel,
  ariaLabel,
  dataComponent,
}: StatsHeroProps) {
  return (
    <div
      data-component={dataComponent}
      className="animate-v3-slide-up space-y-3"
    >
      {backHref && backLabel ? (
        <Link
          href={backHref}
          data-component={`${dataComponent}_back-link`}
          className="inline-flex items-center gap-1 text-[0.78rem] font-medium text-v3-text-muted hover:text-v3-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{backLabel}</span>
        </Link>
      ) : null}
      <div
        data-component={`${dataComponent}_banner`}
        aria-label={ariaLabel}
        className={cn(
          "relative overflow-hidden rounded-[24px] p-7",
          "bg-gradient-to-br from-v3-primary via-v3-primary to-blue-700",
          "shadow-v3"
        )}
      >
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -left-10 -bottom-10 h-32 w-32 rounded-full bg-white/5 blur-xl" />
        <div className="relative z-10 flex items-center justify-between gap-6">
          <div className="space-y-1.5">
            <h1
              data-component={`${dataComponent}_banner_title`}
              className="text-[1.4rem] font-bold tracking-tight text-white"
            >
              {title}
            </h1>
            {subtitle ? (
              <p
                data-component={`${dataComponent}_banner_subtitle`}
                className="text-[0.85rem] text-white/75 leading-relaxed"
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {rightLabel || rightValue ? (
            <div
              data-component={`${dataComponent}_banner_meta`}
              className="text-right shrink-0"
            >
              {rightLabel ? (
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-white/60">
                  {rightLabel}
                </div>
              ) : null}
              {rightValue ? (
                <div
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    rightAccent === "warn" ? "text-red-300" : "text-white"
                  )}
                >
                  {rightValue}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
