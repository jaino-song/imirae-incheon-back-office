"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ParsedVoucherPriceItem } from "@/hooks/useVoucherPriceImageParsing";

interface PriceEditModalProps {
  open: boolean;
  item: ParsedVoucherPriceItem | null;
  onClose: () => void;
  onSave: (updatedItem: ParsedVoucherPriceItem) => void;
}

// 가격 문자열을 숫자로 변환
function parsePrice(price: string): number {
  return parseInt(price.replace(/[,원\s]/g, ""), 10) || 0;
}

// 숫자를 포맷팅된 문자열로 변환
function formatPriceDisplay(value: number): string {
  return value.toLocaleString("ko-KR");
}

export function PriceEditModal({
  open,
  item,
  onClose,
  onSave,
}: PriceEditModalProps) {
  const [fullPrice, setFullPrice] = useState("");
  const [grant, setGrant] = useState("");
  const [actualPrice, setActualPrice] = useState("");

  // item이 변경되면 폼 값 초기화
  useEffect(() => {
    if (item) {
      queueMicrotask(() => {
        setFullPrice(String(parsePrice(item.fullPrice)));
        setGrant(String(parsePrice(item.grant)));
        setActualPrice(String(parsePrice(item.actualPrice)));
      });
    }
  }, [item]);

  const fullPriceNum = parseInt(fullPrice, 10) || 0;
  const grantNum = parseInt(grant, 10) || 0;
  const actualPriceNum = parseInt(actualPrice, 10) || 0;
  const calculatedSum = grantNum + actualPriceNum;
  const isValid = fullPriceNum === calculatedSum;
  const difference = fullPriceNum - calculatedSum;

  const handleSave = useCallback(() => {
    if (!item) return;

    onSave({
      ...item,
      fullPrice: fullPrice,
      grant: grant,
      actualPrice: actualPrice,
    });
    onClose();
  }, [item, fullPrice, grant, actualPrice, onSave, onClose]);

  const handleNumberInput = (
    value: string,
    setter: (v: string) => void
  ) => {
    // 숫자만 허용
    const numericValue = value.replace(/[^\d]/g, "");
    setter(numericValue);
  };

  // 자동 계산 버튼: actualPrice = fullPrice - grant
  const handleAutoCalculate = useCallback(() => {
    const calculated = fullPriceNum - grantNum;
    setActualPrice(String(Math.max(0, calculated)));
  }, [fullPriceNum, grantNum]);

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <DialogContent data-component="desktop_settings_sections_price-edit-modal" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>가격 수정</DialogTitle>
          <DialogDescription>
            {item.type} · {item.duration}일
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-4">
          {/* 서비스가격 */}
          <div className="space-y-2">
            <Label htmlFor="fullPrice">서비스가격</Label>
            <div className="relative">
              <Input
                variant="v3"
                id="fullPrice"
                value={fullPrice}
                onChange={(e) => handleNumberInput(e.target.value, setFullPrice)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                원
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              표시: {formatPriceDisplay(fullPriceNum)}원
            </p>
          </div>

          {/* 정부지원금 */}
          <div className="space-y-2">
            <Label htmlFor="grant">정부지원금</Label>
            <div className="relative">
              <Input
                variant="v3"
                id="grant"
                value={grant}
                onChange={(e) => handleNumberInput(e.target.value, setGrant)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                원
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              표시: {formatPriceDisplay(grantNum)}원
            </p>
          </div>

          {/* 본인부담금 */}
          <div className="space-y-2">
            <Label htmlFor="actualPrice">본인부담금</Label>
            <div className="relative">
              <Input
                variant="v3"
                id="actualPrice"
                value={actualPrice}
                onChange={(e) => handleNumberInput(e.target.value, setActualPrice)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                원
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              표시: {formatPriceDisplay(actualPriceNum)}원
            </p>
            <Button
              variant="link"
              size="sm"
              onClick={handleAutoCalculate}
              className="h-auto p-0 text-xs"
            >
              자동 계산 (서비스가격 - 정부지원금)
            </Button>
          </div>

          {/* 검증 결과 */}
          <div className="pt-2 border-t">
            <p className="text-sm text-muted-foreground mb-2">
              검증: 서비스가격 = 정부지원금 + 본인부담금
            </p>
            <p className="text-sm font-medium mb-2">
              {formatPriceDisplay(fullPriceNum)} = {formatPriceDisplay(grantNum)} + {formatPriceDisplay(actualPriceNum)} = {formatPriceDisplay(calculatedSum)}
            </p>

            {isValid ? (
              <Alert className="bg-success/10 border-success/30 text-success rounded-xl">
                <AlertDescription>가격 계산이 일치합니다.</AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-warning/10 border-warning/30 text-warning rounded-xl">
                <AlertDescription>
                  가격 불일치: 차이 {formatPriceDisplay(Math.abs(difference))}원
                  {difference > 0 ? " (서비스가격이 더 큼)" : " (합계가 더 큼)"}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-full">
            취소
          </Button>
          <Button onClick={handleSave} className="rounded-full">저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
