"use client";

/* eslint-disable react-hooks/set-state-in-effect -- draft follows server data while clean */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";

import { MobileDetailHeader, MobileDetailPage } from "@/components/app/mobile-redesign/detail-sheet";
import { FormNativeSelect, FormSection } from "@/components/app/ui/form-section";
import { ToggleRow } from "@/components/app/ui/toggle-row";
import { InfoCard } from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { settingsApi, type ContractAutoFinalizeConfig } from "@/services/api";

const QUERY_KEY = ["settings", "contract-automation-policies"] as const;
const GRACE_OPTIONS = [0, 1, 3, 7, 14, 30].map((value) => ({ value: String(value), label: value === 0 ? "종료일 당일" : `${value}일 후` }));
const ATTEMPT_OPTIONS = [1, 2, 3, 5, 10].map((value) => ({ value: String(value), label: String(value) }));
const EDITOR_BASE = "mobile_contracts_detail-sheet_stack_detail-page_body_automation-editor";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "자동화 설정을 저장하지 못했습니다";
}

export function ContractAutomationEditor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.getContractAutomationPolicies });
  const saved = query.data?.autoFinalize;
  const [draft, setDraft] = useState<ContractAutoFinalizeConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const mutation = useMutation({
    mutationFn: settingsApi.updateContractAutoFinalizeConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setIsDirty(false);
    },
  });

  useEffect(() => {
    if (saved && !isDirty) setDraft(saved);
  }, [isDirty, saved]);

  const updateDraft = (patch: Partial<ContractAutoFinalizeConfig>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setIsDirty(true);
  };
  const save = async () => {
    if (!draft || !isDirty) return;
    try {
      await mutation.mutateAsync(draft);
      onClose();
    } catch {
      // mutation state surfaces the server error without closing the editor.
    }
  };
  const reset = () => {
    if (saved) {
      setDraft(saved);
      setIsDirty(false);
    }
  };
  const current = draft ?? saved;

  return (
    <MobileDetailPage data-component={EDITOR_BASE} name="contract-automation-editor">
      <MobileDetailHeader
        data-component={`${EDITOR_BASE}_header`}
        name="contract-automation-editor"
        avatar={<CalendarCheck size={22} aria-hidden="true" />}
        title="계약 종료일 자동 완료"
      />
      <div className="space-y-4 px-4 pb-8" data-component={`${EDITOR_BASE}_form`}>
        {query.isError ? <p className="text-sm font-semibold text-v3-burgundy" role="alert">{errorMessage(query.error)}</p> : null}
        {mutation.isError ? <p className="text-sm font-semibold text-v3-burgundy" role="alert">{errorMessage(mutation.error)}</p> : null}
        {current ? (
          <>
            <FormSection title="자동화 설정" data-component={`${EDITOR_BASE}_settings`}>
              <FormSection title="실행 시점" data-component={`${EDITOR_BASE}_grace-days-section`}>
                <FormNativeSelect
                  aria-label="실행 시점"
                  data-component={`${EDITOR_BASE}_grace-days`}
                  value={String(current.graceDays)}
                  options={GRACE_OPTIONS}
                  onValueChange={(value) => updateDraft({ graceDays: Number(value) })}
                />
              </FormSection>
              <FormSection title="최대 시도 횟수" data-component={`${EDITOR_BASE}_max-attempts-section`}>
                <FormNativeSelect
                  aria-label="최대 시도 횟수"
                  data-component={`${EDITOR_BASE}_max-attempts`}
                  value={String(current.maxAttempts)}
                  options={ATTEMPT_OPTIONS}
                  onValueChange={(value) => updateDraft({ maxAttempts: Number(value) })}
                />
              </FormSection>
              <ToggleRow
                data-component={`${EDITOR_BASE}_enabled`}
                title="자동화 사용"
                checked={current.enabled}
                aria-label="자동화 사용"
                onClick={() => updateDraft({ enabled: !current.enabled })}
              />
            </FormSection>
            <InfoCard title="실행 조건" data-component={`${EDITOR_BASE}_conditions`}>
              <div className="space-y-2 text-sm text-v3-text-muted">
                <p>매일 17:00 (KST) 실행</p>
                <p>대상: 제공기관 검토 단계(검토 필요) 산모 계약서</p>
                <p>계약 종료일이 지난 문서만</p>
                <p>eformsign &apos;검토 완료 확인&apos; 자동 실행</p>
                <p>실패 시 최대 시도 횟수까지 재시도 후 알림</p>
              </div>
            </InfoCard>
          </>
        ) : null}
        <div className="flex gap-2" data-component={`${EDITOR_BASE}_actions`}>
          <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={reset} disabled={!isDirty || mutation.isPending}>되돌리기</Button>
          <Button type="button" className="min-h-11 flex-1" onClick={() => void save()} disabled={!isDirty || mutation.isPending}>{mutation.isPending ? "저장 중…" : "저장"}</Button>
        </div>
      </div>
    </MobileDetailPage>
  );
}
