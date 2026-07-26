import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelCardProps {
  title: string;
  iconEmoji?: string;
  source?: "Sentry" | "PostHog" | string;
  detailHref: string;
  detailLabel?: string;
  dataComponent: string;
  className?: string;
  children: React.ReactNode;
}

const SOURCE_PILL: Record<string, string> = {
  Sentry: "bg-red-100 text-red-700",
  PostHog: "bg-purple-100 text-purple-700",
};

/**
 * Card used in the overview grid. Renders header with title + source pill +
 * "전체 보기 →" link, then the body.
 */
export function PanelCard({
  title,
  iconEmoji,
  source,
  detailHref,
  detailLabel = "전체 보기",
  dataComponent,
  className,
  children,
}: PanelCardProps) {
  return (
    <section
      data-component={dataComponent}
      className={cn(
        "animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6 flex flex-col gap-4 min-h-[280px]",
        className
      )}
    >
      <header
        data-component={`${dataComponent}_head`}
        className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border"
      >
        <h3 className="text-[0.95rem] font-bold text-v3-text tracking-tight">
          {iconEmoji ? <span className="mr-1.5">{iconEmoji}</span> : null}
          {title}
        </h3>
        {source ? (
          <span
            className={cn(
              "text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5",
              SOURCE_PILL[source] ?? "bg-v3-dim-white text-v3-text-muted"
            )}
          >
            {source}
          </span>
        ) : null}
        <Link
          href={detailHref}
          data-component={`${dataComponent}_head_detail-link`}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-v3-primary-light px-3 py-1.5 text-[0.72rem] font-semibold text-v3-primary hover:bg-v3-primary hover:text-white transition-colors"
        >
          <span>{detailLabel}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div data-component={`${dataComponent}_body`} className="flex-1 min-h-0 flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}
