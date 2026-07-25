"use client";

import { useMemo, useState } from "react";

import { ListCard, ListItemRow, ListLoadMoreButton, ListLoadMoreSentinel } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailHeader,
  MobileDetailPage,
  MobileSearchBar,
  MobileDetailSheet,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import {
  useConsultationInquiries,
  useMarkConsultationInquiryAsRead,
} from "@/hooks/use-consultation-inquiries";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import type { ConsultationInquiry } from "@/lib/consultation-inquiry/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import "@/components/app/mobile-redesign/redesign.css";

type ConsultationStatus = "unread" | "confirmed";
type VoucherKind = "govt" | "self";
type DetailTabId = "info" | "inquiry";

interface ConsultationRow {
  id: string;
  initial: string;
  name: string;
  voucher: string;
  voucherKind: VoucherKind;
  due: string;
  right: string;
  status: ConsultationStatus;
  contact: string;
  source: string;
  sourceShort: string;
  region: string;
  address: string;
  birthExperience: string;
  preferredCaregiverName: string | null;
  selectedPlan: string | null;
  selectedPlanPrice: string | null;
  selectedDurationDays: number | null;
  selectedAddons: Array<{ name: string; quantity: number; priceLabel: string }>;
  inquiryStatus: string;
  referralSource: string;
  additionalNotes: string | null;
  confirmedAtLabel: string | null;
  dueDateLabel: string;
  branchName: string;
  privacyAcceptedAtLabel: string;
  createdAtLabel: string;
}

const ALL_FILTER = "전체";

function classifyVoucher(voucherType: string | null): VoucherKind {
  if (!voucherType) return "self";
  if (voucherType === "일반") return "self";
  return /^[A-Za-z]/.test(voucherType) ? "govt" : "self";
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 5 * minute) return "방금";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 2 * day) return "어제";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDueDate(iso: string): { short: string; long: string } {
  const formatted = formatDateForDisplay(iso);
  return { short: formatted === "-" ? "-" : `출산 예정 ${formatted}`, long: formatted };
}

function formatConfirmedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function normalizeSearchValue(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s-]/g, "");
}

function humanizeSource(source: string): string {
  if (source === "website") return "웹사이트";
  if (source === "app") return "앱";
  if (source === "phone") return "전화";
  return source || "-";
}

function shortSourceLabel(source: string): string {
  if (source === "website") return "웹사이트";
  if (source === "app") return "앱";
  if (source === "phone") return "전화";
  return source || "-";
}

function extractRegion(address: string): string {
  const parts = address.trim().split(/\s+/);
  return parts.slice(0, 2).join(" ") || address || "-";
}

function inquiryStatusLabel(status: string): string {
  if (status === "new") return "신규";
  if (status === "contacted") return "연락 중";
  if (status === "closed") return "완료";
  return status;
}

function serviceDurationLabel(durationDays: number | null): string {
  if (typeof durationDays !== "number") return "-";
  return `${durationDays}일`;
}

function toRow(inquiry: ConsultationInquiry): ConsultationRow {
  const initial = inquiry.motherName.trim().charAt(0) || "?";
  const due = formatDueDate(inquiry.dueDate);
  const voucher = inquiry.voucherType?.trim() || "일반";
  return {
    id: inquiry.id,
    initial,
    name: inquiry.motherName,
    voucher,
    voucherKind: classifyVoucher(inquiry.voucherType),
    due: due.short,
    right: formatRelativeTime(inquiry.createdAt),
    status: inquiry.readAt === null ? "unread" : "confirmed",
    contact: inquiry.phone,
    source: humanizeSource(inquiry.source),
    sourceShort: shortSourceLabel(inquiry.source),
    region: extractRegion(inquiry.address),
    address: inquiry.address,
    birthExperience: inquiry.birthExperience,
    preferredCaregiverName: inquiry.preferredCaregiverName,
    selectedPlan: inquiry.selectedServices?.plan?.name ?? null,
    selectedPlanPrice: inquiry.selectedServices?.plan?.priceLabel ?? null,
    selectedDurationDays: inquiry.selectedServices?.plan?.durationDays ?? null,
    selectedAddons:
      inquiry.selectedServices?.addons?.map((addon) => ({
        name: addon.name,
        quantity: addon.quantity,
        priceLabel: addon.priceLabel,
      })) ?? [],
    inquiryStatus: inquiry.status,
    referralSource: inquiry.referralSource,
    additionalNotes: inquiry.additionalNotes?.trim() || null,
    confirmedAtLabel: formatConfirmedAt(inquiry.readAt),
    dueDateLabel: due.long,
    branchName: inquiry.branchName ?? "-",
    privacyAcceptedAtLabel: formatConfirmedAt(inquiry.privacyAcceptedAt) ?? "-",
    createdAtLabel: formatConfirmedAt(inquiry.createdAt) ?? "-",
  };
}

function ConsultationDetail({
  row,
  activeTab,
  onTabChange,
  previousConsultationDates,
}: {
  row: ConsultationRow;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  previousConsultationDates: string[];
}) {
  return (
    <MobileDetailPage data-component="mobile_consultations_detail-sheet_stack_detail-page" name="consultations">
      <MobileDetailHeader data-component="mobile_consultations_detail-sheet_stack_detail-page_header"
        name="consultations"
        avatar={row.initial}
        avatarTone={row.status === "unread" ? "burgundy" : "green"}
        title={row.name}
        badges={[
          {
            label: row.status === "unread" ? "미확인" : "확인 완료",
            tone: row.status === "unread" ? "burgundy" : "green",
          },
          { label: `${row.sourceShort} · ${row.right}`, tone: "muted" },
        ]}
      />

      <DetailTabPills
        tabs={[
          { id: "info", label: "고객 정보" },
          { id: "inquiry", label: "상담 내용" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <MobileDetailTabPanel data-component="mobile_consultations_detail-sheet_stack_detail-page_tab-panel" name="consultations" tabId="inquiry" activeTab={activeTab}>
        <InfoCard data-component="mobile_consultations_detail-panel_info-card" title="문의 정보">
          <InfoRow label="근무 지역" value={row.region} />
          <InfoRow label="담당 지점" value={row.branchName} />
          <InfoRow
            label="서비스 플랜"
            value={row.selectedPlan ? `${row.selectedPlan} · ${row.selectedPlanPrice ?? "-"}` : "선택 서비스 없음"}
          />
          <InfoRow label="서비스 기간" value={serviceDurationLabel(row.selectedDurationDays)} />
          <InfoRow
            label="추가 서비스"
            value={
              row.selectedAddons.length > 0 ? (
                <span className="addon-stack">
                  {row.selectedAddons.map((addon) => (
                    <span key={`${addon.name}-${addon.priceLabel}`} className="addon-stack-item">
                      {addon.quantity > 1
                        ? `${addon.name} × ${addon.quantity} · ${addon.priceLabel}`
                        : `${addon.name} · ${addon.priceLabel}`}
                    </span>
                  ))}
                </span>
              ) : (
                "-"
              )
            }
          />
          <InfoRow label="추천 경로" value={row.referralSource || "-"} />
          <InfoRow label="선호 매니저" value={row.preferredCaregiverName || "-"} />
          {previousConsultationDates.length > 0 ? (
            <InfoRow
              label="이전 상담"
              value={(
                <span className="status-value-with-time">
                  {previousConsultationDates.map((date) => <span key={date}>{date}</span>)}
                </span>
              )}
            />
          ) : null}
          <InfoRow
            label="추가 사항"
            value={
              row.additionalNotes ? (
                <span className="additional-notes-value">{row.additionalNotes}</span>
              ) : (
                "-"
              )
            }
          />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component="mobile_consultations_detail-sheet_stack_detail-page_tab-panel-2" name="consultations" tabId="info" activeTab={activeTab}>
        <InfoCard data-component="mobile_consultations_detail-panel_info-card-2" title="기본 정보">
          <InfoRow label="이름" value={row.name} />
          <InfoRow label="연락처" value={row.contact} />
          <InfoRow label="주소" value={row.address || "-"} />
          <InfoRow label="출산 예정일" value={row.dueDateLabel} />
          <InfoRow label="출산 경험" value={row.birthExperience || "-"} />
          <InfoRow label="바우처 유형" value={row.voucher} />
        </InfoCard>
        <InfoCard data-component="mobile_consultations_detail-panel_info-card-3" title="문의 상태" delay={60}>
          <InfoRow label="출처" value={row.source} />
          <InfoRow
            label="확인 여부"
            value={
              row.status === "unread" ? (
                "미확인"
              ) : (
                <span className="status-value-with-time">
                  <span>확인 완료</span>
                  {row.confirmedAtLabel && (
                    <span className="status-value-time">{row.confirmedAtLabel}</span>
                  )}
                </span>
              )
            }
            tone={row.status === "unread" ? "burgundy" : "green"}
          />
          <InfoRow label="진행 상태" value={inquiryStatusLabel(row.inquiryStatus)} />
          <InfoRow label="개인정보 동의" value={row.privacyAcceptedAtLabel} />
        </InfoCard>
      </MobileDetailTabPanel>

    </MobileDetailPage>
  );
}

export default function ConsultationsPage() {
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("info");

  const { data, isLoading, isError } = useConsultationInquiries({ limit: 100 });
  const markRead = useMarkConsultationInquiryAsRead();

  const rows = useMemo<ConsultationRow[]>(
    () =>
      [...(data?.data ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(toRow),
    [data],
  );

  const unreadRows = useMemo(() => rows.filter((r) => r.status === "unread"), [rows]);
  const confirmedRows = useMemo(() => rows.filter((r) => r.status === "confirmed"), [rows]);
  const searchedRows = useMemo(() => {
    const query = normalizeSearchValue(search);
    if (!query) return rows;
    return rows.filter((row) => normalizeSearchValue(
      `${row.name} ${row.contact} ${row.address}`,
    ).includes(query));
  }, [rows, search]);

  const filterItems = [
    { label: ALL_FILTER, count: String(rows.length) },
    { label: "미확인", count: String(unreadRows.length) },
    { label: "확인", count: String(confirmedRows.length) },
  ];

  const sectionsFull = useMemo(() => {
    const sections: Array<{ title: string; fullRows: ConsultationRow[]; fullCount: number }> = [];
    // 전체: 미확인/확인 grouping 없이 최근 활동순(createdAt) 단일 리스트 (총 8개부터 teaser).
    if (activeFilter === ALL_FILTER) {
      return searchedRows.length > 0 ? [{ title: "", fullRows: searchedRows, fullCount: searchedRows.length }] : [];
    }
    const searchedUnreadRows = searchedRows.filter((row) => row.status === "unread");
    const searchedConfirmedRows = searchedRows.filter((row) => row.status === "confirmed");
    if (activeFilter === "미확인" && searchedUnreadRows.length > 0) {
      sections.push({ title: `미확인 · ${searchedUnreadRows.length}건`, fullRows: searchedUnreadRows, fullCount: searchedUnreadRows.length });
    }
    if (activeFilter === "확인" && searchedConfirmedRows.length > 0) {
      sections.push({ title: `확인 완료 · ${searchedConfirmedRows.length}건`, fullRows: searchedConfirmedRows, fullCount: searchedConfirmedRows.length });
    }
    return sections;
  }, [activeFilter, searchedRows]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}:${search}`,
      totalItems: maxFullCount,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, rows: s.fullRows.slice(0, visibleCount) }))
        .filter((s) => s.rows.length > 0),
    [sectionsFull, visibleCount],
  );

  const selectedRow = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [selectedId, rows],
  );
  const previousConsultationDates = useMemo(() => {
    if (!selectedRow) return [];
    const selectedPhone = normalizeSearchValue(selectedRow.contact);
    return rows
      .filter((row) => row.id !== selectedRow.id && normalizeSearchValue(row.contact) === selectedPhone)
      .map((row) => row.createdAtLabel);
  }, [rows, selectedRow]);

  const handleSelectRow = (row: ConsultationRow) => {
    setSelectedId(row.id);
    setActiveTab("info");
    if (row.status === "unread") {
      markRead.mutate(row.id);
    }
  };

  return (
    <MobileDetailSheet data-component="mobile_consultations_detail-sheet"
      name="consultations"
      isOpen={selectedRow !== null}
      onClose={() => setSelectedId(null)}
      list={
        <div className="shell-content" data-component="mobile-consultations-content">
          <ListCard
            title="상담 조회"
            count={`${rows.length}건`}
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            beforeFilters={(
              <MobileSearchBar
                label="consultations"
                placeholder="이름, 연락처, 주소 검색"
                value={search}
                onChange={setSearch}
              />
            )}
            scrollRef={scrollContainerRef}
            loadMore={
              isInitialLoad && hasMore ? (
                <ListLoadMoreButton
                  onLoadMore={loadMore}
                  dataComponentPrefix="mobile-consultations"
                />
              ) : null
            }
          >
            {isLoading ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-consultations-loading"
              >
                불러오는 중...
              </div>
            ) : isError ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-burgundy))",
                }}
                data-component="mobile-consultations-error"
              >
                상담 문의를 불러오지 못했습니다.
              </div>
            ) : visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-consultations-empty"
              >
                상담 문의가 없습니다.
              </div>
            ) : (
              <>
              {visibleSections.map((section) => (
                <div className="section-block" key={section.title || "all"} data-component="mobile-consultations-section">
                  {section.title && <div className="section-header" data-component="mobile-consultations-section-header">{section.title}</div>}
                  {section.rows.map((row, idx) => (
                    <ListItemRow
                      key={row.id}
                      dataComponent="mobile-consultations-row"
                      style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                      className={row.status === "unread" ? "unread-row" : undefined}
                      left={
                        <div
                          className={`list-avatar av-${row.status === "unread" ? "burgundy" : "green"}`}
                          data-component="mobile-consultations-row-avatar"
                        >
                          {row.initial}
                        </div>
                      }
                      name={row.name}
                      metaClassName="consult-snippet"
                      meta={
                        <>
                          <span className={`voucher-tag ${row.voucherKind}`}>{row.voucher}</span>
                          <span className="snippet-sep">·</span>
                          {row.due}
                        </>
                      }
                      right={<span className="dday-sub">{row.right}</span>}
                      onClick={() => handleSelectRow(row)}
                    />
                  ))}
                </div>
              ))}
              {!isInitialLoad && hasMore && (
                <ListLoadMoreSentinel
                  sentinelRef={sentinelRef}
                  dataComponentPrefix="mobile-consultations"
                />
              )}
              </>
            )}
          </ListCard>
        </div>
      }
      detail={
        selectedRow ? (
          <ConsultationDetail
            row={selectedRow}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            previousConsultationDates={previousConsultationDates}
          />
        ) : (
          <div className="detail-body" data-component="mobile-consultations-detail-empty" />
        )
      }
    />
  );
}
