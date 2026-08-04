'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoCard, InfoRow, PageSection, StatsBar } from '@/components/app/v3';

type AgentDiagnostics = {
  agentVersion: string;
  model: string;
  capabilityCount: number;
  capabilityVersions: Record<string, string>;
  enabled: boolean;
  rolloutStage: string;
  allowlists: { branches: number; users: number };
  effectiveFlags: { domains: Record<string, boolean>; capabilities: Record<string, boolean>; branchAllowlist: string[]; userAllowlist: string[] };
  readEnabled: boolean;
  writeEnabled: boolean;
  externalEnabled: boolean;
  privilegedEnabled: boolean;
  manifestFresh: boolean;
  drift: { status: string; inventory: number };
  evals: { suite: string; requiredCases: number; evidence: { status: string; caseCount?: number; evaluatedAt?: string | null } };
  actions: { pending: number; uncertain: number; succeeded: number; failed: number };
};

type AgentAction = {
  id: string;
  capability: string;
  status: string;
  risk: string;
  branchId: string;
  capabilityVersion: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string | null;
};

export default function AgentDiagnosticsPage() {
  const { data, isLoading, error } = useQuery<AgentDiagnostics>({
    queryKey: ['agentDiagnostics'],
    queryFn: async () => {
      const response = await fetch('/api/ai/agent/diagnostics', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('diagnostics unavailable');
      return response.json() as Promise<AgentDiagnostics>;
    },
  });
  const { data: actions = [] } = useQuery<AgentAction[]>({
    queryKey: ['agentActions'],
    queryFn: async () => {
      const response = await fetch('/api/ai/agent/diagnostics/actions', { credentials: 'same-origin' });
      if (!response.ok) return [];
      const value = await response.json() as unknown;
      return Array.isArray(value) ? value as AgentAction[] : [];
    },
  });
  const queryClient = useQueryClient();
  const [disabling, setDisabling] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const emergencyDisable = async () => {
    setDisabling(true);
    try {
      const response = await fetch('/api/ai/agent/emergency-disable', { method: 'POST', credentials: 'same-origin' });
      if (response.ok) await queryClient.invalidateQueries({ queryKey: ['agentDiagnostics'] });
    } finally {
      setDisabling(false);
      setConfirmingDisable(false);
    }
  };

  if (error) return <PageSection name="agent-diagnostics"><InfoCard data-component="desktop_admin_agent-diagnostics_error" title="진단을 불러올 수 없습니다"><p>owner 권한과 에이전트 백엔드 연결을 확인해 주세요.</p></InfoCard></PageSection>;
  return <PageSection name="agent-diagnostics">
    <StatsBar name="agent-diagnostics" isLoading={isLoading} items={[{ icon: Activity, value: data?.capabilityCount ?? 0, label: 'Capabilities', counter: '개' }, { icon: ListTodo, value: data?.actions.pending ?? 0, label: 'Pending actions', counter: '건', colorIndex: 1 }, { icon: AlertTriangle, value: data?.actions.uncertain ?? 0, label: 'Uncertain', counter: '건', colorIndex: 2 }, { icon: CheckCircle2, value: data?.actions.succeeded ?? 0, label: 'Succeeded', counter: '건', colorIndex: 3 }]} />
    <InfoCard data-component="desktop_admin_agent-diagnostics_overview" title="에이전트 런타임">
      <InfoRow label="버전" value={data?.agentVersion ?? '-'} />
      <InfoRow label="모델" value={data?.model ?? '-'} />
      <InfoRow label="글로벌 플래그" value={data?.enabled ? 'enabled' : 'disabled'} />
      <InfoRow label="롤아웃 단계" value={data?.rolloutStage ?? '-'} />
      <InfoRow label="허용 목록" value={`지점 ${data?.allowlists.branches ?? 0} · 사용자 ${data?.allowlists.users ?? 0}`} />
      <InfoRow label="읽기" value={data?.readEnabled ? 'enabled' : 'disabled'} />
      <InfoRow label="쓰기" value={data?.writeEnabled ? 'enabled' : 'disabled'} />
      <InfoRow label="외부 부작용" value={data?.externalEnabled ? 'enabled' : 'disabled'} />
      <InfoRow label="권한 작업" value={data?.privilegedEnabled ? 'enabled' : 'disabled'} />
      <InfoRow label="Manifest drift" value={`${data?.drift.status ?? '-'} (${data?.drift.inventory ?? 0})`} />
      <InfoRow label="Manifest freshness" value={data?.manifestFresh ? 'fresh' : 'failed'} />
      <InfoRow label="Capability 버전" value={Object.entries(data?.capabilityVersions ?? {}).map(([name, version]) => `${name}@${version}`).join(', ') || '-'} />
      <InfoRow label="도메인 플래그" value={JSON.stringify(data?.effectiveFlags.domains ?? {})} />
      <InfoRow label="Capability 플래그" value={JSON.stringify(data?.effectiveFlags.capabilities ?? {})} />
      <InfoRow label="허용 지점" value={data?.effectiveFlags.branchAllowlist.join(', ') || '-'} />
      <InfoRow label="허용 사용자" value={data?.effectiveFlags.userAllowlist.join(', ') || '-'} />
      <InfoRow label="실제 런타임 평가" value={`${data?.evals.evidence.status ?? 'missing'} · ${data?.evals.evidence.caseCount ?? 0}/${data?.evals.requiredCases ?? 0} cases`} />
      <Button type="button" variant="destructive" disabled={disabling || data?.enabled === false} onClick={() => confirmingDisable ? void emergencyDisable() : setConfirmingDisable(true)}>{disabling ? '비활성화 중…' : confirmingDisable ? '확인: 전체 비활성화' : '긴급 비활성화'}</Button>
      {confirmingDisable && !disabling && <Button type="button" variant="outline" onClick={() => setConfirmingDisable(false)}>취소</Button>}
    </InfoCard>
    <InfoCard data-component="desktop_admin_agent-diagnostics_actions" title="전체 대기·확인 필요 작업">
      {actions.length === 0
        ? <InfoRow label="상태" value="대기 중이거나 확인이 필요한 작업이 없습니다." />
        : <ul data-slot="actions">{actions.map((action) => <li key={action.id} data-component="desktop_admin_agent-diagnostics_actions_item"><InfoRow label={`${action.capability}@${action.capabilityVersion}`} value={`${action.status} · ${action.risk} · 지점 ${action.branchId} · 생성 ${new Date(action.createdAt).toLocaleString()} · 만료 ${new Date(action.expiresAt).toLocaleString()}${action.errorCode ? ` · ${action.errorCode}` : ''}`} /></li>)}</ul>}
    </InfoCard>
  </PageSection>;
}
