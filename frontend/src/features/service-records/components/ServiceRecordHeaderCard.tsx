"use client";

import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";
import { formatDateTimeKo } from "@babyjamjam/shared/utils/date";

import { InfoCard, InfoRow } from "@/components/app/v3";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServiceRecordHeader } from "@/features/service-records/types";

interface ServiceRecordHeaderCardProps {
  "data-component": string;
  header: ServiceRecordHeader | null;
  showStatusBadge?: boolean;
  isLoading?: boolean;
}

const SERVICE_RECORD_HEADER_LABELS = [
  "산모 성명",
  "산모 생년월일",
  "신생아 성명",
  "신생아 출생일자",
  "분만형태",
  "신생아 몸무게",
] as const;

function formatBabyWeight(value: string | null): string {
  if (!value) return "-";
  return value.endsWith("kg") ? value : `${value}kg`;
}

export function ServiceRecordHeaderCard({
  "data-component": dataComponent,
  header,
  showStatusBadge = true,
  isLoading = false,
}: ServiceRecordHeaderCardProps) {
  return (
    <InfoCard
      data-component={dataComponent}
      data-source-component="ServiceRecordHeaderCard"
      title="서비스 기본정보"
      description={!isLoading && !header ? "산모 및 신생아 정보" : undefined}
      className={header || isLoading ? "h-full grid-rows-[auto_minmax(0,1fr)]" : undefined}
      contentClassName={header || isLoading ? "block min-h-0" : undefined}
      titleTrailing={showStatusBadge ? (
        <div className="ml-auto flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
          {isLoading ? (
            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(58px*var(--glint-ui-scale,1))] rounded-full bg-white/70" />
          ) : (
            <StatusPill variant={header ? "success" : "neutral"}>
              {header ? "작성 완료" : "작성 전"}
            </StatusPill>
          )}
        </div>
      ) : undefined}
    >
      {isLoading ? (
        <div>
          {SERVICE_RECORD_HEADER_LABELS.map((label) => (
            <div
              key={label}
              data-component={`${dataComponent}_body_row`}
              className="flex items-start gap-[calc(16px*var(--glint-ui-scale,1))] border-b border-v3-border py-[calc(10px*var(--glint-ui-scale,1))] last:border-b-0"
            >
              <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
                {label}
              </span>
              <Skeleton className="ml-auto h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(88px*var(--glint-ui-scale,1))] bg-white/70" />
            </div>
          ))}
        </div>
      ) : header ? (
        <div className="flex h-full flex-col">
          <div>
            <InfoRow data-component={`${dataComponent}_body_row`} label="산모 성명" value={header.momName || "-"} size="compact" />
            <InfoRow
              data-component={`${dataComponent}_body_row`}
              label="산모 생년월일"
              value={formatBirthdayYYMMDD(header.momBirth ?? "") || "-"}
              size="compact"
            />
            <InfoRow data-component={`${dataComponent}_body_row`} label="신생아 성명" value={header.babyName || "-"} size="compact" />
            <InfoRow data-component={`${dataComponent}_body_row`} label="신생아 출생일자" value={header.babyBirth || "-"} size="compact" />
            <InfoRow data-component={`${dataComponent}_body_row`} label="분만형태" value={header.deliveryType || "-"} size="compact" />
            <InfoRow data-component={`${dataComponent}_body_row`} label="신생아 몸무게" value={formatBabyWeight(header.babyWeight)} size="compact" />
          </div>
          <p
            data-component={`${dataComponent}_body_caption`}
            className="mt-auto text-right text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold leading-[1.4] text-v3-text-muted"
          >
            {formatDateTimeKo(header.createdAt)} 작성
          </p>
        </div>
      ) : (
        <div className="mt-[calc(12px*var(--glint-ui-scale,1))] rounded-[14px] border-2 border-dashed border-v3-border px-[calc(22px*var(--glint-ui-scale,1))] py-[calc(22px*var(--glint-ui-scale,1))] text-center text-[calc(12.3px*var(--glint-ui-scale,1))] leading-6 text-v3-text-muted">
          아직 작성된 기본정보가 없습니다.
          <br />
          제공인력이 링크 접속 후 산모·신생아 정보를 입력하면 표시됩니다.
        </div>
      )}
    </InfoCard>
  );
}
