import { redirect } from "next/navigation";
import { Block } from "@/components/app/v3/Block";
import { getCurrentUser } from "@/lib/auth/cookies";
import { ROLES } from "@/lib/constants/roles";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  getInquiriesSummary,
  getInquiriesDailyTrend,
  getInquiriesHourlyToday,
  getInquiriesByBranch,
  getRecentInquiries,
  formatRelativeKo,
} from "@/lib/observability/posthog";
import { StatsHero } from "../_components/StatsHero";
import { KpiCard } from "../_components/KpiCard";

export const metadata = { title: "상담 신청 · 통계" };
export const revalidate = 60;

export default async function InquiriesDetailPage() {
  const user = await getCurrentUser();
  const isOwner = user?.role === ROLES.owner;
  const branchSlug = isOwner ? null : user?.branchSlug ?? null;

  // Fail-closed: a non-owner without a usable branchSlug would otherwise
  // run PostHog queries with an empty branch filter and see cross-branch
  // inquiries. Block before any fetch.
  if (!isOwner && !branchSlug) {
    redirect("/dashboard");
  }

  const [summary, daily, hourly, recent] = await Promise.all([
    getInquiriesSummary(branchSlug),
    getInquiriesDailyTrend(30, branchSlug),
    getInquiriesHourlyToday(branchSlug),
    getRecentInquiries(10, branchSlug),
  ]);
  const byBranch = isOwner ? await getInquiriesByBranch(7) : [];

  // Build last-30-day bar data
  const dailyMap = new Map(daily.map((p) => [p.day, p.count]));
  const today = new Date();
  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: d, count: dailyMap.get(key) ?? 0 };
  });
  const maxDaily = Math.max(1, ...last30.map((p) => p.count));

  const maxHourly = Math.max(1, ...hourly.map((p) => p.count));
  const maxBranch = Math.max(1, ...byBranch.map((b) => b.count));

  return (
    <section data-component="desktop_stats-inquiries_page" className="flex flex-col gap-6 pb-10">
      <Block name="desktop_stats-inquiries_page_hero" className="shrink-0">
        <StatsHero
          title={isOwner ? "상담 신청 통계" : `${user?.branchName ?? "내 지점"} 상담 신청 통계`}
          subtitle={
            isOwner
              ? "PostHog · 일별/시간대별/지점별/소스별 분석"
              : "PostHog · 일별/시간대별/소스별 분석"
          }
          rightValue={formatDateForDisplay(today)}
          backHref={isOwner ? "/stats" : undefined}
          backLabel={isOwner ? "통계 overview로" : undefined}
          dataComponent="desktop_stats-inquiries_page_hero_content"
        />
      </Block>

      <Block name="desktop_stats-inquiries_page_kpi" className="shrink-0">
        <div
          data-component="desktop_stats-inquiries_page_kpi_grid"
          className="grid grid-cols-2 lg:grid-cols-5 gap-3"
        >
          <KpiCard
            iconEmoji="📝"
            label="오늘"
            value={summary.today}
            unit="건"
            tone="success"
            dataComponent="desktop_stats-inquiries_page_kpi_grid_card-today"
          />
          <KpiCard
            iconEmoji="📅"
            label="어제"
            value={summary.yesterday}
            unit="건"
            dataComponent="desktop_stats-inquiries_page_kpi_grid_card-yesterday"
          />
          <KpiCard
            iconEmoji="📊"
            label="7일 합계"
            value={summary.sevenDayTotal}
            unit="건"
            meta={`평균 ${summary.sevenDayAvg.toFixed(1)}건/일`}
            dataComponent="desktop_stats-inquiries_page_kpi_grid_card-week"
          />
          <KpiCard
            iconEmoji="🔀"
            label="전환율"
            value={summary.conversionRate.toFixed(1)}
            unit="%"
            dataComponent="desktop_stats-inquiries_page_kpi_grid_card-conversion"
          />
          <KpiCard
            iconEmoji="⏱"
            label="최근 신청"
            value={formatRelativeKo(summary.lastSubmissionAt)}
            dataComponent="desktop_stats-inquiries_page_kpi_grid_card-last"
            valueSize="sm"
          />
        </div>
      </Block>

      <Block name="desktop_stats-inquiries_page_daily">
        <div
          data-component="desktop_stats-inquiries_page_daily_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">일별 상담 신청 (최근 30일)</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">
              총 {summary.thirtyDayTotal}건
            </span>
          </header>
          {summary.thirtyDayTotal === 0 ? (
            <p className="text-center py-10 text-[0.85rem] text-v3-text-muted">
              최근 30일간 상담 신청이 없어요.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-1.5 h-[160px]">
                {last30.map((p, i) => {
                  const pct = (p.count / maxDaily) * 100;
                  const isToday = i === 29;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t-md ${
                        isToday ? "bg-v3-primary" : "bg-blue-300/70"
                      }`}
                      style={{ height: `${Math.max(pct, 2)}%` }}
                      title={`${formatDateForDisplay(p.date)}: ${p.count}건`}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[0.65rem] text-v3-text-muted">
                <span>{formatDateForDisplay(last30[0].date)}</span>
                <span>{formatDateForDisplay(last30[14].date)}</span>
                <span className="text-v3-primary font-semibold">오늘 ({summary.today})</span>
              </div>
            </>
          )}
        </div>
      </Block>

      <Block
        name="desktop_stats-inquiries_page_breakdown"
        className={isOwner ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"}
      >
        {/* Hourly today */}
        <div
          data-component="desktop_stats-inquiries_page_breakdown_hourly-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">오늘 시간대별</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {hourly.every((p) => p.count === 0) ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              오늘은 아직 상담 신청이 없어요.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-[3px] h-[110px]">
                {hourly.map((p) => {
                  const pct = (p.count / maxHourly) * 100;
                  const currentHour = new Date().getHours();
                  const isCurrent = p.hour === currentHour;
                  return (
                    <div
                      key={p.hour}
                      className={`flex-1 rounded-t-sm ${
                        isCurrent
                          ? "bg-v3-primary"
                          : p.count > 0
                            ? "bg-blue-300/70"
                            : "bg-v3-dim-white"
                      }`}
                      style={{ height: `${Math.max(pct, 3)}%` }}
                      title={`${p.hour}시: ${p.count}건`}
                    />
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[0.65rem] text-v3-text-muted">
                <span>00시</span>
                <span>06시</span>
                <span>12시</span>
                <span>18시</span>
              </div>
            </>
          )}
        </div>

        {/* By branch — owner only */}
        {isOwner && (
          <div
            data-component="desktop_stats-inquiries_page_breakdown_branch-card"
            className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
          >
            <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
              <h3 className="text-[0.95rem] font-bold text-v3-text">지점별 분포 (7일)</h3>
              <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
                PostHog
              </span>
            </header>
            {byBranch.length === 0 ? (
              <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
                지점별 데이터가 아직 없어요.
              </p>
            ) : (
              <div className="space-y-2">
                {byBranch.slice(0, 6).map((b) => (
                  <div key={b.branchSlug} className="flex items-center gap-3">
                    <span className="w-[120px] truncate text-[0.78rem] font-medium">
                      {b.branchSlug}
                    </span>
                    <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                        style={{ width: `${(b.count / maxBranch) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[0.78rem] font-semibold tabular-nums">
                      {b.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Block>

      <Block name="desktop_stats-inquiries_page_recent">
        <div
          data-component="desktop_stats-inquiries_page_recent_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">최근 상담 신청</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <span className="ml-auto text-[0.65rem] font-mono text-v3-text-muted">
              PII 마스킹 적용
            </span>
          </header>
          {recent.length === 0 ? (
            <p className="text-center py-8 text-[0.85rem] text-v3-text-muted">
              최근 7일간 상담 신청이 없어요.
            </p>
          ) : (
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="bg-v3-dim-white border-b border-v3-border">
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">신청 ID</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">지점</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">경로</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">시간</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">디바이스</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr
                    key={`${r.distinctId}-${i}`}
                    data-component="desktop_stats-inquiries_page_recent_card_body_row"
                    className="border-b border-v3-border last:border-0 hover:bg-v3-dim-white"
                  >
                    <td className="px-3 py-3 font-mono text-[0.72rem] text-v3-text-muted">
                      #{r.distinctId}
                    </td>
                    <td className="px-3 py-3">{r.branchSlug ?? "—"}</td>
                    <td className="px-3 py-3 truncate max-w-[260px]">
                      {r.pathname ?? "—"}
                      {r.source ? ` · ${r.source}` : ""}
                    </td>
                    <td className="px-3 py-3 text-right text-v3-text-muted text-[0.75rem]">
                      {new Date(r.timestamp).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-3 text-right text-[0.75rem]">
                      {r.deviceType === "Mobile"
                        ? "📱 Mobile"
                        : r.deviceType === "Desktop"
                          ? "💻 Desktop"
                          : r.deviceType ?? "—"}
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
