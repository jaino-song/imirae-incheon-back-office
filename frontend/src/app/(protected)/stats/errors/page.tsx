import { redirect } from "next/navigation";
import { Block } from "@/components/app/v3/Block";
import { getCurrentUser } from "@/lib/auth/cookies";
import { ROLES } from "@/lib/constants/roles";
import {
  getSummary as getSentrySummary,
  get24hEventTrend,
  getOpenIssues,
  formatSentryRelativeTime,
} from "@/lib/observability/sentry";
import { StatsHero } from "../_components/StatsHero";
import { KpiCard } from "../_components/KpiCard";

export const metadata = { title: "오류 통계 · 통계" };
export const revalidate = 60;

const LEVEL_LABEL: Record<string, string> = {
  fatal: "critical",
  error: "error",
  warning: "warning",
  info: "info",
};

const LEVEL_DOT_CLASS: Record<string, string> = {
  fatal: "bg-red-600",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

const LEVEL_TEXT_CLASS: Record<string, string> = {
  fatal: "text-red-700",
  error: "text-red-600",
  warning: "text-amber-700",
  info: "text-blue-700",
};

export default async function ErrorsDetailPage() {
  const user = await getCurrentUser();
  if (user?.role !== ROLES.owner) {
    redirect("/stats/inquiries");
  }

  const [summary, trend, issues] = await Promise.all([
    getSentrySummary(),
    get24hEventTrend(),
    getOpenIssues({ limit: 50, statsPeriod: "7d" }),
  ]);

  // Build chart points from trend (24h, hourly buckets)
  const maxCount = Math.max(1, ...trend.map((p) => p.count));
  const chartWidth = 1100;
  const chartHeight = 180;
  const chartPadLeft = 36;
  const chartPadRight = 20;
  const usableWidth = chartWidth - chartPadLeft - chartPadRight;
  const yFor = (v: number) =>
    chartHeight - 24 - (v / maxCount) * (chartHeight - 40);
  const linePoints = trend.map((p, i) => {
    const x =
      chartPadLeft +
      (trend.length > 1 ? (i / (trend.length - 1)) * usableWidth : 0);
    return `${x.toFixed(1)},${yFor(p.count).toFixed(1)}`;
  });
  const linePath = linePoints.length ? `M${linePoints.join(" L")}` : "";
  const areaPath = linePoints.length
    ? `M${chartPadLeft},${chartHeight - 24} L${linePoints.join(" L")} L${
        chartPadLeft + usableWidth
      },${chartHeight - 24} Z`
    : "";

  // Last 3 issues for the "Top events" preview (top by count)
  const totalIssues = issues.length;

  return (
    <section data-component="desktop_stats-errors_page" className="flex flex-col gap-6 pb-10">
      <Block name="desktop_stats-errors_page_hero" className="shrink-0">
        <StatsHero
          title="오류 통계"
          subtitle="Sentry · 미해결 이슈 · 24시간 이내 발생 추이"
          rightLabel="실시간"
          rightValue={new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          backHref="/stats"
          backLabel="통계 overview로"
          dataComponent="desktop_stats-errors_page_hero_content"
        />
      </Block>

      <Block name="desktop_stats-errors_page_kpi" className="shrink-0">
        <div
          data-component="desktop_stats-errors_page_kpi_grid"
          className="grid grid-cols-2 lg:grid-cols-5 gap-3"
        >
          <KpiCard
            iconEmoji="⚠"
            label="미해결"
            value={summary.openCount}
            unit="건"
            tone={summary.openCount > 0 ? "warn" : "success"}
            dataComponent="desktop_stats-errors_page_kpi_grid_card-open"
          />
          <KpiCard
            iconEmoji="+"
            label="24h 신규"
            value={summary.newIn24h}
            unit="건"
            tone={summary.newIn24h > 0 ? "warn" : "default"}
            dataComponent="desktop_stats-errors_page_kpi_grid_card-new"
          />
          <KpiCard
            iconEmoji="∑"
            label="7일 발생"
            value={summary.totalEvents7d.toLocaleString("ko-KR")}
            dataComponent="desktop_stats-errors_page_kpi_grid_card-events"
          />
          <KpiCard
            iconEmoji="👤"
            label="영향받은 사용자"
            value={`~${summary.affectedUsers}`}
            unit="명"
            dataComponent="desktop_stats-errors_page_kpi_grid_card-users"
          />
          <KpiCard
            iconEmoji="⏱"
            label="마지막 오류"
            value={formatSentryRelativeTime(summary.lastErrorAt)}
            dataComponent="desktop_stats-errors_page_kpi_grid_card-last"
            valueSize="sm"
          />
        </div>
      </Block>

      <Block name="desktop_stats-errors_page_chart">
        <div
          data-component="desktop_stats-errors_page_chart_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">이벤트 추이 (24시간)</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-red-100 text-red-700">
              Sentry
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">
              총 {trend.reduce((s, p) => s + p.count, 0).toLocaleString("ko-KR")}건
            </span>
          </header>
          {trend.length === 0 ? (
            <p className="text-center py-8 text-[0.85rem] text-v3-text-muted">
              지난 24시간 동안 기록된 이벤트가 없어요.
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: chartHeight }}
              aria-label="24시간 이벤트 추이"
            >
              <defs>
                <linearGradient id="errors-chart-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <line
                x1={chartPadLeft}
                y1={chartHeight - 24}
                x2={chartWidth - chartPadRight}
                y2={chartHeight - 24}
                stroke="hsl(214 32% 91%)"
              />
              <line
                x1={chartPadLeft}
                y1={yFor(maxCount * 0.5)}
                x2={chartWidth - chartPadRight}
                y2={yFor(maxCount * 0.5)}
                stroke="hsl(214 32% 91%)"
                strokeDasharray="3,3"
              />
              <line
                x1={chartPadLeft}
                y1={yFor(maxCount)}
                x2={chartWidth - chartPadRight}
                y2={yFor(maxCount)}
                stroke="hsl(214 32% 91%)"
                strokeDasharray="3,3"
              />
              <text x={8} y={yFor(maxCount) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {maxCount.toFixed(0)}
              </text>
              <text x={8} y={yFor(maxCount * 0.5) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {Math.round(maxCount * 0.5)}
              </text>
              <text x={8} y={chartHeight - 20} fontSize={10} fill="hsl(215 16% 47%)">
                0
              </text>
              {areaPath && <path d={areaPath} fill="url(#errors-chart-grad)" />}
              {linePath && (
                <path d={linePath} stroke="hsl(0 84% 55%)" strokeWidth={2} fill="none" />
              )}
              {trend.length > 0 && (() => {
                const last = trend[trend.length - 1];
                const x = chartPadLeft + usableWidth;
                const y = yFor(last.count);
                return (
                  <>
                    <circle cx={x} cy={y} r={4} fill="hsl(0 84% 55%)" />
                    <text x={x} y={y - 8} fontSize={11} fontWeight={600} fill="hsl(0 84% 55%)" textAnchor="middle">
                      {last.count}
                    </text>
                  </>
                );
              })()}
              <text
                x={chartPadLeft}
                y={chartHeight - 6}
                fontSize={10}
                fill="hsl(215 16% 47%)"
              >
                24h ago
              </text>
              <text
                x={chartPadLeft + usableWidth}
                y={chartHeight - 6}
                fontSize={10}
                fill="hsl(215 16% 47%)"
                textAnchor="end"
              >
                now
              </text>
            </svg>
          )}
        </div>
      </Block>

      <Block name="desktop_stats-errors_page_issues">
        <div
          data-component="desktop_stats-errors_page_issues_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6 overflow-hidden"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">미해결 이슈 ({totalIssues}건)</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-red-100 text-red-700">
              Sentry
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">최근 발생 순</span>
          </header>
          {issues.length === 0 ? (
            <div className="py-10 text-center text-[0.85rem] text-v3-text-muted">
              열린 이슈가 없어요 🎉
            </div>
          ) : (
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="bg-v3-dim-white border-b border-v3-border">
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">레벨</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">이슈</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">발생 건수</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">영향 사용자</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">최근 발생</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    data-component="desktop_stats-errors_page_issues_card_body_row"
                    className="border-b border-v3-border last:border-0 hover:bg-v3-dim-white"
                  >
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${LEVEL_DOT_CLASS[issue.level] ?? "bg-gray-400"}`}
                        />
                        <strong className={LEVEL_TEXT_CLASS[issue.level] ?? "text-v3-text"}>
                          {LEVEL_LABEL[issue.level] ?? issue.level}
                        </strong>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-v3-text">{issue.title}</div>
                      <div className="text-[0.65rem] font-mono text-v3-text-muted truncate max-w-[400px]">
                        {issue.culprit ?? issue.filename ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {issue.count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {issue.userCount}
                    </td>
                    <td className="px-3 py-3 text-right text-[0.75rem] text-v3-text-muted">
                      {formatSentryRelativeTime(issue.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Block>
    </section>
  );
}
