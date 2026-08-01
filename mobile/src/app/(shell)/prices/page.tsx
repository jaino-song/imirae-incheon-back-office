"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  ChevronRight,
  Upload,
} from "lucide-react";

import {
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { VoucherPriceUploadForm } from "@/components/app/settings/VoucherPriceUploadForm";
import {
  useAllVoucherPrices,
  useVoucherYears,
  VOUCHER_TYPES,
} from "@/hooks/useVoucherData";
import "@/components/app/mobile-redesign/redesign.css";

const PRICES_ROUTE_BODY_CLASS = "mobile-prices-route";

type FilterableVariant = "A형" | "B형" | "C형" | "D형";
type TypeVariant = FilterableVariant | "기타";
type TypeFilter = "전체" | FilterableVariant;
type SubGroup = "1형" | "2형" | "3형" | "기타";

const TYPE_FILTERS: ReadonlyArray<TypeFilter> = ["전체", "A형", "B형", "C형", "D형"];
const VARIANT_ORDER: TypeVariant[] = ["A형", "B형", "C형", "D형", "기타"];
const SUBGROUP_ORDER: SubGroup[] = ["1형", "2형", "3형", "기타"];

function subgroupOf(name: string): SubGroup {
  const digit = name.match(/(\d+)형$/)?.[1];
  if (digit === "1") return "1형";
  if (digit === "2") return "2형";
  if (digit === "3") return "3형";
  return "기타";
}

interface DurationEntry {
  id: number;
  durationDays: number;
  totalPrice: number;
  grantAmount: number;
  ownAmount: number;
}

interface DisplayRow {
  name: string;
  variant: TypeVariant;
  durations: DurationEntry[];
}

function parseWon(value: string | null): number {
  if (!value) return 0;
  const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function variantOf(type: string | null): TypeVariant {
  const first = type?.charAt(0);
  if (first === "A" || first === "B" || first === "C" || first === "D") {
    return `${first}형` as TypeVariant;
  }
  return "기타";
}

function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export default function PricesPage() {
  const { data: authUser, isLoading: isAuthUserLoading } = useGetAuthUser();
  const isOwner = authUser?.role === "owner";
  const { data: years = [], isLoading: isYearsLoading } = useVoucherYears();
  const sortedYears = useMemo(() => [...years].sort((a, b) => a - b), [years]);
  const fallbackYear = sortedYears[sortedYears.length - 1];
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);
  const activeYear = yearFilter ?? fallbackYear;

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("전체");
  const [selectedRow, setSelectedRow] = useState<DisplayRow | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add(PRICES_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(PRICES_ROUTE_BODY_CLASS);
    };
  }, []);

  const { data: rawRows, isLoading: isPricesLoading, isError } = useAllVoucherPrices(activeYear);
  const isLoading = isYearsLoading || (activeYear !== undefined && isPricesLoading);

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (activeYear === undefined) return [];
    const grouped = new Map<string, DisplayRow>();
    for (const raw of rawRows) {
      const name = raw.type ?? "";
      if (!name) continue;
      const durationDays = parseInt(String(raw.duration), 10);
      if (!Number.isFinite(durationDays)) continue;
      const entry: DurationEntry = {
        id: raw.id,
        durationDays,
        totalPrice: parseWon(raw.fullPrice),
        grantAmount: parseWon(raw.grant),
        ownAmount: parseWon(raw.actualPrice),
      };
      const existing = grouped.get(name);
      if (existing) {
        existing.durations.push(entry);
      } else {
        grouped.set(name, {
          name,
          variant: variantOf(name),
          durations: [entry],
        });
      }
    }
    for (const row of grouped.values()) {
      row.durations.sort((a, b) => a.durationDays - b.durationDays);
    }
    return Array.from(grouped.values());
  }, [rawRows, activeYear]);

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = {
      전체: displayRows.length,
      A형: 0,
      B형: 0,
      C형: 0,
      D형: 0,
    };
    for (const row of displayRows) {
      if (row.variant !== "기타") counts[row.variant] += 1;
    }
    return counts;
  }, [displayRows]);

  const filteredRows = useMemo(() => {
    if (typeFilter === "전체") return displayRows;
    return displayRows.filter((row) => row.variant === typeFilter);
  }, [displayRows, typeFilter]);

  const typeOrder = useMemo(() => {
    const map = new Map<string, number>();
    VOUCHER_TYPES.forEach((type, index) => map.set(type, index));
    return map;
  }, []);

  const nestedSections = useMemo(() => {
    const orderOf = (name: string) => typeOrder.get(name) ?? Number.MAX_SAFE_INTEGER;
    return VARIANT_ORDER.map((variant) => {
      const variantRows = filteredRows.filter((row) => row.variant === variant);
      const subgroups = SUBGROUP_ORDER.map((sub) => ({
        key: sub,
        rows: variantRows
          .filter((row) => subgroupOf(row.name) === sub)
          .sort((a, b) => orderOf(a.name) - orderOf(b.name)),
      })).filter((s) => s.rows.length > 0);
      return { variant, subgroups };
    }).filter((v) => v.subgroups.length > 0);
  }, [filteredRows, typeOrder]);

  const closeSheet = () => {
    setSelectedRow(null);
    setUploadOpen(false);
  };

  const isOpen = selectedRow !== null || uploadOpen;

  const yearOptions = sortedYears.length > 0 ? sortedYears : activeYear ? [activeYear] : [];
  const typeFilterItems = isLoading
    ? TYPE_FILTERS.map((label) => ({ label, count: "00", skeleton: true }))
    : TYPE_FILTERS.map((label) => ({
        label,
        count: String(typeCounts[label]),
        active: label === typeFilter,
      }));

  const detailContent = selectedRow !== null ? (
    <PriceDetailContent row={selectedRow} year={activeYear ?? 0} />
  ) : uploadOpen ? (
    <UploadSheetContent year={activeYear} />
  ) : null;

  return (
    <div data-component="mobile_prices_page" data-slot="prices-page" className="md:hidden">
      <MobileDetailSheet
        data-component="mobile_prices_page_detail-sheet"
        name="prices"
        isOpen={isOpen}
        onClose={closeSheet}
        list={
          <div
            className="shell-content"
            data-component="mobile_prices_page_detail-sheet_stack_list-page_content"
            data-slot="prices-content"
          >
            <ListCard
              data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card"
              title="바우처 요금표"
              count={
                isLoading ? (
                  <ListCountSkeleton
                    data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_header_count-skeleton"
                  />
                ) : (
                  `${displayRows.length}개`
                )
              }
              actionLabel={isOwner ? "업데이트" : undefined}
              actionLoading={isAuthUserLoading}
              actionIcon={isOwner ? <Upload size={12} strokeWidth={3} aria-hidden="true" /> : undefined}
              onActionClick={
                isOwner
                  ? () => {
                      setSelectedRow(null);
                      setUploadOpen(true);
                    }
                  : undefined
              }
              filters={typeFilterItems}
              activeFilter={typeFilter}
              onFilterChange={(label) => setTypeFilter(label as TypeFilter)}
              beforeFilters={
                <div
                  className="filter-row"
                  data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_year-filter"
                  style={{ paddingBottom: 0 }}
                >
                  {isYearsLoading
                    ? Array.from({ length: 2 }).map((_, index) => (
                        <button
                          key={`year-skeleton-${index}`}
                          type="button"
                          className="filter-pill filter-pill-skeleton"
                          data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_year-filter_pill"
                          data-loading="true"
                          aria-hidden="true"
                          disabled
                          tabIndex={-1}
                        >
                          <span className="filter-pill-skeleton-content">0000년</span>
                        </button>
                      ))
                    : yearOptions.map((year) => (
                        <button
                          key={year}
                          type="button"
                          className={`filter-pill ${year === activeYear ? "active" : ""}`}
                          data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_year-filter_pill"
                          aria-pressed={year === activeYear}
                          onClick={() => setYearFilter(year)}
                        >
                          {year}년
                        </button>
                      ))}
                </div>
              }
            >
              {isLoading ? (
                <ListRowsSkeleton
                  data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_rows-skeleton"
                  rowCount={5}
                />
              ) : isError ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-burgundy))",
                  }}
                  data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_error"
                >
                  가격 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
                </div>
              ) : nestedSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_empty"
                >
                  {activeYear !== undefined
                    ? "조건에 맞는 가격표가 없습니다."
                    : "등록된 가격표 연도가 없습니다."}
                </div>
              ) : (
                nestedSections.map((variantSection) => (
                  <div
                    className="variant-block"
                    key={variantSection.variant}
                    data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant"
                  >
                    {typeFilter === "전체" && (
                      <div className="section-header-variant" data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant_header">{variantSection.variant}</div>
                    )}
                    {variantSection.subgroups.map((sub) => (
                      <div
                        className="section-block"
                        key={sub.key}
                        data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant_section"
                      >
                        <div className="section-header" data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant_section_header">{sub.key}</div>
                        {sub.rows.map((row, idx) => (
                          <ListItemRow
                            key={row.name}
                            data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant_section_row"
                            style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                            left={
                              <div className="duration-badge" data-component="mobile_prices_page_detail-sheet_stack_list-page_content_list-card_body_variant_section_row_icon">
                                <Calculator size={20} strokeWidth={2.5} aria-hidden="true" />
                              </div>
                            }
                            name={row.name}
                            metaClassName="price-row-meta"
                            meta={row.durations.map((d) => `${d.durationDays}일`).join(" · ")}
                            right={
                              <ChevronRight
                                size={16}
                                strokeWidth={2}
                                color="hsl(var(--v3-text-muted))"
                                aria-hidden="true"
                              />
                            }
                            onClick={() => {
                              setUploadOpen(false);
                              setSelectedRow(row);
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </ListCard>
          </div>
        }
        detail={detailContent}
      />
    </div>
  );
}

function PriceDetailContent({ row, year }: { row: DisplayRow; year: number }) {
  return (
    <MobileDetailPage data-component="mobile_prices_page_detail-sheet_stack_detail-page_body" name="prices">
      <MobileDetailHeader data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_header"
        name="prices"
        avatar={<Calculator size={24} strokeWidth={2.5} aria-hidden="true" />}
        avatarClassName="price-detail-avatar"
        title={row.name}
        badges={[
          { label: row.variant, tone: "primary" },
          ...(year > 0 ? [{ label: `${year}년`, tone: "muted" as const }] : []),
        ]}
      />

      {row.durations.map((d) => (
        <div key={d.id} className="price-breakdown pop-up" data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_breakdown">
          <div className="price-breakdown-row" data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_breakdown_duration">
            <span className="label">기간</span>
            <span className="value">{d.durationDays}일</span>
          </div>
          <div className="price-breakdown-row" data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_breakdown_total">
            <span className="label">서비스가격 (총액)</span>
            <span className="value">{formatWon(d.totalPrice)}</span>
          </div>
          <div className="price-breakdown-row grant" data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_breakdown_grant">
            <span className="label">정부지원금</span>
            <span className="value">{formatWon(d.grantAmount)}</span>
          </div>
          <div className="price-breakdown-row own" data-component="mobile_prices_page_detail-sheet_stack_detail-page_body_breakdown_own">
            <span className="label">본인부담금</span>
            <span className="value">{formatWon(d.ownAmount)}</span>
          </div>
        </div>
      ))}

    </MobileDetailPage>
  );
}

function UploadSheetContent({
  year,
}: {
  year: number | undefined;
}) {
  return (
    <div
      className="detail-body"
      data-component="mobile_prices_page_detail-sheet_stack_detail-page_upload"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <VoucherPriceUploadForm initialYear={year} />
    </div>
  );
}
