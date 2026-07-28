"use client";

import { useState, useCallback } from "react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { Upload, CheckCircle, RotateCcw } from "lucide-react";
import { ImageDropzone } from "./ImageDropzone";
import { ParsedDataPreview } from "./ParsedDataPreview";
import {
  useParseVoucherImage,
  useBulkUpdateVoucherPrices,
  ParsedVoucherPriceItem,
} from "@/hooks/useVoucherPriceImageParsing";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type Step = "upload" | "preview" | "success";

const steps = ["이미지 업로드", "데이터 확인", "완료"];

// 연도 선택 옵션 생성 (현재 연도 기준 -1 ~ +2)
const generateYearOptions = (initialYear?: number): number[] => {
  const currentYear = new Date().getFullYear();
  return Array.from(new Set([
    currentYear - 1,
    currentYear,
    currentYear + 1,
    currentYear + 2,
    ...(initialYear === undefined ? [] : [initialYear]),
  ])).sort((a, b) => a - b);
};

// 현재 단계의 인덱스 반환
const getStepIndex = (step: Step): number => {
  switch (step) {
    case "upload": return 0;
    case "preview": return 1;
    case "success": return 2;
    default: return 0;
  }
};

const VOUCHER_UPLOAD_BASE =
  "mobile_prices_page_detail-sheet_stack_detail-page_upload_form";

export function VoucherPriceUploadForm({ initialYear }: { initialYear?: number } = {}) {
  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [parsedData, setParsedData] = useState<ParsedVoucherPriceItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(initialYear ?? new Date().getFullYear());
  const [updateResult, setUpdateResult] = useState<{
    updated: number[];
    created: number[];
    errors: string[];
  } | null>(null);

  const parseImageMutation = useParseVoucherImage();
  const bulkUpdateMutation = useBulkUpdateVoucherPrices();
  const yearOptions = generateYearOptions(initialYear);
  const activeStep = getStepIndex(currentStep);

  const handleFileSelect = useCallback(
    async (file: File) => {
      try {
        const result = await parseImageMutation.mutateAsync(file);
        setParsedData(result.parsedData ?? []);
        setWarnings(result.warnings ?? []);
        setCurrentStep("preview");
      } catch (error) {
        console.error("Image parsing failed:", error);
      }
    },
    [parseImageMutation],
  );

  const handleDataChange = useCallback((updatedData: ParsedVoucherPriceItem[]) => {
    setParsedData(updatedData);
    // 변경 후 경고 메시지 재계산
    const newWarnings: string[] = [];
    updatedData.forEach((item, index) => {
      const fullPrice = parseInt(item.fullPrice.replace(/[,원\s]/g, ""), 10) || 0;
      const grant = parseInt(item.grant.replace(/[,원\s]/g, ""), 10) || 0;
      const actualPrice = parseInt(item.actualPrice.replace(/[,원\s]/g, ""), 10) || 0;

      if (fullPrice !== grant + actualPrice) {
        newWarnings.push(
          `행 ${index + 1} (${item.type}, ${item.duration}일): 가격 계산 불일치`,
        );
      }
    });
    setWarnings(newWarnings);
  }, []);

  const handleConfirmUpdate = useCallback(async () => {
    try {
      const result = await bulkUpdateMutation.mutateAsync({
        items: parsedData,
        year: selectedYear,
      });
      setUpdateResult(result);
      setCurrentStep("success");
    } catch (error) {
      console.error("Bulk update failed:", error);
    }
  }, [bulkUpdateMutation, parsedData, selectedYear]);

  const handleReset = useCallback(() => {
    setCurrentStep("upload");
    setParsedData([]);
    setWarnings([]);
    setSelectedYear(initialYear ?? new Date().getFullYear());
    setUpdateResult(null);
    parseImageMutation.reset();
    bulkUpdateMutation.reset();
  }, [initialYear, parseImageMutation, bulkUpdateMutation]);

  const handleBackToUpload = useCallback(() => {
    setCurrentStep("upload");
    setParsedData([]);
    setWarnings([]);
    parseImageMutation.reset();
  }, [parseImageMutation]);

  return (
    <ContentPaper variant="v3" data-component={VOUCHER_UPLOAD_BASE}>
      {/* 헤더 */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-foreground">바우처 요금표 업데이트</h2>
        <p className="text-sm text-muted-foreground">
          정부지원 바우처 요금표 이미지를 업로드하면 AI가 자동으로 가격 정보를 추출합니다.
        </p>
      </div>

      {/* Stepper */}
      <div className="mb-6">
        <div className="flex items-center w-full">
          {steps.map((label, index) => (
            <div key={label} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`
                    flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-medium transition-colors
                    ${index < activeStep
                      ? "bg-primary border-primary text-primary-foreground"
                      : index === activeStep
                      ? "border-primary text-primary bg-primary/10"
                      : "border-muted-foreground/30 text-muted-foreground"
                    }
                  `}
                >
                  {index < activeStep ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="text-xs text-muted-foreground hidden sm:block">{label}</span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 sm:mx-4 ${
                    index < activeStep ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <Separator className="mb-4" />

      {/* Step 1: 이미지 업로드 */}
      {currentStep === "upload" && (
        <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
          <ImageDropzone
            data-component={`${VOUCHER_UPLOAD_BASE}_image-dropzone`}
            onFileSelect={handleFileSelect}
            isLoading={parseImageMutation.isPending}
            error={
              parseImageMutation.isError
                ? parseImageMutation.error?.message ||
                "이미지 파싱에 실패했습니다"
                : null
            }
          />
        </div>
      )}

      {/* Step 2: 데이터 미리보기 */}
      {currentStep === "preview" && (
        <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
          {/* 연도 선택 */}
          <div className="mb-4 flex items-center gap-3">
            <Label htmlFor="year-select">적용 연도</Label>
            <Select
              value={String(selectedYear)}
              onValueChange={(value: string) => setSelectedYear(Number(value))}
            >
              <SelectTrigger id="year-select" className="w-[120px] rounded-2xl border-border/50">
                <SelectValue placeholder="연도 선택" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl">
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}년
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              선택한 연도의 요금표로 업데이트됩니다.
            </span>
          </div>

          <ParsedDataPreview
            data-component={`${VOUCHER_UPLOAD_BASE}_parsed-data`}
            data={parsedData}
            warnings={warnings}
            onDataChange={handleDataChange}
          />

          {/* 액션 버튼 */}
          <div className="mt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <Button variant="outline" onClick={handleBackToUpload} className="rounded-full">
              다른 이미지 업로드
            </Button>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              {warnings.length > 0 && (
                <Alert className="py-2 bg-warning/10 border-warning/30 text-warning rounded-2xl">
                  <AlertDescription className="text-sm">
                    경고가 있지만 업데이트를 진행할 수 있습니다
                  </AlertDescription>
                </Alert>
              )}
              <Button
                onClick={handleConfirmUpdate}
                disabled={bulkUpdateMutation.isPending || parsedData.length === 0}
                className="gap-2 rounded-full"
              >
                {bulkUpdateMutation.isPending ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {bulkUpdateMutation.isPending ? "업데이트 중..." : `${selectedYear}년 요금표 업데이트`}
              </Button>
            </div>
          </div>

          {/* 업데이트 에러 */}
          {bulkUpdateMutation.isError && (
            <Alert variant="destructive" className="mt-4 rounded-2xl">
              <AlertDescription>
                업데이트 실패: {bulkUpdateMutation.error?.message || "알 수 없는 오류"}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Step 3: 완료 */}
      {currentStep === "success" && updateResult && (
        <div className="text-center py-8 animate-fade-in" style={{ animationDelay: "100ms" }}>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
          </div>
          <h3 className="text-xl font-semibold mb-2">업데이트 완료!</h3>

          <div className="my-4">
            <p className="text-base">
              <strong className="text-primary">{updateResult.updated.length}</strong>개 항목 업데이트,{" "}
              <strong className="text-primary">{updateResult.created.length}</strong>개 항목 신규 생성
            </p>
          </div>

          {updateResult.errors.length > 0 && (
            <Alert className="mb-4 text-left bg-warning/10 border-warning/30 rounded-2xl">
              <AlertDescription>
                <p className="font-semibold mb-2">일부 항목 처리 실패:</p>
                <ul className="list-disc pl-4 space-y-1">
                  {updateResult.errors.map((error, index) => (
                    <li key={index} className="text-sm">{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Button variant="outline" onClick={handleReset} className="gap-2 rounded-full">
            <RotateCcw className="h-4 w-4" />
            새 요금표 업로드
          </Button>
        </div>
      )}
    </ContentPaper>
  );
}
