"use client";

import { InfoCard, InfoRow } from "@/components/app/v3";
import type { ConsultationInquiry } from "@/services/api";

interface SelectedServicesCardProps {
  inquiry: ConsultationInquiry;
  className?: string;
}

export function SelectedServicesCard({
  inquiry,
  className,
}: SelectedServicesCardProps) {
  const selectedServices = inquiry.selectedServices;
  const hasPlan = Boolean(selectedServices?.plan);
  const addons = selectedServices?.addons ?? [];
  const hasAddons = addons.length > 0;

  if (!hasPlan && !hasAddons) {
    return (
      <InfoCard data-component="desktop_consultations_detail-panel_info-card" title="서비스 정보" className={className}>
        <InfoRow label="서비스" value="선택 서비스 없음" />
      </InfoCard>
    );
  }

  return (
    <InfoCard data-component="desktop_consultations_detail-panel_info-card-2" title="서비스 정보" className={className}>
      {selectedServices?.plan && (
        <>
          <InfoRow
            label="서비스 플랜"
            value={`${selectedServices.plan.name} · ${selectedServices.plan.priceLabel}`}
          />
          <InfoRow
            label="서비스 기간"
            value={
              typeof selectedServices.plan.durationDays === "number"
                ? `${selectedServices.plan.durationDays}일`
                : "-"
            }
          />
        </>
      )}
      {hasAddons && (
        <InfoRow
          label="추가 서비스"
          value={addons.map((addon) => (
            <span key={addon.id} className="block">
              {addon.quantity > 1
                ? `${addon.name} × ${addon.quantity} · ${addon.priceLabel}`
                : `${addon.name} · ${addon.priceLabel}`}
            </span>
          ))}
        />
      )}
    </InfoCard>
  );
}
