"use client";

import { useClients } from "@/hooks/useClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import "@/components/app/mobile-redesign/redesign.css";

export default function DashboardAnalyticsPage() {
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
  } = useDashboardAnalytics();
  const { data: clientsPage, isLoading: clientsLoading } = useClients(1, 1);

  const isLoading = analyticsLoading || clientsLoading;
  const hasData = !isLoading && analytics && clientsPage;

  const totalClients = clientsPage?.total ?? 0;
  const activeClients = analytics?.activeClients ?? 0;
  const upcomingThisMonth = analytics?.upcomingThisMonth ?? 0;
  const pendingActions =
    (analytics?.contractsPendingSignature ?? 0) + (analytics?.contractsNotSent ?? 0);

  const cards: Array<[string, string]> = [
    [String(totalClients), "전체 고객"],
    [String(activeClients), "진행중"],
    [String(upcomingThisMonth), "7일 내 시작"],
    [String(pendingActions), "처리 필요"],
  ];

  return (
    <section className="shell-content flex flex-col" data-component="mobile_dashboard_analytics-page">
      <div className="list-card" data-component="mobile_dashboard_analytics-page_card">
        <div className="list-title" data-component="mobile_dashboard_analytics-page_card_title">
          <span className="list-title-text">
            통계 보고서
            <span className="list-count">이번 달</span>
          </span>
        </div>
        {analyticsError ? (
          <div
            className="action-feedback"
            role="alert"
            data-component="mobile_dashboard_analytics-page_card_error"
          >
            통계를 불러오지 못했습니다.
          </div>
        ) : (
          <div
            className="stats-grid"
            style={{ padding: "8px" }}
            data-component="mobile_dashboard_analytics-page_card_grid"
          >
            {cards.map(([value, label]) => (
              <div
                className="mini-stat"
                data-component="mobile_dashboard_analytics-page_card_grid_stat"
                key={label}
              >
                <div data-component="mobile_dashboard_analytics-page_card_grid_stat_content">
                  <div
                    className="mini-stat-num"
                    data-component="mobile_dashboard_analytics-page_card_grid_stat_content_value"
                  >
                    {isLoading ? "—" : value}
                  </div>
                  <div
                    className="mini-stat-label"
                    data-component="mobile_dashboard_analytics-page_card_grid_stat_content_label"
                  >
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {hasData && (
          <div
            className="action-feedback"
            role="status"
            data-component="mobile_dashboard_analytics-page_card_feedback"
          >
            상세 차트는 다음 iteration에서 연결됩니다.
          </div>
        )}
      </div>
    </section>
  );
}
