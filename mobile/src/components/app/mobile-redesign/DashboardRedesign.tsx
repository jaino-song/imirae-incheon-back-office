import "./redesign.css";

import type { DashboardAnalytic, SectionRows } from "./mockup-data";
import { ListCard, SectionedList } from "./primitives";
import { Skeleton } from "@/components/ui/skeleton";

const DASHBOARD_SOURCE_COMPONENT = "DashboardRedesign";

/**
 * Canonical data-component base for the /dashboard route. DashboardRedesign is
 * rendered only by `app/(shell)/dashboard/page.tsx`, so the route base lives
 * here instead of being threaded through a prop.
 */
const DASHBOARD_BASE = "mobile_dashboard_page";
const DASHBOARD_ANALYTICS_BASE = `${DASHBOARD_BASE}_analytics-grid`;
const DASHBOARD_LIST_CARD_BASE = `${DASHBOARD_BASE}_content_list-card`;
const DASHBOARD_LIST_BODY_BASE = `${DASHBOARD_LIST_CARD_BASE}_body`;
const DASHBOARD_LIST_SKELETON_BASE = `${DASHBOARD_LIST_BODY_BASE}_loading-skeleton`;

const toneClass: Record<DashboardAnalytic["tone"], string> = {
  primary: "bg-v3-primary-light text-v3-primary",
  orange: "bg-v3-orange-light text-v3-orange",
  green: "bg-v3-green-light text-v3-green",
  burgundy: "bg-v3-burgundy-light text-v3-burgundy",
};

export interface DashboardRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
  skeleton?: boolean;
}

export interface DashboardRedesignProps {
  analytics: DashboardAnalytic[];
  sections: SectionRows[];
  filters: DashboardRedesignFilter[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
  analyticsLoading?: boolean;
  loading?: boolean;
}

function DashboardAnalyticsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`dashboard-analytic-skeleton-${index}`}
          className="mini-stat mini-stat-skeleton"
          data-component={`${DASHBOARD_ANALYTICS_BASE}_stat-skeleton`}
          aria-hidden="true"
        >
          <Skeleton className="mini-stat-icon bg-v3-dim-white" />
          <div className="mini-stat-skeleton-text">
            <Skeleton className="mini-stat-skeleton-num bg-v3-dim-white" />
            <Skeleton className="mini-stat-skeleton-label bg-v3-dim-white" />
          </div>
        </div>
      ))}
    </>
  );
}

function DashboardListSkeleton() {
  return (
    <div className="section-block" data-component={DASHBOARD_LIST_SKELETON_BASE}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`dashboard-skeleton-${index}`}
          className="list-item"
          data-component={`${DASHBOARD_LIST_SKELETON_BASE}_row`}
          aria-hidden="true"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <Skeleton className="list-avatar rounded-full bg-v3-dim-white animate-pulse" />
          <div className="list-info flex flex-col" data-component={`${DASHBOARD_LIST_SKELETON_BASE}_row_info`}>
            <Skeleton className="h-4 w-24 bg-v3-dim-white animate-pulse" />
            <Skeleton className="mt-1.5 h-3 w-32 bg-v3-dim-white animate-pulse" />
          </div>
          <div className="list-right" data-component={`${DASHBOARD_LIST_SKELETON_BASE}_row_right`}>
            <Skeleton className="h-4 w-14 bg-v3-dim-white animate-pulse" />
            <Skeleton className="h-3 w-10 bg-v3-dim-white animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardRedesign({
  analytics,
  sections,
  filters,
  activeFilter,
  onFilterChange,
  analyticsLoading = false,
  loading = false,
}: DashboardRedesignProps) {
  return (
    <section
      data-component={DASHBOARD_BASE}
      data-slot="dashboard-page"
      data-source-component={DASHBOARD_SOURCE_COMPONENT}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="stats-grid" data-component={DASHBOARD_ANALYTICS_BASE}>
        {analyticsLoading ? (
          <DashboardAnalyticsSkeleton />
        ) : (
          analytics.map((item) => {
            const Icon = item.icon;
            return (
              <div className="mini-stat" key={item.label} data-component={`${DASHBOARD_ANALYTICS_BASE}_stat`}>
                <div className={`mini-stat-icon ${toneClass[item.tone]}`}>
                  <Icon size={18} strokeWidth={2.5} />
                </div>
                <div>
                  <div className={`mini-stat-num ${item.urgent ? "urgent" : ""}`}>{item.value}</div>
                  <div className="mini-stat-label">{item.label}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        className="shell-content"
        data-component={`${DASHBOARD_BASE}_content`}
        data-slot="dashboard-content"
      >
        <ListCard
          data-component={DASHBOARD_LIST_CARD_BASE}
          title="최근 현황"
          count=""
          filters={filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        >
          {loading ? (
            <DashboardListSkeleton />
          ) : (
            <SectionedList
              data-component={DASHBOARD_LIST_BODY_BASE}
              sections={sections}
              hideSectionHeader={() => true}
            />
          )}
        </ListCard>
      </div>
    </section>
  );
}
