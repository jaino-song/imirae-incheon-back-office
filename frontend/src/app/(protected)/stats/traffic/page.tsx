import { redirect } from "next/navigation";
import { Block } from "@/components/app/v3/Block";
import { getCurrentUser } from "@/lib/auth/cookies";
import { ROLES } from "@/lib/constants/roles";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  getTrafficSummary,
  getTrafficTrend,
  getTopPages,
  getDeviceBreakdown,
  getBrowserBreakdown,
  getSourceBreakdown,
  getRegionBreakdown,
} from "@/lib/observability/posthog";
import { StatsHero } from "../_components/StatsHero";
import { KpiCard } from "../_components/KpiCard";

export const metadata = { title: "사이트 트래픽 · 통계" };
export const revalidate = 60;

function formatDelta(today: number, yesterday: number) {
  if (yesterday === 0 && today === 0) return { label: "—", tone: "flat" as const };
  if (yesterday === 0) return { label: "신규", tone: "up" as const };
  const diff = ((today - yesterday) / yesterday) * 100;
  const sign = diff > 0 ? "↑" : "↓";
  return {
    label: `${sign} ${Math.abs(diff).toFixed(1)}%`,
    tone: (diff >= 0 ? "up" : "down") as "up" | "down",
  };
}

export default async function TrafficDetailPage() {
  const user = await getCurrentUser();
  if (user?.role !== ROLES.owner) {
    redirect("/stats/inquiries");
  }

  const [summary, trend, topPages, devices, browsers, sources, regions] =
    await Promise.all([
      getTrafficSummary(),
      getTrafficTrend(7),
      getTopPages(7, 10),
      getDeviceBreakdown(7),
      getBrowserBreakdown(7),
      getSourceBreakdown(7),
      getRegionBreakdown(7),
    ]);

  const pvDelta = formatDelta(summary.today.pv, summary.yesterday.pv);
  const uniqueDelta = formatDelta(summary.today.unique, summary.yesterday.unique);

  // Build 7-day chart
  const todayDate = new Date();
  const trendMap = new Map(trend.map((p) => [p.day, p]));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const found = trendMap.get(key);
    return { date: d, pv: found?.pv ?? 0, unique: found?.unique ?? 0 };
  });
  const maxValue = Math.max(1, ...last7.map((p) => p.pv));
  const chartW = 1100;
  const chartH = 200;
  const padL = 40;
  const padR = 20;
  const usableW = chartW - padL - padR;
  const yFor = (v: number) => chartH - 36 - (v / maxValue) * (chartH - 56);
  const pvPoints = last7.map((p, i) => {
    const x = padL + (i / 6) * usableW;
    return `${x.toFixed(1)},${yFor(p.pv).toFixed(1)}`;
  });
  const uniquePoints = last7.map((p, i) => {
    const x = padL + (i / 6) * usableW;
    return `${x.toFixed(1)},${yFor(p.unique).toFixed(1)}`;
  });
  const pvLine = pvPoints.length ? `M${pvPoints.join(" L")}` : "";
  const uniqueLine = uniquePoints.length ? `M${uniquePoints.join(" L")}` : "";
  const pvArea =
    pvPoints.length > 0
      ? `M${padL},${chartH - 36} L${pvPoints.join(" L")} L${
          padL + usableW
        },${chartH - 36} Z`
      : "";

  const mobile = devices.find((d) => /mobile/i.test(d.deviceType)) ?? { pct: 0, count: 0 };
  const desktop = devices.find((d) => /desktop/i.test(d.deviceType)) ?? { pct: 0, count: 0 };

  return (
    <section data-component="desktop_stats-traffic_page" className="flex flex-col gap-6 pb-10">
      <Block name="desktop_stats-traffic_page_hero" className="shrink-0">
        <StatsHero
          title="사이트 트래픽"
          subtitle="PostHog · 페이지뷰/방문자/소스/디바이스/지역 상세 분석"
          rightValue={formatDateForDisplay(todayDate)}
          backHref="/stats"
          backLabel="통계 overview로"
          dataComponent="desktop_stats-traffic_page_hero_content"
        />
      </Block>

      <Block name="desktop_stats-traffic_page_kpi" className="shrink-0">
        <div
          data-component="desktop_stats-traffic_page_kpi_grid"
          className="grid grid-cols-2 lg:grid-cols-5 gap-3"
        >
          <KpiCard
            iconEmoji="🌐"
            label="조회수 (오늘)"
            value={summary.today.pv.toLocaleString("ko-KR")}
            delta={pvDelta}
            dataComponent="desktop_stats-traffic_page_kpi_grid_card-pv"
          />
          <KpiCard
            iconEmoji="👥"
            label="방문자"
            value={summary.today.unique.toLocaleString("ko-KR")}
            delta={uniqueDelta}
            dataComponent="desktop_stats-traffic_page_kpi_grid_card-unique"
          />
          <KpiCard
            iconEmoji="⏱"
            label="평균 방문 시간"
            value={
              summary.sevenDayTotal.pv === 0
                ? "-"
                : `${Math.floor(summary.avgSessionSeconds / 60)}:${String(Math.round(summary.avgSessionSeconds % 60)).padStart(2, "0")}`
            }
            dataComponent="desktop_stats-traffic_page_kpi_grid_card-session"
            valueSize="sm"
          />
          <KpiCard
            iconEmoji="↩"
            label="이탈률"
            value={summary.bounceRate.toFixed(1)}
            unit="%"
            tone={summary.bounceRate > 60 ? "warn" : "default"}
            dataComponent="desktop_stats-traffic_page_kpi_grid_card-bounce"
          />
          <KpiCard
            iconEmoji="✨"
            label="7일 합계"
            value={summary.sevenDayTotal.pv.toLocaleString("ko-KR")}
            unit="조회"
            meta={`방문자 ${summary.sevenDayTotal.unique}명`}
            dataComponent="desktop_stats-traffic_page_kpi_grid_card-week"
            valueSize="sm"
          />
        </div>
      </Block>

      <Block name="desktop_stats-traffic_page_trend">
        <div
          data-component="desktop_stats-traffic_page_trend_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">조회수 · 방문자 추이 (7일)</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <div className="ml-auto flex gap-3 text-[0.7rem]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-v3-primary" />
                조회수
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-purple-500" />
                방문자
              </span>
            </div>
          </header>
          {summary.sevenDayTotal.pv === 0 ? (
            <p className="text-center py-10 text-[0.85rem] text-v3-text-muted">
              지난 7일간 트래픽 데이터가 없어요.
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: chartH }}
            >
              <defs>
                <linearGradient id="traffic-pv-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(214 100% 34%)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="hsl(214 100% 34%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <line x1={padL} y1={chartH - 36} x2={chartW - padR} y2={chartH - 36} stroke="hsl(214 32% 91%)" />
              <line x1={padL} y1={yFor(maxValue * 0.5)} x2={chartW - padR} y2={yFor(maxValue * 0.5)} stroke="hsl(214 32% 91%)" strokeDasharray="3,3" />
              <line x1={padL} y1={yFor(maxValue)} x2={chartW - padR} y2={yFor(maxValue)} stroke="hsl(214 32% 91%)" strokeDasharray="3,3" />
              <text x={8} y={yFor(maxValue) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {maxValue.toFixed(0)}
              </text>
              <text x={8} y={yFor(maxValue * 0.5) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {Math.round(maxValue * 0.5)}
              </text>
              {pvArea && <path d={pvArea} fill="url(#traffic-pv-grad)" />}
              {pvLine && <path d={pvLine} stroke="hsl(214 100% 34%)" strokeWidth={2.5} fill="none" />}
              {uniqueLine && (
                <path
                  d={uniqueLine}
                  stroke="hsl(265 70% 55%)"
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray="4,3"
                />
              )}
              {last7.map((p, i) => {
                const x = padL + (i / 6) * usableW;
                return (
                  <g key={i}>
                    <circle cx={x} cy={yFor(p.pv)} r={3} fill="hsl(214 100% 34%)" />
                    {i === last7.length - 1 && (
                      <text x={x} y={yFor(p.pv) - 8} fontSize={11} fontWeight={600} fill="hsl(214 100% 34%)" textAnchor="middle">
                        {p.pv}
                      </text>
                    )}
                    <text
                      x={x}
                      y={chartH - 12}
                      fontSize={10}
                      fill={i === last7.length - 1 ? "hsl(214 100% 34%)" : "hsl(215 16% 47%)"}
                      fontWeight={i === last7.length - 1 ? 600 : 400}
                      textAnchor="middle"
                    >
                      {i === last7.length - 1
                        ? "오늘"
                        : `${p.date.getMonth() + 1}/${p.date.getDate()}`}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </Block>

      <Block
        name="desktop_stats-traffic_page_pages-sources"
        className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4"
      >
        <div
          data-component="desktop_stats-traffic_page_pages-sources_top-pages-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">인기 페이지</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {topPages.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">데이터 없음</p>
          ) : (
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="bg-v3-dim-white border-b border-v3-border">
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">경로</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">조회수</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">방문자</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">비중</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((p, i) => {
                  const share =
                    summary.sevenDayTotal.pv > 0
                      ? (p.pv / summary.sevenDayTotal.pv) * 100
                      : 0;
                  return (
                    <tr
                      key={`${p.path}-${i}`}
                      data-component="desktop_stats-traffic_page_pages-sources_top-pages-card_body_row"
                      className="border-b border-v3-border last:border-0 hover:bg-v3-dim-white"
                    >
                      <td className="px-3 py-3 font-mono text-v3-text">{p.path}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{p.pv}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.unique}</td>
                      <td className="px-3 py-3 text-right text-v3-text-muted tabular-nums">
                        {share.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div
          data-component="desktop_stats-traffic_page_pages-sources_sources-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">유입 소스</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {sources.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">데이터 없음</p>
          ) : (
            <div className="space-y-2.5">
              {sources.slice(0, 6).map((s) => (
                <div key={s.source} className="flex items-center gap-3">
                  <span className="w-[110px] truncate text-[0.78rem] font-medium">{s.source}</span>
                  <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[0.78rem] font-semibold tabular-nums">
                    {s.count}
                    <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">{s.pct.toFixed(0)}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Block>

      <Block
        name="desktop_stats-traffic_page_device-region"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <div
          data-component="desktop_stats-traffic_page_device-region_device-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">디바이스 · 브라우저</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          <div className="space-y-5">
            <div>
              <div className="text-[0.62rem] font-bold uppercase tracking-wider text-v3-text-muted mb-2">
                디바이스
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-v3-dim-white">
                <div className="bg-v3-primary" style={{ width: `${mobile.pct}%` }} />
                <div className="bg-blue-400" style={{ width: `${desktop.pct}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[0.72rem]">
                <span>
                  <strong>📱 Mobile</strong> {mobile.pct.toFixed(0)}% · {mobile.count}
                </span>
                <span>
                  <strong>💻 Desktop</strong> {desktop.pct.toFixed(0)}% · {desktop.count}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[0.62rem] font-bold uppercase tracking-wider text-v3-text-muted mb-2">
                브라우저
              </div>
              {browsers.length === 0 ? (
                <p className="text-[0.78rem] text-v3-text-muted">데이터 없음</p>
              ) : (
                <div>
                  {browsers.slice(0, 6).map((b) => (
                    <div
                      key={b.browser}
                      className="flex justify-between items-center py-1.5 border-b border-v3-border last:border-0 text-[0.78rem]"
                    >
                      <span className="text-v3-text">{b.browser}</span>
                      <span className="font-semibold tabular-nums">
                        {b.pct.toFixed(1)}% · {b.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          data-component="desktop_stats-traffic_page_device-region_region-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">지역</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {regions.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              지역 데이터가 없어요.
            </p>
          ) : (
            <div className="space-y-2.5">
              {regions.slice(0, 8).map((r) => (
                <div key={r.region} className="flex items-center gap-3">
                  <span className="w-[180px] truncate text-[0.78rem] font-medium">{r.region}</span>
                  <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[0.78rem] font-semibold tabular-nums">
                    {r.count}
                    <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">{r.pct.toFixed(0)}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Block>
    </section>
  );
}
