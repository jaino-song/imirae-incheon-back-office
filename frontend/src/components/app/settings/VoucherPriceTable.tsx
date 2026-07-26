"use client";

import { useState, useMemo, useCallback } from "react";
import { CreditCard } from "lucide-react";

import { useAllVoucherPriceInfos, useVoucherYears } from "@/hooks";
import { ContentPaper } from "@/components/app/root/content-paper";
import { CompactDateSelect } from "@/components/app/v3";
import { CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function formatTypeLabel(typeCode: string | null): string {
  if (!typeCode) return "-";
  return typeCode.replace(/([가-힣])(\d)/, "$1-$2");
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
  if (isNaN(num)) return price;
  return num.toLocaleString("ko-KR") + "원";
}

/** Parse type code into parts: category (A/B/C/D), subtype (가/통합/라), grade (1/2/3) */
function parseTypeCode(typeCode: string | null) {
  if (!typeCode) return { category: null, subtype: null, grade: null };
  const match = typeCode.match(/^([A-D])(가|통합|라)(\d)형?$/);
  if (!match) return { category: null, subtype: null, grade: null };
  return { category: match[1], subtype: match[2], grade: match[3] };
}

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[0.7rem] font-medium transition-colors min-w-[2.65rem] text-center",
        "xl:min-w-[3.25rem] xl:px-3 xl:py-1 xl:text-xs",
        "border-[hsl(var(--v3-primary))]",
        active
          ? "bg-[hsl(var(--v3-primary))] text-white"
          : "text-[hsl(var(--v3-primary))] hover:bg-[hsl(var(--v3-primary))]/10",
      )}
    >
      {label}
    </button>
  );
}

function useToggleSet<T>(initial: T[]) {
  const [selected, setSelected] = useState<Set<T>>(new Set(initial));

  const toggle = useCallback((value: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return [selected, toggle, clear] as const;
}

function TableSkeleton() {
  return (
    <div data-component="desktop_settings_voucher-price-table_skeleton" className="flex-1 overflow-y-auto min-h-0">
      <Table className={TABLE_TEXT_CLASS_NAME}>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead className="h-10 w-[150px] px-1.5 xl:h-12 xl:w-[180px] xl:px-2">유형</TableHead>
            <TableHead className="h-10 w-[80px] px-1.5 xl:h-12 xl:w-[100px] xl:px-2">기간 (일)</TableHead>
            <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">서비스 비용</TableHead>
            <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">정부지원금</TableHead>
            <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">본인부담금</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }).map((_, index) => (
            <TableRow key={index} data-component="desktop_settings_voucher-price-table_skeleton_row">
              <TableCell className="px-1.5 py-3 font-medium xl:px-2 xl:py-4">
                <Skeleton className="h-4 w-20 mx-auto bg-v3-dim-white" />
              </TableCell>
              <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">
                <Skeleton className="h-4 w-10 mx-auto bg-v3-dim-white" />
              </TableCell>
              <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">
                <Skeleton className="h-4 w-24 mx-auto bg-v3-dim-white" />
              </TableCell>
              <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">
                <Skeleton className="h-4 w-24 mx-auto bg-v3-dim-white" />
              </TableCell>
              <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">
                <Skeleton className="h-4 w-20 mx-auto bg-v3-dim-white" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const CATEGORIES = ["A", "B", "C", "D"] as const;
const SUBTYPES = ["가", "통합", "라"] as const;
const GRADES = ["1", "2", "3"] as const;
const DURATIONS = [5, 10, 15, 20, 25, 40] as const;
const FILTER_ROW_CLASS_NAME = "flex items-center gap-1.5 xl:gap-3";
const FILTER_GROUP_CLASS_NAME = "flex items-center gap-1 xl:gap-1.5";
const FILTER_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground w-8 shrink-0 xl:w-10 xl:text-sm";
const TABLE_TEXT_CLASS_NAME = "text-[0.76rem] xl:text-sm";

export function VoucherPriceTable() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const { data: years = [], isLoading: isYearsLoading } = useVoucherYears();
  const { data: prices = [], isLoading: isPricesLoading } = useAllVoucherPriceInfos(selectedYear);

  const yearOptions = years.length > 0
    ? years
    : [currentYear - 1, currentYear, currentYear + 1];

  const [selectedCategories, toggleCategory] = useToggleSet<string>([]);
  const [selectedSubtypes, toggleSubtype] = useToggleSet<string>([]);
  const [selectedGrades, toggleGrade] = useToggleSet<string>([]);
  const [selectedDurations, toggleDuration, clearDurations] = useToggleSet<number>([]);

  const sortedPrices = useMemo(
    () => [...prices].sort((a, b) => {
      const labelA = formatTypeLabel(a.type);
      const labelB = formatTypeLabel(b.type);
      if (labelA !== labelB) return labelA.localeCompare(labelB, "ko");
      return Number(a.duration) - Number(b.duration);
    }),
    [prices],
  );

  const filteredPrices = useMemo(() => {
    const hasCategory = selectedCategories.size > 0;
    const hasSubtype = selectedSubtypes.size > 0;
    const hasGrade = selectedGrades.size > 0;
    const hasDuration = selectedDurations.size > 0;

    if (!hasCategory && !hasSubtype && !hasGrade && !hasDuration) {
      return sortedPrices;
    }

    return sortedPrices.filter((price) => {
      const { category, subtype, grade } = parseTypeCode(price.type);
      const duration = Number(price.duration);

      if (hasCategory && (!category || !selectedCategories.has(category))) return false;
      if (hasSubtype && (!subtype || !selectedSubtypes.has(subtype))) return false;
      if (hasGrade && (!grade || !selectedGrades.has(grade))) return false;
      if (hasDuration && !selectedDurations.has(duration)) return false;

      return true;
    });
  }, [sortedPrices, selectedCategories, selectedSubtypes, selectedGrades, selectedDurations]);

  return (
    <ContentPaper
      variant="v3"
      className="flex h-full flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col pt-4 xl:pt-5"
      header={(
        <CardHeader
          variant="v3"
          data-component="desktop_settings_voucher-price-table_header"
          className="flex-row items-center gap-2.5 px-6 py-4 xl:gap-3 xl:py-5"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[hsl(var(--v3-primary))]/10 xl:h-10 xl:w-10">
            <CreditCard className="size-4 text-[hsl(var(--v3-primary))] xl:size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-foreground xl:text-lg">바우처 요금표</h2>
            <p className="text-xs text-muted-foreground xl:text-sm">연도별 바우처 가격 정보를 확인합니다.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 xl:gap-2">
            <Label htmlFor="price-table-year" className="text-xs whitespace-nowrap xl:text-sm">연도</Label>
            <CompactDateSelect
              id="price-table-year"
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
              disabled={isYearsLoading}
              options={yearOptions.map((year) => ({
                label: `${year}년`,
                value: String(year),
              }))}
              triggerClassName="xl:text-[0.85rem]"
            />
          </div>
        </CardHeader>
      )}
    >
      <div data-component="desktop_settings_voucher-price-table" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 mb-4 space-y-3">
        <div className={FILTER_ROW_CLASS_NAME}>
          <Label className={FILTER_LABEL_CLASS_NAME}>유형</Label>
          <div className={FILTER_GROUP_CLASS_NAME}>
            {CATEGORIES.map((cat) => (
              <PillToggle
                key={cat}
                label={cat}
                active={selectedCategories.has(cat)}
                onClick={() => toggleCategory(cat)}
              />
            ))}
          </div>
          <Separator orientation="vertical" className="h-5 xl:h-6" />
          <div className={FILTER_GROUP_CLASS_NAME}>
            {SUBTYPES.map((sub) => (
              <PillToggle
                key={sub}
                label={sub}
                active={selectedSubtypes.has(sub)}
                onClick={() => toggleSubtype(sub)}
              />
            ))}
          </div>
          <Separator orientation="vertical" className="h-5 xl:h-6" />
          <div className={FILTER_GROUP_CLASS_NAME}>
            {GRADES.map((g) => (
              <PillToggle
                key={g}
                label={`${g}형`}
                active={selectedGrades.has(g)}
                onClick={() => toggleGrade(g)}
              />
            ))}
          </div>
        </div>

        <div className={FILTER_ROW_CLASS_NAME}>
          <Label className={FILTER_LABEL_CLASS_NAME}>기간</Label>
          <div className={FILTER_GROUP_CLASS_NAME}>
            {DURATIONS.map((d) => (
              <PillToggle
                key={d}
                label={`${d}일`}
                active={selectedDurations.has(d)}
                onClick={() => toggleDuration(d)}
              />
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearDurations}
            className="rounded-full border border-[hsl(var(--v3-primary))]/30 px-2 py-0.5 text-[0.7rem] font-medium text-[hsl(var(--v3-primary))] hover:bg-[hsl(var(--v3-primary))]/10 transition-colors xl:px-3 xl:py-1 xl:text-xs"
          >
            모두 해제
          </button>
        </div>
      </div>

      <Separator className="shrink-0 mb-4" />

      {isPricesLoading ? (
        <TableSkeleton />
      ) : prices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CreditCard size={40} className="mb-3 opacity-30" />
          <p className="text-sm">{selectedYear}년 요금 데이터가 없습니다.</p>
        </div>
      ) : filteredPrices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CreditCard size={40} className="mb-3 opacity-30" />
          <p className="text-sm">선택한 필터에 해당하는 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <Table className={TABLE_TEXT_CLASS_NAME}>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="h-10 w-[150px] px-1.5 xl:h-12 xl:w-[180px] xl:px-2">유형</TableHead>
                <TableHead className="h-10 w-[80px] px-1.5 xl:h-12 xl:w-[100px] xl:px-2">기간 (일)</TableHead>
                <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">서비스 비용</TableHead>
                <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">정부지원금</TableHead>
                <TableHead className="h-10 px-1.5 xl:h-12 xl:px-2">본인부담금</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPrices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="px-1.5 py-3 font-medium xl:px-2 xl:py-4">{formatTypeLabel(price.type)}</TableCell>
                  <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">{price.duration}일</TableCell>
                  <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">{formatPrice(price.fullPrice)}</TableCell>
                  <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">{formatPrice(price.grant)}</TableCell>
                  <TableCell className="px-1.5 py-3 xl:px-2 xl:py-4">{formatPrice(price.actualPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      </div>
    </ContentPaper>
  );
}
