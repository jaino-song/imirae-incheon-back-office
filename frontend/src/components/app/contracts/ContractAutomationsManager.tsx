"use client";

/* eslint-disable react-hooks/set-state-in-effect -- draft mirrors server configuration after refetch */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  DetailTabPanels,
  DetailTabs,
  InfoCard,
  ListPanel,
  SplitLayout,
  SteppedWizardPanelContent,
} from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { useToast } from "@/hooks/use-toast";
import {
  settingsApi,
  type ContractAutoFinalizeConfig,
} from "@/services/api";

const RULE_ID = "contract-auto-finalize";
const GRACE_OPTIONS = [0, 1, 3, 7, 14, 30].map((value) => ({
  value: String(value),
  label: value === 0 ? "종료일 당일" : `${value}일 후`,
}));
const ATTEMPT_OPTIONS = [1, 2, 3, 5, 10].map((value) => ({ value: String(value), label: String(value) }));
const DETAIL_TABS = [
  { key: "settings", label: "규칙 설정" },
  { key: "description", label: "동작 설명" },
] as const;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "자동화 설정을 저장하지 못했습니다";
}

export interface ContractAutomationsManagerProps {
  dataComponent: string;
}

export function ContractAutomationsManager({ dataComponent }: ContractAutomationsManagerProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof DETAIL_TABS)[number]["key"]>("settings");
  const [draft, setDraft] = useState<ContractAutoFinalizeConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const query = useQuery({
    queryKey: ["settings", "contract-automation-policies"],
    queryFn: settingsApi.getContractAutomationPolicies,
  });
  const mutation = useMutation({
    mutationFn: settingsApi.updateContractAutoFinalizeConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "contract-automation-policies"] });
      setIsDirty(false);
      toast({ variant: "success", description: "자동화 설정을 저장했습니다" });
    },
    onError: (error) => toast({ variant: "destructive", description: getErrorMessage(error) }),
  });
  const saved = query.data?.autoFinalize;

  useEffect(() => {
    if (saved && !isDirty) setDraft(saved);
  }, [saved, isDirty]);

  const component = (suffix: string) => `${dataComponent}_${suffix}`;
  const current = draft ?? saved;
  const summary = useMemo(() => {
    if (!saved) return "검토 필요 → 계약 완료 · 설정 불러오는 중";
    const timing = saved.graceDays === 0 ? "종료일 당일" : `종료일 ${saved.graceDays}일 후`;
    return `검토 필요 → 계약 완료 · ${timing} · 매일 17:00`;
  }, [saved]);
  const updateDraft = (patch: Partial<ContractAutoFinalizeConfig>) => {
    if (!current) return;
    setDraft({ ...current, ...patch });
    setIsDirty(true);
  };
  const save = () => {
    if (draft && isDirty) mutation.mutate(draft);
  };
  const reset = () => {
    if (saved) {
      setDraft(saved);
      setIsDirty(false);
    }
  };
  const toggle = (enabled: boolean) => {
    if (!saved) return;
    mutation.mutate({ ...saved, enabled });
  };

  return (
    <section data-component={dataComponent} data-slot="contract-automations" className="flex h-full min-h-0 flex-1 flex-col">
      <SplitLayout data-component={component("split-layout")} hasSelection={selectedId !== null}>
        <ListPanel
          data-component={component("list-panel")}
          title="자동화"
          subtitle="계약서 상태를 자동으로 처리하는 규칙을 관리합니다"
        >
          <AnimatedSlotList
            data-component={component("list")}
            items={query.isLoading ? undefined : [{ id: RULE_ID }]}
            isLoading={query.isLoading}
            loadingCount={1}
            getSlotState={({ item, isLoading }) => ({ isActive: !isLoading && item?.id === selectedId, isInteractive: !isLoading && Boolean(item) })}
            onSlotClick={(item) => setSelectedId(item.id)}
            getItemKey={(item) => item.id}
            render={({ item, isLoading }) => {
              if (isLoading) return <Skeleton className="h-16 w-full rounded-[18px] bg-v3-dim-white" />;
              if (!item || !saved) return null;
              return (
                <AnimatedSlotListItemContent
                  dataComponent={component("row")}
                  icon={CalendarCheck}
                  title="계약 종료일 자동 완료"
                  subtitle={summary}
                  status={<Switch aria-label="계약 종료일 자동 완료 활성화" checked={saved.enabled} disabled={mutation.isPending} onClick={(event) => event.stopPropagation()} onCheckedChange={toggle} />}
                />
              );
            }}
          />
        </ListPanel>

        {selectedId === null ? (
          <DetailPanel data-component={component("detail-panel-empty")} overlay={<DetailEmptyState icon={CalendarCheck} message="왼쪽 목록에서 자동화를 선택하세요" />}>
            {null}
          </DetailPanel>
        ) : (
          <DetailPanel
            data-component={component("detail-panel")}
            isLoading={query.isLoading}
            title="계약 종료일 자동 완료"
            subtitle="검토 필요 상태의 산모 계약서를 계약 종료일 이후 자동으로 완료 처리합니다."
            tabs={<DetailTabs tabs={[...DETAIL_TABS]} activeTab={activeTab} onTabChange={(key) => setActiveTab(key as typeof activeTab)} />}
            footer={(
              <>
                <Button type="button" variant="outline" size="sm" width="sm" onClick={reset} disabled={!isDirty || mutation.isPending}>되돌리기</Button>
                <Button type="button" variant="positive" size="sm" width="sm" onClick={save} disabled={!isDirty || mutation.isPending}>{mutation.isPending ? "저장 중..." : "저장"}</Button>
              </>
            )}
          >
            <DetailTabPanels
              activeTab={activeTab}
              dataComponent={component("detail-tabs")}
              className="flex min-h-0 flex-1"
              trackClassName="min-h-0 flex-1"
              panelClassName="h-full min-h-0"
              panels={[
                {
                  key: "settings",
                  children: current ? (
                    <SteppedWizardPanelContent dataComponent={component("form")} flattenStepContent className="py-0" stepContentClassName="justify-start gap-4">
                      <TitleSelectMolecule id="contract-auto-finalize-grace" label="실행 시점" value={String(current.graceDays)} options={GRACE_OPTIONS} onValueChange={(value) => updateDraft({ graceDays: Number(value) })} dataComponent={component("grace-days")} />
                      <TitleSelectMolecule id="contract-auto-finalize-attempts" label="최대 시도 횟수" value={String(current.maxAttempts)} options={ATTEMPT_OPTIONS} onValueChange={(value) => updateDraft({ maxAttempts: Number(value) })} dataComponent={component("max-attempts")} />
                      <div className="flex items-center justify-between">
                        <span>자동화 사용</span>
                        <Switch aria-label="자동화 사용" checked={current.enabled} onCheckedChange={(enabled) => updateDraft({ enabled })} />
                      </div>
                      <InfoCard title="실행 조건" data-component={component("conditions")}>
                        <div className="space-y-2 text-sm text-v3-text-muted"><p>매일 17:00 (KST) 실행</p><p>대상: 제공기관 검토 단계(검토 필요) 산모 계약서</p><p>계약 종료일이 지난 문서만</p><p>eformsign &apos;검토 완료 확인&apos;을 자동 실행</p></div>
                      </InfoCard>
                    </SteppedWizardPanelContent>
                  ) : <Skeleton className="h-32 w-full bg-v3-dim-white" />,
                },
                {
                  key: "description",
                  children: <div className="space-y-3 text-sm leading-relaxed text-v3-text-muted"><p>계약 종료일이 지나면 매일 17:00 (KST)에 검토 필요 상태의 산모 계약서를 확인합니다.</p><p>대상 문서에는 eformsign의 &apos;검토 완료 확인&apos; 동작을 자동 실행해 계약 완료로 전환합니다.</p><p>실패 시 최대 시도 횟수까지 재시도 후 알림이 발송됩니다.</p></div>,
                },
              ]}
            />
          </DetailPanel>
        )}
      </SplitLayout>
    </section>
  );
}
