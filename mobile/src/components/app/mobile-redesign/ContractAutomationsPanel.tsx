"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";

import { ListItemRow, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import { Switch } from "@/components/ui/switch";
import { settingsApi, type ContractAutoFinalizeConfig } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const QUERY_KEY = ["settings", "contract-automation-policies"] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "자동화 설정을 저장하지 못했습니다";
}

export function ContractAutomationsPanel({
  "data-component": dataComponent,
  onEdit,
}: {
  "data-component": string;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.getContractAutomationPolicies });
  const mutation = useMutation({
    mutationFn: settingsApi.updateContractAutoFinalizeConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ variant: "success", description: "자동화 설정을 저장했어요" });
    },
    onError: (error) => toast({ variant: "destructive", description: errorMessage(error) }),
  });
  const saved = query.data?.autoFinalize;
  const summary = saved
    ? `검토 필요 → 계약 완료 · ${saved.graceDays === 0 ? "종료일 당일" : `종료일 ${saved.graceDays}일 후`} · 매일 17:00`
    : "검토 필요 → 계약 완료 · 설정 불러오는 중";
  const toggle = useCallback((enabled: boolean) => {
    if (saved) mutation.mutate({ ...saved, enabled });
  }, [mutation, saved]);

  if (query.isLoading) return <ListRowsSkeleton data-component={`${dataComponent}_loading`} rowCount={1} />;
  if (query.isError || !saved) {
    return <div className="message-empty-state" data-component={`${dataComponent}_error`}>자동화 설정을 불러오지 못했습니다.</div>;
  }

  return (
    <div className="section-block" data-component={dataComponent}>
      <ListItemRow
        data-component={`${dataComponent}_row`}
        left={<div className="list-avatar av-primary" data-component={`${dataComponent}_row_icon`}><CalendarCheck size={18} strokeWidth={2.5} /></div>}
        name="계약 종료일 자동 완료"
        meta={summary}
        right={<Switch aria-label="계약 종료일 자동 완료 활성화" checked={saved.enabled} disabled={mutation.isPending} onClick={(event) => event.stopPropagation()} onCheckedChange={toggle} />}
        onClick={onEdit}
      />
    </div>
  );
}

export type { ContractAutoFinalizeConfig };
