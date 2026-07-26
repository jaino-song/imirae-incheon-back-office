"use client";

import { useState, useCallback } from "react";
import { CheckCircle, AlertTriangle, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ParsedVoucherPriceItem } from "@/hooks/useVoucherPriceImageParsing";
import { PriceEditModal } from "./PriceEditModal";
import { cn } from "@/lib/utils";

interface ParsedDataPreviewProps {
  /** Caller-context canonical value for this node. */
  "data-component": string;

  data: ParsedVoucherPriceItem[];
  warnings: string[];
  onDataChange?: (updatedData: ParsedVoucherPriceItem[]) => void;
}

// 가격 문자열을 숫자로 변환
function parsePrice(price: string): number {
  return parseInt(price.replace(/[,원\s]/g, ""), 10) || 0;
}

// 숫자를 포맷팅된 문자열로 변환
function formatPrice(price: string | number): string {
  const num = typeof price === "string" ? parsePrice(price) : price;
  return num.toLocaleString("ko-KR");
}

// 단일 행의 수학적 검증
function validateRow(item: ParsedVoucherPriceItem): boolean {
  const fullPrice = parsePrice(item.fullPrice);
  const grant = parsePrice(item.grant);
  const actualPrice = parsePrice(item.actualPrice);
  return fullPrice === grant + actualPrice;
}

export function ParsedDataPreview({
  "data-component": dataComponent,
  data,
  warnings,
  onDataChange,
}: ParsedDataPreviewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setEditingIndex(null);
  }, []);

  const handleSaveEdit = useCallback((updatedItem: ParsedVoucherPriceItem) => {
    if (editingIndex === null || !onDataChange) return;

    const newData = [...data];
    newData[editingIndex] = updatedItem;
    onDataChange(newData);
  }, [editingIndex, data, onDataChange]);

  if (data.length === 0) {
    return (
      <Alert className="bg-warning/10 border-warning/30 text-warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          파싱된 데이터가 없습니다. 이미지를 확인해주세요.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TooltipProvider>
      <div data-component={dataComponent}>
        {/* 경고 메시지 */}
        {warnings.length > 0 && (
          <Alert className="mb-4 bg-warning/10 border-warning/30 text-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold mb-1">검증 경고 ({warnings.length}건)</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map((warning, index) => (
                  <li key={index} className="text-sm">{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* 요약 정보 */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />
            총 {data.length}개 항목
          </Badge>
          {warnings.length === 0 ? (
            <Badge variant="outline" className="gap-1.5 border-success/50 text-success">
              <CheckCircle className="h-3.5 w-3.5" />
              검증 통과
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-warning/50 text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warnings.length}개 경고
            </Badge>
          )}
        </div>

        {/* 데이터 테이블 */}
        <div className="border rounded-2xl overflow-hidden" data-component={`${dataComponent}_table`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">유형</TableHead>
                <TableHead className="text-right whitespace-nowrap">기간 (일)</TableHead>
                <TableHead className="text-right whitespace-nowrap">서비스가격</TableHead>
                <TableHead className="text-right whitespace-nowrap">정부지원금</TableHead>
                <TableHead className="text-right whitespace-nowrap">본인부담금</TableHead>
                <TableHead className="w-20 whitespace-nowrap">검증</TableHead>
                {onDataChange && (
                  <TableHead className="w-20 whitespace-nowrap">수정</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item, index) => {
                const isValid = validateRow(item);

                return (
                  <TableRow
                    key={`voucher-row-${index}`}
                    className={cn(
                      "opacity-0 animate-fade-in transition-colors",
                      !isValid && "bg-warning/10 hover:bg-warning/20",
                      isValid && "hover:bg-muted/50"
                    )}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    {/* 유형 */}
                    <TableCell className="font-medium">
                      {item.type}
                    </TableCell>

                    {/* 기간 */}
                    <TableCell className="text-right">
                      {item.duration}일
                    </TableCell>

                    {/* 서비스가격 */}
                    <TableCell className="text-right">
                      {formatPrice(item.fullPrice)}원
                    </TableCell>

                    {/* 정부지원금 */}
                    <TableCell className="text-right">
                      {formatPrice(item.grant)}원
                    </TableCell>

                    {/* 본인부담금 */}
                    <TableCell className="text-right">
                      {formatPrice(item.actualPrice)}원
                    </TableCell>

                    {/* 검증 상태 */}
                    <TableCell className="text-center">
                      {isValid ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <CheckCircle className="h-4 w-4 text-success" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>가격 계산 일치</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <AlertTriangle className="h-4 w-4 text-warning" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>가격 계산 불일치: 서비스가격 ≠ 정부지원금 + 본인부담금</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>

                    {/* 수정 버튼 */}
                    {onDataChange && (
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleStartEdit(index)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* 수식 설명 */}
        <p className="text-xs text-muted-foreground mt-2">
          * 검증 수식: 서비스가격 = 정부지원금 + 본인부담금
        </p>

        {/* 가격 수정 모달 */}
        <PriceEditModal
          data-component={`${dataComponent}_edit-modal`}
          key={modalOpen && editingIndex !== null ? `price-edit-${editingIndex}` : "price-edit-closed"}
          open={modalOpen}
          item={editingIndex !== null ? data[editingIndex] : null}
          onClose={handleCloseModal}
          onSave={handleSaveEdit}
        />
      </div>
    </TooltipProvider>
  );
}
