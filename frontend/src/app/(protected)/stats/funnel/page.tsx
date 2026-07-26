import { redirect } from "next/navigation";
import { Block } from "@/components/app/v3/Block";
import { getCurrentUser } from "@/lib/auth/cookies";
import { ROLES } from "@/lib/constants/roles";
import {
  getEntryPages,
  getExitPages,
  getFunnelSummary,
  getPageNavSummary,
  getPagesDetail,
  getPageTransitions,
} from "@/lib/observability/posthog";
import { StatsHero } from "../_components/StatsHero";
import { KpiCard } from "../_components/KpiCard";
import { FunnelBars } from "../_components/FunnelBars";
import { InfoTooltip } from "../_components/InfoTooltip";

export const metadata = { title: "페이지 이동 통계 · 통계" };
export const revalidate = 60;

export default async function FunnelDetailPage() {
  const user = await getCurrentUser();
  if (user?.role !== ROLES.owner) {
    redirect("/stats/inquiries");
  }

  const [
    navSummary,
    pages,
    entryPages,
    exitPages,
    transitions,
    conversionFunnel,
  ] = await Promise.all([
    getPageNavSummary(7),
    getPagesDetail(7, 20),
    getEntryPages(7, 8),
    getExitPages(7, 8),
    getPageTransitions(7, 12),
    getFunnelSummary(7),
  ]);

  const maxPv = Math.max(1, ...pages.map((p) => p.pv));
  const maxEntry = Math.max(1, ...entryPages.map((p) => p.count));
  const maxExit = Math.max(1, ...exitPages.map((p) => p.count));
  const maxTransition = Math.max(1, ...transitions.map((t) => t.count));

  return (
    <section data-component="desktop_stats-funnel_page" className="flex flex-col gap-6 pb-10">
      <Block name="desktop_stats-funnel_page_hero" className="shrink-0">
        <StatsHero
          title="페이지 이동 통계"
          subtitle="PostHog · 각 페이지의 트래픽 + 페이지 간 이동 경로"
          rightLabel="기간"
          rightValue="최근 7일"
          backHref="/stats"
          backLabel="통계 overview로"
          dataComponent="desktop_stats-funnel_page_hero_content"
        />
      </Block>

      <Block name="desktop_stats-funnel_page_kpi" className="shrink-0">
        <div
          data-component="desktop_stats-funnel_page_kpi_grid"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <KpiCard
            iconEmoji="📄"
            label="활성 페이지"
            value={navSummary.activePages}
            unit="개"
            dataComponent="desktop_stats-funnel_page_kpi_grid_card-pages"
            infoText={
              "지난 7일 동안 조회수가 1회 이상 기록된 페이지 수."
            }
          />
          <KpiCard
            iconEmoji="👁"
            label="총 조회수 (7일)"
            value={navSummary.totalPv.toLocaleString("ko-KR")}
            dataComponent="desktop_stats-funnel_page_kpi_grid_card-pv"
            infoText={
              "지난 7일간 발생한 전체 페이지 조회 횟수.\n같은 사용자의 반복 방문도 모두 포함."
            }
          />
          <KpiCard
            iconEmoji="∅"
            label="평균 조회수/페이지"
            value={navSummary.avgPvPerPage.toFixed(1)}
            dataComponent="desktop_stats-funnel_page_kpi_grid_card-avg"
            infoText={
              "총 조회수 ÷ 활성 페이지 수.\n페이지당 평균 방문 빈도를 나타냅니다."
            }
          />
          <KpiCard
            iconEmoji="↩"
            label="평균 이탈률"
            value={navSummary.avgBouncePct.toFixed(1)}
            unit="%"
            tone={navSummary.avgBouncePct > 60 ? "warn" : "default"}
            dataComponent="desktop_stats-funnel_page_kpi_grid_card-bounce"
            infoText={
              "한 방문에서 한 페이지만 보고 떠난 비율.\n다른 페이지로 이동하지 않고 나간 사용자의 비중을 나타냅니다."
            }
          />
        </div>
      </Block>

      {/* Main: per-page detail table */}
      <Block name="desktop_stats-funnel_page_pages">
        <div
          data-component="desktop_stats-funnel_page_pages_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6 overflow-hidden"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">페이지별 상세 (지난 7일)</h3>
            <InfoTooltip
              text={
                "각 페이지의 조회수, 방문자, 시작 페이지로 쓰인 횟수, 종료 페이지로 쓰인 횟수, 그 페이지에서 시작한 세션 중 한 페이지만 보고 나간 비율(이탈률)을 보여줍니다."
              }
              dataComponent="desktop_stats-funnel_page_pages_card_head_info"
            />
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">
              총 {pages.length}개 페이지
            </span>
          </header>
          {pages.length === 0 ? (
            <p className="text-center py-8 text-[0.85rem] text-v3-text-muted">
              지난 7일간 트래픽이 없어요.
            </p>
          ) : (
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="bg-v3-dim-white border-b border-v3-border">
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">경로</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">조회수</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">방문자</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">시작</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">종료</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">이탈률</th>
                  <th className="font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">조회수 분포</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p, i) => (
                  <tr
                    key={`${p.path}-${i}`}
                    data-component="desktop_stats-funnel_page_pages_card_body_row"
                    className="border-b border-v3-border last:border-0 hover:bg-v3-dim-white"
                  >
                    <td className="px-3 py-3 font-mono text-v3-text">{p.path}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{p.pv}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.unique}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.entries}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.exits}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${
                        p.bouncePct > 60 ? "text-red-600 font-semibold" : ""
                      }`}
                    >
                      {p.entries === 0 ? "—" : `${p.bouncePct.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-2 rounded-full bg-v3-dim-white overflow-hidden min-w-[80px]">
                        <div
                          className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                          style={{ width: `${(p.pv / maxPv) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Block>

      {/* Entry & Exit pages */}
      <Block
        name="desktop_stats-funnel_page_entry-exit"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <div
          data-component="desktop_stats-funnel_page_entry-exit_entry-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">주요 시작 페이지</h3>
            <InfoTooltip
              text={
                "각 세션의 첫 페이지뷰(entry page) 통계.\n사용자가 사이트에 들어왔을 때 가장 자주 보는 페이지를 표시합니다."
              }
              dataComponent="desktop_stats-funnel_page_entry-exit_entry-card_head_info"
            />
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {entryPages.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              세션 데이터가 아직 없어요.
            </p>
          ) : (
            <div className="space-y-2.5">
              {entryPages.map((p) => (
                <div key={p.path} className="flex items-center gap-3">
                  <span className="w-[130px] truncate text-[0.78rem] font-mono text-v3-text">
                    {p.path}
                  </span>
                  <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                      style={{ width: `${(p.count / maxEntry) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-[0.78rem] font-semibold tabular-nums">
                    {p.count}
                    <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">
                      {p.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          data-component="desktop_stats-funnel_page_entry-exit_exit-card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">주요 종료 페이지</h3>
            <InfoTooltip
              text={
                "각 세션의 마지막 페이지뷰(exit page) 통계.\n사용자가 사이트를 떠나기 직전에 가장 자주 본 페이지를 표시합니다."
              }
              dataComponent="desktop_stats-funnel_page_entry-exit_exit-card_head_info"
            />
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {exitPages.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              세션 데이터가 아직 없어요.
            </p>
          ) : (
            <div className="space-y-2.5">
              {exitPages.map((p) => (
                <div key={p.path} className="flex items-center gap-3">
                  <span className="w-[130px] truncate text-[0.78rem] font-mono text-v3-text">
                    {p.path}
                  </span>
                  <div className="flex-1 h-5 rounded-md bg-v3-dim-white overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-500 to-red-600"
                      style={{ width: `${(p.count / maxExit) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-[0.78rem] font-semibold tabular-nums">
                    {p.count}
                    <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">
                      {p.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Block>

      {/* Page transitions */}
      <Block name="desktop_stats-funnel_page_transitions">
        <div
          data-component="desktop_stats-funnel_page_transitions_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">주요 페이지 이동 경로</h3>
            <InfoTooltip
              text={
                "한 세션 안에서 사용자가 페이지 A를 본 직후 페이지 B로 이동한 횟수.\n가장 자주 발생한 이동 경로를 통해 자연스러운 네비게이션 흐름을 파악합니다."
              }
              dataComponent="desktop_stats-funnel_page_transitions_card_head_info"
            />
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">
              상위 {transitions.length}개
            </span>
          </header>
          {transitions.length === 0 ? (
            <p className="text-center py-8 text-[0.85rem] text-v3-text-muted">
              연속된 페이지뷰 데이터가 아직 없어요. (한 방문에서 페이지를 2개 이상 발생해야 표시됩니다)
            </p>
          ) : (
            <div className="space-y-2">
              {transitions.map((t, i) => (
                <div
                  key={`${t.fromPath}-${t.toPath}-${i}`}
                  data-component="desktop_stats-funnel_page_transitions_card_transition-row"
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-v3-dim-white"
                >
                  <span className="font-mono text-[0.78rem] text-v3-text shrink-0 max-w-[180px] truncate">
                    {t.fromPath}
                  </span>
                  <span className="text-v3-primary text-base shrink-0">→</span>
                  <span className="font-mono text-[0.78rem] text-v3-text shrink-0 max-w-[180px] truncate">
                    {t.toPath}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-v3-dim-white overflow-hidden mx-2 min-w-[60px]">
                    <div
                      className="h-full bg-gradient-to-r from-v3-primary to-blue-700"
                      style={{ width: `${(t.count / maxTransition) * 100}%` }}
                    />
                  </div>
                  <span className="text-[0.78rem] font-semibold tabular-nums shrink-0 w-16 text-right">
                    {t.count}회
                    <span className="ml-1 text-[0.65rem] font-normal text-v3-text-muted">
                      {t.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Block>

      {/* Conversion funnel (kept as a featured "주요 전환 펀널") */}
      <Block name="desktop_stats-funnel_page_conversion">
        <div
          data-component="desktop_stats-funnel_page_conversion_card"
          className="animate-v3-slide-up bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">
              핵심 전환 펀널 · 가격 → 상담
            </h3>
            <InfoTooltip
              text={
                "가격 페이지 진입부터 상담 신청 제출까지 5단계의 사용자 흐름 (지난 7일).\n사이트의 핵심 비즈니스 전환 경로를 별도로 추적합니다."
              }
              dataComponent="desktop_stats-funnel_page_conversion_card_head_info"
            />
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
            <span className="ml-auto text-[0.7rem] text-v3-text-muted">
              전환율{" "}
              <strong className="text-v3-text">
                {conversionFunnel.conversionRate.toFixed(1)}%
              </strong>
            </span>
          </header>
          <FunnelBars
            dataComponent="desktop_stats-funnel_page_conversion_card_body_bars"
            steps={conversionFunnel.steps}
            biggestDropStep={conversionFunnel.biggestDropStep}
            variant="verbose"
          />
        </div>
      </Block>
    </section>
  );
}
