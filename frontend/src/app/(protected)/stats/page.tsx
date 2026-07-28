import { redirect } from "next/navigation";
import { Block } from "@/components/app/v3/Block";
import { getCurrentUser } from "@/lib/auth/cookies";
import { ROLES } from "@/lib/constants/roles";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  getSummary as getSentrySummary,
  formatSentryRelativeTime,
} from "@/lib/observability/sentry";
import {
  getInquiriesSummary,
  getInquiriesDailyTrend,
  getFunnelSummary,
  getTrafficSummary,
  getTopPages,
  getDeviceBreakdown,
  formatRelativeKo,
} from "@/lib/observability/posthog";
import { StatsHero } from "./_components/StatsHero";
import { PanelCard } from "./_components/PanelCard";
import { Sparkline } from "./_components/Sparkline";
import { MiniBars } from "./_components/MiniBars";
import { FunnelBars } from "./_components/FunnelBars";

export const metadata = {
  title: "통계 · 아가잼잼 관리자",
};

// Revalidate the entire page every 60 seconds (matches our 1-minute cache spec)
export const revalidate = 60;

function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function formatDelta(today: number, yesterday: number): { label: string; tone: "up" | "down" | "flat" } {
  if (yesterday === 0 && today === 0) return { label: "변동 없음", tone: "flat" };
  if (yesterday === 0) return { label: "신규 발생", tone: "up" };
  const diff = ((today - yesterday) / yesterday) * 100;
  if (Math.abs(diff) < 0.5) return { label: "전일 동일", tone: "flat" };
  const sign = diff > 0 ? "↑" : "↓";
  return {
    label: `${sign} ${Math.abs(diff).toFixed(0)}% vs 어제`,
    tone: diff > 0 ? "up" : "down",
  };
}

export default async function StatsPage() {
  const user = await getCurrentUser();
  if (user?.role !== ROLES.owner) {
    redirect("/stats/inquiries");
  }

  const [sentry, inquiries, inquiriesTrend, funnel, traffic, topPages, devices] =
    await Promise.all([
      getSentrySummary(),
      getInquiriesSummary(),
      getInquiriesDailyTrend(7),
      getFunnelSummary(7),
      getTrafficSummary(),
      getTopPages(1, 4),
      getDeviceBreakdown(1),
    ]);

  // Build 7-day labels + values for the inquiry mini-bars
  const today = new Date();
  const last7DayLabels: string[] = [];
  const last7DayValues: number[] = [];
  const trendMap = new Map(inquiriesTrend.map((p) => [p.day, p.count]));
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7DayValues.push(trendMap.get(key) ?? 0);
    last7DayLabels.push(formatDateForDisplay(d));
  }

  const inquiryDelta = formatDelta(inquiries.today, inquiries.yesterday);

  // Device split for traffic panel
  const mobile = devices.find((d) => /mobile/i.test(d.deviceType))?.pct ?? 0;
  const desktop = devices.find((d) => /desktop/i.test(d.deviceType))?.pct ?? 0;

  return (
    <section
      data-component="desktop_stats_page"
      className="flex flex-col gap-6 pb-10"
    >
      <Block name="desktop_stats_page_hero" className="shrink-0">
        <StatsHero
          dataComponent="desktop_stats_page_hero_content"
          title="오늘 통계"
          subtitle="4개 패널 한눈에 — 오류, 상담, 페이지 이동, 트래픽"
          rightValue={formatDateForDisplay(today)}
          ariaLabel="통계 개요"
        />
      </Block>

      <Block name="desktop_stats_page_grid" className="flex-1 min-h-0">
        <div
          data-component="desktop_stats_page_grid_inner"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
          {/* Panel 1: 오류 통계 */}
          <PanelCard
            title="오류 통계"
            iconEmoji="⚠"
            source="Sentry"
            detailHref="/stats/errors"
            dataComponent="desktop_stats_page_grid_inner_panel-errors"
          >
            <div className="flex items-baseline gap-3">
              <span
                data-component="desktop_stats_page_grid_inner_panel-errors-count"
                className="text-[2.4rem] font-bold leading-none tabular-nums text-red-600"
              >
                {sentry.openCount}
              </span>
              <span className="text-[0.85rem] text-v3-text-muted">미해결 이슈</span>
              <span
                className={`ml-auto text-[0.7rem] font-semibold rounded-full px-2.5 py-1 ${
                  sentry.newIn24h > 0
                    ? "bg-red-100 text-red-700"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {sentry.newIn24h > 0 ? `↑ ${sentry.newIn24h}건 (24시간)` : "신규 없음"}
              </span>
            </div>
            <Sparkline values={sentry.sparkline7d} color="hsl(0 84% 55%)" />
            {sentry.topIssue ? (
              <div className="rounded-2xl bg-v3-dim-white p-3.5">
                <div className="text-[0.62rem] font-bold uppercase tracking-wider text-v3-text-muted mb-1.5">
                  주요 오류
                </div>
                <div className="text-[0.82rem] font-semibold text-v3-text truncate">
                  {sentry.topIssue.title}
                </div>
                <div className="text-[0.65rem] font-mono text-v3-text-muted truncate">
                  {sentry.topIssue.culprit ?? sentry.topIssue.filename ?? "—"}
                  {" · "}
                  {sentry.topIssue.count}건 · {formatSentryRelativeTime(sentry.topIssue.lastSeen)}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-v3-dim-white p-3.5 text-[0.78rem] text-v3-text-muted">
                미해결 이슈가 없어요 🎉
              </div>
            )}
          </PanelCard>

          {/* Panel 2: 상담 신청 */}
          <PanelCard
            title="상담 신청"
            iconEmoji="📝"
            source="PostHog"
            detailHref="/stats/inquiries"
            dataComponent="desktop_stats_page_grid_inner_panel-inquiries"
          >
            <div className="flex items-baseline gap-3">
              <span
                data-component="desktop_stats_page_grid_inner_panel-inquiries-count"
                className="text-[2.4rem] font-bold leading-none tabular-nums text-v3-primary"
              >
                {inquiries.today}
              </span>
              <span className="text-[0.85rem] text-v3-text-muted">건 (오늘)</span>
              <span
                className={`ml-auto text-[0.7rem] font-semibold rounded-full px-2.5 py-1 ${
                  inquiryDelta.tone === "up"
                    ? "bg-green-100 text-green-700"
                    : inquiryDelta.tone === "down"
                      ? "bg-red-100 text-red-700"
                      : "bg-v3-dim-white text-v3-text-muted"
                }`}
              >
                {inquiryDelta.label}
              </span>
            </div>
            <MiniBars values={last7DayValues} labels={last7DayLabels} />
            <div className="text-[0.78rem] text-v3-text-muted">
              7일 평균{" "}
              <strong className="text-v3-text tabular-nums">
                {inquiries.sevenDayAvg.toFixed(1)}
              </strong>
              건 · 최근 신청{" "}
              <strong className="text-v3-text">
                {formatRelativeKo(inquiries.lastSubmissionAt)}
              </strong>
            </div>
          </PanelCard>

          {/* Panel 3: 페이지 이동 통계 (funnel) */}
          <PanelCard
            title="페이지 이동 통계"
            iconEmoji="🔀"
            source="PostHog"
            detailHref="/stats/funnel"
            dataComponent="desktop_stats_page_grid_inner_panel-funnel"
          >
            <FunnelBars
              dataComponent="desktop_stats_page_grid_panel-funnel_bars"
              steps={funnel.steps}
              biggestDropStep={funnel.biggestDropStep}
              variant="compact"
            />
            {funnel.biggestDropStep && funnel.steps[funnel.biggestDropStep - 1] ? (
              <div className="rounded-md border-l-[3px] border-red-500 bg-red-50 px-3 py-2 text-[0.78rem] text-red-700">
                ⚠ {funnel.biggestDropStep}단계에서{" "}
                <strong>
                  −{funnel.steps[funnel.biggestDropStep - 1].dropFromPrevPct.toFixed(0)}%
                </strong>{" "}
                감소 · 가장 큰 이탈
              </div>
            ) : funnel.totalEntries === 0 ? (
              <div className="text-[0.78rem] text-v3-text-muted">
                펀널 진입 이벤트가 아직 없어요.
              </div>
            ) : (
              <div className="rounded-md border-l-[3px] border-green-500 bg-green-50 px-3 py-2 text-[0.78rem] text-green-700">
                ✓ 전환율 {formatPct(funnel.conversionRate, 1)} · 단계별 이탈 안정적
              </div>
            )}
          </PanelCard>

          {/* Panel 4: 사이트 트래픽 */}
          <PanelCard
            title="사이트 트래픽"
            iconEmoji="🌐"
            source="PostHog"
            detailHref="/stats/traffic"
            dataComponent="desktop_stats_page_grid_inner_panel-traffic"
          >
            <div className="grid grid-cols-3 gap-3">
              <div data-component="desktop_stats_page_grid_inner_panel-traffic-pv">
                <div className="text-[0.65rem] font-medium text-v3-text-muted">페이지뷰</div>
                <div className="text-[1.55rem] font-bold tabular-nums leading-none mt-1">
                  {traffic.today.pv.toLocaleString("ko-KR")}
                </div>
              </div>
              <div data-component="desktop_stats_page_grid_inner_panel-traffic-unique">
                <div className="text-[0.65rem] font-medium text-v3-text-muted">방문자</div>
                <div className="text-[1.55rem] font-bold tabular-nums leading-none mt-1">
                  {traffic.today.unique.toLocaleString("ko-KR")}
                </div>
              </div>
              <div data-component="desktop_stats_page_grid_inner_panel-traffic-session">
                <div className="text-[0.65rem] font-medium text-v3-text-muted">평균 방문 시간</div>
                <div className="text-[1.55rem] font-bold tabular-nums leading-none mt-1">
                  {traffic.today.pv === 0
                    ? "-"
                    : `${Math.floor(traffic.avgSessionSeconds / 60)}:${String(Math.round(traffic.avgSessionSeconds % 60)).padStart(2, "0")}`}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[0.62rem] font-bold uppercase tracking-wider text-v3-text-muted mb-1.5">
                인기 페이지
              </div>
              <div data-component="desktop_stats_page_grid_inner_panel-traffic-top-pages">
                {topPages.length === 0 ? (
                  <div className="py-2 text-[0.75rem] text-v3-text-muted">데이터 없음</div>
                ) : (
                  topPages.map((p) => (
                    <div
                      key={p.path}
                      className="flex justify-between items-center py-1.5 border-b border-v3-border last:border-0 text-[0.78rem]"
                    >
                      <span className="font-mono text-v3-text truncate mr-2">{p.path}</span>
                      <span className="font-semibold tabular-nums shrink-0">{p.pv}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="flex h-2 rounded-full overflow-hidden bg-v3-dim-white">
                <div
                  className="bg-v3-primary"
                  style={{ width: `${mobile}%` }}
                />
                <div
                  className="bg-blue-400"
                  style={{ width: `${desktop}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[0.7rem] text-v3-text-muted">
                <span>
                  <strong className="text-v3-text">Mobile</strong> {mobile.toFixed(0)}%
                </span>
                <span>
                  <strong className="text-v3-text">Desktop</strong> {desktop.toFixed(0)}%
                </span>
              </div>
            </div>
          </PanelCard>
        </div>
      </Block>
    </section>
  );
}
