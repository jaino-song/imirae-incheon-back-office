"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import {
  useDeleteMessageTemplate,
  useMessageTemplates,
} from "@/features/message-templates/hooks/use-message-templates";
import {
  useMessageTemplate,
  useUpdateMessageTemplate,
} from "@/hooks/use-message-templates";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  HeaderActionButton,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

interface TemplateListItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: typeof FileText;
}

const formatDate = (dateString: string): string => {
  return formatDateForDisplay(dateString);
};

function TemplateEditorLoadingSkeleton({ name }: { name: string }) {
  return (
    <div data-component={name} className="flex flex-col gap-6">
      <div data-component={`${name}-name`} className="space-y-2">
        <Skeleton className="h-3 w-28 bg-v3-dim-white" />
        <Skeleton className="h-11 w-full rounded-[14px] bg-v3-dim-white" />
      </div>
      <div data-component={`${name}-content`} className="space-y-2">
        <Skeleton className="h-3 w-24 bg-v3-dim-white" />
        <Skeleton className="h-48 w-full rounded-[14px] bg-v3-dim-white" />
      </div>
      <div data-component={`${name}-action`} className="flex justify-end">
        <Skeleton className="h-10 w-20 rounded-[12px] bg-v3-dim-white" />
      </div>
    </div>
  );
}

function BranchTemplateDetail({
  templateId,
  onDeleted,
}: {
  templateId: string;
  onDeleted: () => void;
}) {
  const { data: template, isLoading } = useMessageTemplate(templateId);
  const updateMutation = useUpdateMessageTemplate();
  const deleteMutation = useDeleteMessageTemplate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (template && initialized !== template.id) {
    setName(template.name);
    setContent(template.content);
    setInitialized(template.id);
  }

  if (isLoading) {
    return <TemplateEditorLoadingSkeleton name="desktop_messages_sections_templates_user-loading" />;
  }

  if (!template) {
    return (
      <DetailEmptyState
        message="지점 템플릿을 불러올 수 없습니다."
      />
    );
  }

  const hasChanges = name !== template.name || content !== template.content;

  const handleSave = () => {
    updateMutation.mutate(
      { id: template.id, request: { name, content, variables: template.variables } },
      {
        onSuccess: () => toast({ description: "지점 템플릿이 저장되었습니다." }),
        onError: () => toast({ variant: "destructive", description: "저장 중 오류가 발생했습니다." }),
      },
    );
  };

  const handleDelete = () => {
    deleteMutation.mutate(template.id, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        onDeleted();
        toast({ description: "지점 템플릿이 삭제되었습니다." });
      },
      onError: () => {
        toast({ variant: "destructive", description: "삭제 중 오류가 발생했습니다." });
      },
    });
  };

  return (
    <div data-component="desktop_messages_sections_templates-user-detail" className="flex flex-col gap-6">
      <div data-component="desktop_messages_sections_templates-user-detail_templates-user-name-field">
        <p className="mb-2 text-[0.8rem] font-semibold text-v3-dark">
          지점 템플릿 이름 <span className="text-red-500">*</span>
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="지점 템플릿 이름을 입력하세요"
          className="w-full rounded-[14px] border border-v3-border bg-white px-4 py-3 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:border-v3-primary focus:outline-none focus:ring-2 focus:ring-v3-primary/30 transition-colors"
        />
      </div>

      <div data-component="desktop_messages_sections_templates-user-detail_templates-user-content-field">
        <p className="mb-2 text-[0.8rem] font-semibold text-v3-dark">
          템플릿 내용 <span className="text-red-500">*</span>
        </p>
        <textarea
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메시지 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="w-full resize-y rounded-[14px] border border-v3-border bg-white px-4 py-3 font-mono text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:border-v3-primary focus:outline-none focus:ring-2 focus:ring-v3-primary/30 transition-colors"
        />
      </div>

      <div data-component="desktop_messages_sections_templates-user-detail_templates-user-actions" className="flex justify-between gap-3">
        <Button
          type="button"
          variant="destructive"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={deleteMutation.isPending}
          data-component="desktop_messages_sections_templates-user-detail_templates-user-actions_delete"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          삭제
        </Button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name || !content || !hasChanges || updateMutation.isPending}
          className={cn(
            "flex items-center gap-2 rounded-[12px] px-5 py-2.5 text-[0.8rem] font-semibold transition-colors",
            hasChanges && name && content && !updateMutation.isPending
              ? "bg-v3-primary text-white hover:bg-v3-primary/90"
              : "cursor-not-allowed bg-v3-dim-white text-v3-text-muted",
          )}
        >
          {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {updateMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>

      <TwoButtonModal
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="지점 템플릿을 삭제하시겠습니까?"
        description="삭제한 지점 템플릿은 복구할 수 없습니다."
        cancelLabel="취소"
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        approvalVariant="destructive"
        isPending={deleteMutation.isPending}
        isDescriptionVisuallyHidden={false}
        onApprove={handleDelete}
        data-component="desktop_messages_sections_templates_delete-confirmation"
      />
    </div>
  );
}

export default function TemplatesPage() {
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const { data: branchTemplatesData, isLoading: isLoadingBranchTemplates } = useMessageTemplates(1, 100);
  const branchTemplates = useMemo(() => branchTemplatesData ?? [], [branchTemplatesData]);

  const branchItems = useMemo<TemplateListItem[]>(
    () =>
      branchTemplates.map((template) => ({
        id: `user:${template.id}`,
        label: template.name,
        subtitle: formatDate(template.updatedAt),
        icon: FileText,
      })),
    [branchTemplates],
  );

  const activeTemplateId = useMemo(() => {
    if (!selectedValue) {
      return null;
    }

    return branchItems.find((item) => item.id === selectedValue)?.id ?? null;
  }, [branchItems, selectedValue]);

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
  }, []);

  const branchTemplateId =
    activeTemplateId?.startsWith("user:") ? activeTemplateId.replace("user:", "") : null;

  return (
    <section
      data-component="desktop_messages_sections_templates"
      className="flex h-full min-h-0 flex-1 flex-col lg:pl-[calc(132px*var(--glint-ui-scale,1))]"
    >
      <SplitLayout data-component="desktop_messages_sections_templates_split-layout" hasSelection={!!activeTemplateId} onBack={() => setSelectedValue(null)}>
        <ListPanel data-component="desktop_messages_sections_templates_split-layout_list-panel"
          title="지점 템플릿 수정"
          subtitle="새로 만든 템플릿은 모두 지점 템플릿으로 저장됩니다."
          headerActions={
            <div data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-header-actions" className="flex items-center gap-1.5">
              <HeaderActionButton icon={Plus} label="새 템플릿" href="/messages/templates/new" />
              <HeaderActionButton icon={ArrowLeft} label="돌아가기" href="/messages" variant="muted" />
            </div>
          }
          emptyState={!(isLoadingBranchTemplates || branchItems.length > 0) ? (
            <ListEmptyState message="등록된 지점 템플릿이 없습니다." />
          ) : undefined}
        >
          <div data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list" className="space-y-2 pb-2">
            <AnimatedSlotList<TemplateListItem>
                items={branchItems}
                isLoading={isLoadingBranchTemplates}
                className="space-y-2"
                getSlotState={({ item, isLoading }) => ({
                  isActive: !isLoading && item?.id === activeTemplateId,
                  isInteractive: !isLoading && Boolean(item),
                })}
                onSlotClick={(item) => handleTemplateSelect(item.id)}
                render={({ item, isLoading: isSlotLoading }) => {
                  if (isSlotLoading) {
                    return (
                      <>
                        <div
                          data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list_templates-list-skeleton-icon"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                        >
                          <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                        </div>
                        <div
                          data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list_templates-list-skeleton-text"
                          className="min-w-0 flex-1 space-y-1.5"
                        >
                          <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                          <Skeleton className="h-3 w-20 bg-v3-dim-white" />
                        </div>
                      </>
                    );
                  }

                  if (!item) return null;

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="desktop_messages_sections_templates-list-item"
                      icon={item.icon}
                      title={item.label}
                      subtitle={item.subtitle}
                    />
                  );
                }}
              />
            </div>
        </ListPanel>

        <DetailPanel data-component="desktop_messages_sections_templates_split-layout_detail-panel">
          {!activeTemplateId ? (
            <DetailEmptyState
              message="지점 템플릿을 선택하면 상세 정보가 표시됩니다."
            />
          ) : null}

          {branchTemplateId ? (
            <BranchTemplateDetail
              key={branchTemplateId}
              templateId={branchTemplateId}
              onDeleted={() => setSelectedValue(null)}
            />
          ) : null}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}
