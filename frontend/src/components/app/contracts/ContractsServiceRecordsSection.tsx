"use client";

import { useState } from "react";
import { ClipboardList, User } from "lucide-react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { ClientServiceRecordsTab } from "@/components/app/clients/ClientServiceRecordsTab";
import {
  DetailPanel,
  EmptyState,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { useClientServiceRecords } from "@/features/service-records/hooks/use-service-records";
import type { Client } from "@/lib/client/types";
import { formatKoreanPhoneNumber } from "@/lib/phone";

export function ContractsServiceRecordsSection() {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const serviceRecordsQuery = useClientServiceRecords(selectedClientId);

  const handleClientChange = (clientId: number | null, client: Client | null) => {
    setSelectedClientId(clientId);
    setSelectedClient(client);
  };

  const clearSelection = () => {
    setSelectedClientId(null);
    setSelectedClient(null);
  };

  const clientSubtitle = [
    selectedClient?.phone ? formatKoreanPhoneNumber(selectedClient.phone) : null,
    selectedClient?.address ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      data-component="contracts-service-records"
      className="flex min-h-0 flex-1 flex-col"
    >
      <SplitLayout data-component="desktop_contracts_split-layout" hasSelection={selectedClientId !== null} onBack={clearSelection}>
        <ListPanel data-component="desktop_contracts_split-layout_list-panel" title="제공기록지 조회" subtitle="고객별 기록과 발송 상태">
          <div
            data-component="contracts-service-records-client-picker"
            className="flex min-h-full flex-1 flex-col gap-[calc(20px*var(--glint-ui-scale,1))] pt-[calc(4px*var(--glint-ui-scale,1))]"
          >
            <ClientAutocomplete
              value={selectedClientId}
              onChange={handleClientChange}
              label="고객 선택"
              placeholder="이름, 연락처 또는 주소로 검색"
            />

            {selectedClient ? (
              <div
                data-component="contracts-service-records-selected-client"
                className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] border-t border-v3-border pt-[calc(16px*var(--glint-ui-scale,1))]"
              >
                <div className="flex h-[calc(40px*var(--glint-ui-scale,1))] w-[calc(40px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[12px] bg-v3-primary-light text-v3-primary">
                  <User className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))]" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[calc(14px*var(--glint-ui-scale,1))] font-bold text-v3-dark">
                    {selectedClient.name}
                  </p>
                  {clientSubtitle ? (
                    <p className="mt-[calc(2px*var(--glint-ui-scale,1))] truncate text-[calc(11.5px*var(--glint-ui-scale,1))] text-v3-text-muted">
                      {clientSubtitle}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <ListEmptyState
                icon={ClipboardList}
                message="선택한 고객이 없습니다"
                className="min-h-0"
              />
            )}
          </div>
        </ListPanel>

        {selectedClientId !== null && selectedClient ? (
          <DetailPanel data-component="desktop_contracts_split-layout_detail-panel"
            title={selectedClient.name}
            subtitle={clientSubtitle || "제공기록지"}
            avatar={
              <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                <ClipboardList className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
              </div>
            }
          >
            <ClientServiceRecordsTab data-component="desktop_contracts_service-records"
              overview={serviceRecordsQuery.data}
              clientId={selectedClientId}
              isLoading={serviceRecordsQuery.isLoading}
              isError={serviceRecordsQuery.isError}
              isRefreshing={serviceRecordsQuery.isFetching && !serviceRecordsQuery.isLoading}
              onRefresh={() => void serviceRecordsQuery.refetch()}
            />
          </DetailPanel>
        ) : (
          <EmptyState
            icon={ClipboardList}
            message="고객을 선택하면 제공기록지가 표시됩니다"
          />
        )}
      </SplitLayout>
    </section>
  );
}
