import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { voucherQueryKeys } from "./useVoucherData";

// 파싱된 바우처 가격 항목 타입
export interface ParsedVoucherPriceItem {
  type: string;
  duration: number;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

// 이미지 파싱 응답 타입
export interface ParseImageResponse {
  parsedData: ParsedVoucherPriceItem[];
  hasValidationWarnings: boolean;
  warnings: string[];
}

// Bulk Update 결과 타입
export interface BulkUpdateResult {
  updated: number[];
  created: number[];
  errors: string[];
}

// Bulk Update 요청 타입
export interface BulkUpdateRequest {
  items: ParsedVoucherPriceItem[];
  year: number;
}

/**
 * 바우처 요금표 이미지 파싱 뮤테이션
 * 이미지를 업로드하면 Gemini API로 파싱하여 가격 정보 추출
 */
export function useParseVoucherImage() {
  return useMutation<ParseImageResponse, Error, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);

      const { data } = await api.post<ParseImageResponse>(
        "/voucher-price-infos/parse-image",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          // 큰 파일과 AI 처리를 위한 타임아웃 연장
          timeout: 120000,
        },
      );

      return data;
    },
  });
}

/**
 * 바우처 가격 정보 일괄 업데이트 뮤테이션
 * 파싱된 데이터를 특정 연도의 DB에 저장
 * @param items - 파싱된 바우처 가격 항목 배열
 * @param year - 적용 연도 (unique constraint: year + type + duration)
 */
export function useBulkUpdateVoucherPrices() {
  const queryClient = useQueryClient();

  return useMutation<BulkUpdateResult, Error, BulkUpdateRequest>({
    mutationFn: async ({ items, year }: BulkUpdateRequest) => {
      const { data } = await api.post<BulkUpdateResult>(
        "/voucher-price-infos/bulk-update",
        { items, year },
      );

      return data;
    },
    onSuccess: async () => {
      // 모든 바우처 가격 정보 쿼리 무효화
      await queryClient.invalidateQueries({
        queryKey: voucherQueryKeys.voucherPriceInfos(""),
      });
    },
  });
}
