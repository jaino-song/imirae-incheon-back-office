"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
} from "@/components/app/mobile-redesign/detail-sheet";
import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { toast } from "@/hooks/use-toast";
import {
  useClientDraft,
  useConfirmDraft,
  useDiscardDraft,
  usePatchDraft,
} from "@/hooks/useCallInbox";
import { formatCallTime, formatPhoneNumber } from "@/lib/call-inbox/format";
import type {
  ClientDraftDetail,
  ClientDraftListItem,
  Proposal,
} from "@/lib/call-inbox/types";
import { findEvidenceTurnIndex, transcriptTurnId, TranscriptView } from "./TranscriptView";

const FIELD_LABELS: Record<string, string> = {
  name: "산모명",
  phone: "연락처",
  address: "주소",
  dueDate: "출산예정일",
  birthday: "생년월일",
  startDate: "시작일",
  endDate: "종료일",
  duration: "기간(일)",
  type: "서비스 유형",
  careCenter: "조리원 이용",
  voucherClient: "정부지원",
  breastPump: "유축기",
  serviceStatus: "서비스 상태",
  fullPrice: "전체 금액",
  grant: "지원금",
  actualPrice: "실결제 금액",
};

const TEXT_FIELDS = [
  { field: "name", type: "text" },
  { field: "phone", type: "tel" },
  { field: "address", type: "text" },
  { field: "dueDate", type: "date" },
  { field: "birthday", type: "text" },
  { field: "startDate", type: "date" },
  { field: "endDate", type: "date" },
  { field: "duration", type: "number" },
] as const;

const TOGGLE_FIELDS = [
  { field: "careCenter", label: "조리원 이용" },
  { field: "voucherClient", label: "정부지원" },
  { field: "breastPump", label: "유축기" },
] as const;

// birthday is YYMMDD text, not ISO — keep it out
const DATE_FIELDS = new Set(["dueDate", "startDate", "endDate"]);

function proposalFor(proposals: Proposal[], field: string): Proposal | undefined {
  return proposals.find((p) => p.field === field);
}

function proposalString(proposals: Proposal[], field: string): string {
  const value = proposalFor(proposals, field)?.value;
  if (value === null || value === undefined || typeof value === "boolean") return "";
  return String(value);
}

function proposalBool(proposals: Proposal[], field: string): boolean {
  return proposalFor(proposals, field)?.value === true;
}

function displayValue(value: Proposal["value"]): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return String(value);
}

export function CallReviewSheet({
  draftId,
  listItem,
  onClose,
}: {
  draftId: string | null;
  listItem?: ClientDraftListItem | null;
  onClose: () => void;
}) {
  const { data: draft, isLoading } = useClientDraft(draftId);

  if (draftId === null) return null;

  return (
    <MobileDetailPage name="call-inbox" data-component="call-inbox-review">
      {isLoading || !draft ? (
        <div className="p-4 text-[0.82rem] text-v3-text-muted" data-component="call-inbox-review-loading">
          불러오는 중...
        </div>
      ) : draft.type === "NEW_CLIENT" ? (
        <NewClientReview key={draft.id} draft={draft} listItem={listItem ?? null} onClose={onClose} />
      ) : (
        <ClientUpdateReview key={draft.id} draft={draft} onClose={onClose} />
      )}
    </MobileDetailPage>
  );
}

function EvidenceChip({
  proposal,
  transcript,
  onJump,
}: {
  proposal: Proposal | undefined;
  transcript: { speaker: string; text: string }[];
  onJump: (index: number) => void;
}) {
  if (!proposal?.evidence) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const index = findEvidenceTurnIndex(transcript, proposal.evidence);
        if (index >= 0) onJump(index);
      }}
      className="mt-1 inline-block rounded-md border border-dashed border-v3-border px-2 py-1 text-left text-[0.68rem] text-v3-text-muted"
      data-component="call-inbox-evidence-chip"
    >
      🎙 {proposal.evidence}
    </button>
  );
}

function ReviewHeader({ draft, title }: { draft: ClientDraftDetail; title: string }) {
  const driveUrl = `https://drive.google.com/file/d/${draft.callRecord.driveFileId}/view`;
  return (
    <>
      <MobileDetailHeader data-component="mobile_call-inbox_detail-sheet_stack_detail-page_header"
        name="call-inbox"
        avatar={<span className="text-[1rem]">📞</span>}
        avatarTone={draft.type === "NEW_CLIENT" ? "green" : "orange"}
        title={title}
        badges={[
          {
            label: draft.type === "NEW_CLIENT" ? "신규 상담" : "변경 요청",
            tone: draft.type === "NEW_CLIENT" ? "green" : "orange",
          },
        ]}
      />
      <div className="flex items-center justify-between px-1 text-[0.72rem] text-v3-text-muted">
        <span>{formatCallTime(draft.callRecord.recordedAt ?? draft.callRecord.createdAt)}</span>
        {draft.callRecord.driveFileId && (
          <a href={driveUrl} target="_blank" rel="noreferrer" className="text-v3-primary">
            ▶ 원본 듣기
          </a>
        )}
      </div>
      {draft.requestSummary && (
        <p className="px-1 text-[0.8rem] leading-relaxed text-v3-text">{draft.requestSummary}</p>
      )}
    </>
  );
}

function ReadOnlyBanner({ draft }: { draft: ClientDraftDetail }) {
  const label = draft.status === "CONFIRMED" ? "검토 완료" : "폐기됨";
  const who = draft.reviewedBy?.name;
  const when = draft.reviewedAt ? formatCallTime(draft.reviewedAt) : null;
  return (
    <div
      className="rounded-xl bg-gray-100 px-3 py-2 text-[0.78rem] text-v3-text"
      data-component="call-inbox-review-readonly-banner"
    >
      {label}
      {who ? ` · ${who}` : ""}
      {when ? ` · ${when}` : ""}
    </div>
  );
}

function TranscriptSection({
  draft,
  highlight,
}: {
  draft: ClientDraftDetail;
  highlight: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[0.75rem] font-bold text-v3-text-muted">통화 전문</div>
      <TranscriptView transcript={draft.callRecord.transcript} highlightIndex={highlight} />
    </div>
  );
}

function useEvidenceJump() {
  const [highlight, setHighlight] = useState<number | null>(null);
  const jump = (index: number) => {
    setHighlight(index);
    if (typeof document !== "undefined") {
      document.getElementById(transcriptTurnId(index))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  return { highlight, jump };
}

function NewClientReview({
  draft,
  listItem,
  onClose,
}: {
  draft: ClientDraftDetail;
  listItem: ClientDraftListItem | null;
  onClose: () => void;
}) {
  const { proposals } = draft;
  const confirmDraft = useConfirmDraft(draft.id);
  const discardDraft = useDiscardDraft(draft.id);
  const { highlight, jump } = useEvidenceJump();

  const [fields, setFields] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const { field } of TEXT_FIELDS) {
      seed[field] = proposalString(proposals, field);
    }
    if (!seed.phone && draft.callRecord.callerPhone) {
      seed.phone = formatPhoneNumber(draft.callRecord.callerPhone);
    }
    return seed;
  });
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => ({
    careCenter: proposalBool(proposals, "careCenter"),
    voucherClient: proposalBool(proposals, "voucherClient"),
    breastPump: proposalBool(proposals, "breastPump"),
  }));
  const [sendGreeting, setSendGreeting] = useState(true);

  const setField = (field: string, value: string) =>
    setFields((prev) => ({ ...prev, [field]: value }));

  const isPending = draft.status === "PENDING";
  const busy = confirmDraft.isPending || discardDraft.isPending;

  const handleDiscard = async () => {
    try {
      await discardDraft.mutateAsync({});
      toast({ title: "폐기됨" });
      onClose();
    } catch {
      toast({ title: "폐기 실패", variant: "destructive" });
    }
  };

  const handleConfirm = async () => {
    const name = fields.name?.trim() ?? "";
    if (!name) {
      toast({ title: "산모명을 입력해 주세요", variant: "destructive" });
      return;
    }
    const durationRaw = fields.duration?.trim() ?? "";
    const durationParsed = durationRaw ? Number(durationRaw) : NaN;
    try {
      const result = await confirmDraft.mutateAsync({
        fields: {
          name,
          phone: fields.phone?.trim() || null,
          address: fields.address?.trim() || null,
          dueDate: fields.dueDate?.trim() || null,
          birthday: fields.birthday?.trim() || null,
          startDate: fields.startDate?.trim() || null,
          endDate: fields.endDate?.trim() || null,
          duration: Number.isFinite(durationParsed) ? durationParsed : null,
          careCenter: toggles.careCenter ?? false,
          voucherClient: toggles.voucherClient ?? false,
          breastPump: toggles.breastPump ?? false,
        },
        suppressGreetingSms: !sendGreeting,
      });
      toast({ title: `고객 등록 완료 (#${result.clientId})` });
      onClose();
    } catch {
      toast({ title: "고객 등록 실패", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-4 px-1 pb-6" data-component="call-inbox-review-new-client">
      <ReviewHeader draft={draft} title="신규 상담 검토" />

      {!isPending && <ReadOnlyBanner draft={draft} />}

      {listItem?.phoneMatchesExistingClient && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[0.78rem] font-medium text-amber-700"
          data-component="call-inbox-review-duplicate-banner"
        >
          기존 고객과 전화번호가 일치합니다
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="text-[0.75rem] font-bold text-v3-text-muted">추출된 고객 정보 — 수정 후 등록</div>
        {TEXT_FIELDS.map(({ field, type }) => {
          const proposal = proposalFor(proposals, field);
          const isLow = proposal?.confidence === "low";
          return (
            <div key={field} className="flex flex-col gap-1">
              <Label htmlFor={`review-${field}`} className="text-[0.72rem] text-v3-text-muted">
                {FIELD_LABELS[field]}
              </Label>
              <Input
                id={`review-${field}`}
                type={type}
                value={fields[field] ?? ""}
                disabled={!isPending}
                onChange={(e) =>
                  setField(
                    field,
                    field === "phone" ? formatPhoneNumber(e.target.value) : e.target.value,
                  )
                }
                className={isLow ? "border-amber-400 bg-amber-50" : undefined}
              />
              <EvidenceChip proposal={proposal} transcript={draft.callRecord.transcript} onJump={jump} />
            </div>
          );
        })}

        <div className="flex flex-col gap-2">
          {TOGGLE_FIELDS.map(({ field, label }) => (
            <div key={field} className="flex items-center justify-between">
              <span className="text-[0.8rem] text-v3-dark">{label}</span>
              <Switch
                checked={toggles[field] ?? false}
                disabled={!isPending}
                onCheckedChange={(checked) =>
                  setToggles((prev) => ({ ...prev, [field]: checked }))
                }
              />
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-[0.8rem] text-v3-dark">등록 인사 문자 발송</span>
            <Switch checked={sendGreeting} disabled={!isPending} onCheckedChange={setSendGreeting} />
          </div>
        </div>
      </div>

      {isPending && (
        <MobileDetailActions data-component="mobile_call-inbox_detail-sheet_stack_detail-page_actions"
          name="call-inbox"
          actions={[
            {
              label: "폐기",
              variant: "secondary",
              onClick: handleDiscard,
              disabled: busy,
              busy: discardDraft.isPending,
            },
            {
              label: confirmDraft.isPending ? "등록 중..." : "고객 등록",
              variant: "primary",
              onClick: handleConfirm,
              disabled: busy,
              busy: confirmDraft.isPending,
            },
          ]}
        />
      )}

      <TranscriptSection draft={draft} highlight={highlight} />
    </div>
  );
}

function ClientUpdateReview({
  draft,
  onClose,
}: {
  draft: ClientDraftDetail;
  onClose: () => void;
}) {
  const { proposals } = draft;
  const confirmDraft = useConfirmDraft(draft.id);
  const discardDraft = useDiscardDraft(draft.id);
  const patchDraft = usePatchDraft(draft.id);
  const { highlight, jump } = useEvidenceJump();

  const isPending = draft.status === "PENDING";
  const isLinked = draft.clientId != null;

  // per-row include toggles (all ON by default)
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(proposals.map((p) => [p.field, true])),
  );

  // per-row editable values (seeded from proposal.value)
  const [editedValues, setEditedValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposals
        .filter((p) => typeof p.value !== "boolean")
        .map((p) => [p.field, p.value === null || p.value === undefined ? "" : String(p.value)]),
    ),
  );

  const includedCount = proposals.filter((p) => included[p.field]).length;
  const busy = confirmDraft.isPending || discardDraft.isPending;

  const handleDiscard = async () => {
    try {
      await discardDraft.mutateAsync({});
      toast({ title: "폐기됨" });
      onClose();
    } catch {
      toast({ title: "폐기 실패", variant: "destructive" });
    }
  };

  const handleApply = async () => {
    const changes: Record<string, string | number | boolean | null> = {};
    for (const proposal of proposals) {
      if (!included[proposal.field]) continue;
      if (typeof proposal.value === "boolean") {
        // boolean toggles keep their proposal value (read-only in this view)
        changes[proposal.field] = proposal.value;
      } else {
        const raw = editedValues[proposal.field] ?? "";
        // coerce numeric fields
        if (typeof proposal.value === "number") {
          const n = Number(raw);
          changes[proposal.field] = Number.isFinite(n) ? n : null;
        } else {
          changes[proposal.field] = raw || null;
        }
      }
    }

    try {
      await confirmDraft.mutateAsync({ changes });
      toast({ title: `변경 적용 완료 (${includedCount}건)` });
      onClose();
    } catch {
      toast({
        title: "적용에 실패했습니다. 값을 확인해 주세요.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 px-1 pb-6" data-component="call-inbox-review-client-update">
      <ReviewHeader draft={draft} title="변경 요청 검토" />

      {!isPending && <ReadOnlyBanner draft={draft} />}

      {draft.client ? (
        <div
          className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2.5 text-[0.78rem]"
          data-component="call-inbox-review-client-card"
        >
          <span className="text-v3-dark">
            <b>{draft.client.name}</b>
            {draft.client.phone ? ` · ${formatPhoneNumber(draft.client.phone)}` : ""}
          </span>
          <a href="/clients" className="text-v3-primary">
            고객 상세 보기 ›
          </a>
        </div>
      ) : (
        <ClientAutocomplete
          label="고객 연결"
          value={draft.clientId}
          placeholder="전화번호 미매칭 — 고객 검색"
          onChange={(clientId) => {
            patchDraft.mutate({ clientId: clientId ?? null });
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <div className="text-[0.75rem] font-bold text-v3-text-muted">제안된 변경 사항</div>
        {proposals.map((proposal) => {
          const isLow = proposal.confidence === "low";
          const hasCurrent =
            proposal.currentValue !== null && proposal.currentValue !== undefined;
          const isIncluded = included[proposal.field] ?? true;
          const isBool = typeof proposal.value === "boolean";

          return (
            <div
              key={proposal.field}
              className={`rounded-xl border p-3 ${isIncluded ? "border-v3-border" : "border-v3-border opacity-50"}`}
              data-component="call-inbox-review-diff-row"
            >
              <div className="mb-1 flex items-center justify-between text-[0.72rem] text-v3-text-muted">
                <span>{FIELD_LABELS[proposal.field] ?? proposal.field}</span>
                <div className="flex items-center gap-2">
                  {isLow && <span className="font-bold text-amber-600">⚠ 확신도 낮음</span>}
                  {isPending && (
                    <Switch
                      checked={isIncluded}
                      onCheckedChange={(checked) =>
                        setIncluded((prev) => ({ ...prev, [proposal.field]: checked }))
                      }
                      aria-label={`${FIELD_LABELS[proposal.field] ?? proposal.field} 포함`}
                    />
                  )}
                </div>
              </div>
              {hasCurrent && (
                <div className="mb-1 flex items-center gap-2 text-[0.78rem] text-v3-text-muted">
                  <span className="line-through">{displayValue(proposal.currentValue ?? null)}</span>
                  <span>→</span>
                </div>
              )}
              {isPending && !isBool ? (
                <Input
                  type={DATE_FIELDS.has(proposal.field) ? "date" : "text"}
                  value={editedValues[proposal.field] ?? ""}
                  disabled={!isIncluded}
                  onChange={(e) =>
                    setEditedValues((prev) => ({ ...prev, [proposal.field]: e.target.value }))
                  }
                  className="text-[0.85rem]"
                  aria-label={FIELD_LABELS[proposal.field] ?? proposal.field}
                />
              ) : isPending && isBool ? (
                <div className="flex items-center gap-2 text-[0.85rem]">
                  <span className="font-bold text-v3-orange">{displayValue(proposal.value)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[0.85rem]">
                  <span className="font-bold text-v3-orange">{displayValue(proposal.value)}</span>
                </div>
              )}
              <EvidenceChip
                proposal={proposal}
                transcript={draft.callRecord.transcript}
                onJump={jump}
              />
            </div>
          );
        })}
      </div>

      {isPending && (
        <MobileDetailActions data-component="mobile_call-inbox_detail-sheet_stack_detail-page_actions-2"
          name="call-inbox"
          actions={[
            {
              label: "폐기",
              variant: "secondary",
              onClick: handleDiscard,
              disabled: busy,
              busy: discardDraft.isPending,
            },
            {
              label: confirmDraft.isPending
                ? "적용 중..."
                : `변경 적용 (${includedCount}건)`,
              variant: "primary",
              onClick: handleApply,
              disabled: !isLinked || includedCount === 0 || busy,
              busy: confirmDraft.isPending,
            },
          ]}
        />
      )}

      <TranscriptSection draft={draft} highlight={highlight} />
    </div>
  );
}
