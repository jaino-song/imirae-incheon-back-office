"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { FolderOpen, FileText, Image as ImageIcon, File, Upload, CloudUpload, Loader2, Tag, MoreVertical, Pencil, Trash2, Eye, X } from "lucide-react";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { StatsBar, SplitLayout, ListPanel, DetailPanel, InfoCard, InfoRow, HeaderActionButton, AnimatedSlotList, AnimatedSlotListItemContent, EmptyState, PageSection, DetailSkeleton, ListEmptyState } from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  useDocuments,
  useDocumentUploadCapabilities,
  useUploadDocument,
  useUpdateDocument,
  useDeleteDocument,
  Document,
} from "@/hooks/use-documents";
import { useDocumentCategories, useCreateDocumentCategory } from "@/hooks/use-document-categories";
import { DocumentDropzone } from "@/components/app/documents/document-dropzone";
import { DocumentEditModal } from "@/components/app/documents/document-edit-modal";
import { AddCategoryModal } from "@/components/app/documents/add-category-modal";
import { formatDate } from "@/components/app/documents/document-list";
import { getFileFormatLabel, isHangulDocument } from "@/components/app/documents/document-preview-utils";
import { toast } from "@/hooks/use-toast";
import type { DocumentVisibilityScope } from "@babyjamjam/shared/file-storage";

const FILES_UPLOAD_FORM_ID = "files-upload-form";
const DocumentPreviewModal = dynamic(
  () => import("@/components/app/documents/document-preview-modal"),
  { ssr: false },
);
const EMPTY_UPLOAD_STATE = {
  hasSelectedFile: false,
  canSubmit: false,
};

export function FileStoragePage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDropzoneState, setUploadDropzoneState] = useState(EMPTY_UPLOAD_STATE);

  const { data: documents = [], isLoading, error } = useDocuments();
  const { data: uploadCapabilities } = useDocumentUploadCapabilities();
  const { data: categories = [] } = useDocumentCategories();
  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();
  const createCategoryMutation = useCreateDocumentCategory();

  const filterItems = useMemo(() => [
    { label: "전체", value: "all" },
    ...categories.map(c => ({ label: c.label, value: c.id })),
  ], [categories]);

  const filteredDocs = useMemo(() => {
    let docs = [...documents];
    if (activeFilter !== "all") {
      docs = docs.filter(d => d.categoryId === activeFilter);
    }
    if (searchQuery.trim()) {
      docs = docs.filter(d =>
        matchesSearchQuery(searchQuery, [d.name, d.description, ...(d.tags ?? [])])
      );
    }
    return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [documents, activeFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = documents.length;
    return { total, categoryCount: categories.length };
  }, [documents, categories]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null;
    return filteredDocs.find(d => d.id === selectedDocId) ?? null;
  }, [selectedDocId, filteredDocs]);

  function getFileIcon(doc: Document) {
    if (doc.mimeType.includes("pdf")) return <FileText className="w-4 h-4 text-v3-burgundy" />;
    if (isHangulDocument(doc)) return <FileText className="w-4 h-4 text-v3-primary" />;
    if (doc.mimeType.includes("image")) return <ImageIcon className="w-4 h-4 text-v3-primary" />;
    return <File className="w-4 h-4 text-v3-text-muted" />;
  }

  function getCategoryLabel(doc: Document): string {
    return doc.categoryLabel ?? categories.find(c => c.id === doc.categoryId)?.label ?? "미분류";
  }

  const handleUpload = async (params: { file: File; name: string; description?: string; categoryId: string; tags: string[]; visibilityScope: DocumentVisibilityScope }) => {
    try {
      setUploadProgress(0);
      await uploadMutation.mutateAsync({ ...params, onProgress: (p: number) => setUploadProgress(p) });
      setIsUploadOpen(false);
      setUploadDropzoneState(EMPTY_UPLOAD_STATE);
      toast({ description: "문서를 업로드했어요", variant: "success" });
    } catch {
      toast({ description: "문서를 업로드하지 못했어요", variant: "destructive" });
    }
  };

  const handleUploadOpenChange = (open: boolean) => {
    if (uploadMutation.isPending) return;

    setIsUploadOpen(open);
    if (!open) {
      setUploadDropzoneState(EMPTY_UPLOAD_STATE);
    }
  };

  const handleUpdate = async (id: string, params: { name?: string; description?: string; categoryId?: string; tags?: string[] }) => {
    try {
      await updateMutation.mutateAsync({ id, ...params });
      setEditDoc(null);
      toast({ description: "문서를 수정했어요", variant: "success" });
    } catch {
      toast({ description: "문서를 수정하지 못했어요", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    try {
      await deleteMutation.mutateAsync(deleteDoc.id);
      setDeleteDoc(null);
      toast({ description: "문서를 삭제했어요", variant: "success" });
    } catch {
      toast({ description: "문서를 삭제하지 못했어요", variant: "destructive" });
    }
  };

  const handleAddCategory = async (category: { value: string; label: string; color: string }) => {
    try {
      await createCategoryMutation.mutateAsync(category);
      setIsAddCategoryOpen(false);
      toast({ description: "카테고리를 추가했어요", variant: "success" });
    } catch {
      toast({ description: "카테고리를 추가하지 못했어요", variant: "destructive" });
    }
  };

  if (error) {
    return (
      <div data-component="desktop_files_error_container" className="p-6">
        <div data-component="desktop_files_error_container_message" className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          문서를 불러오는데 실패했습니다.
        </div>
      </div>
    );
  }

  return (
    <PageSection name="files">
      <StatsBar
        name="files"
        isLoading={isLoading}
        items={[
          { icon: FolderOpen, value: stats.total, label: "전체 파일", counter: "건" },
          { icon: Tag, value: stats.categoryCount, label: "카테고리", counter: "개", colorIndex: 1 },
        ]}
      />

      <SplitLayout data-component="desktop_files_split-layout" hasSelection={!!selectedDocument} onBack={() => setSelectedDocId(null)}>
        <ListPanel data-component="desktop_files_split-layout_list-panel"
          title="파일 목록"
          tabs={filterItems}
          activeTab={activeFilter}
          onTabChange={setActiveFilter}
          tabsVariant="dropdown"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="문서명, 설명, 태그 검색..."
          headerActions={
            <HeaderActionButton
              icon={Upload}
              label="업로드"
              onClick={() => setIsUploadOpen(true)}
              data-component="desktop_files_split-layout_list-panel_files-upload-btn"
            />
          }
          emptyState={!isLoading && filteredDocs.length === 0 ? (
            <ListEmptyState message={searchQuery ? "검색 결과가 없습니다" : "등록된 문서가 없습니다"} />
          ) : undefined}
        >
          <AnimatedSlotList<Document>
              items={filteredDocs}
              isLoading={isLoading}
              loadingCount={4}
              className="space-y-2"
              itemVariant="card"
              getSlotState={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && selectedDocument?.id === item.id;
                return {
                  isActive: Boolean(isActive),
                  isInteractive: !slotLoading && Boolean(item),
                };
              }}
              onSlotClick={(doc) => setSelectedDocId(doc.id)}
              render={({ item: doc, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div data-component="desktop_files_split-layout_list-panel_files-list-item-skeleton-icon" className="w-9 h-9 rounded-[10px] shrink-0 bg-v3-dim-white flex items-center justify-center">
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div data-component="desktop_files_split-layout_list-panel_files-list-item-skeleton-content" className="flex-1 min-w-0">
                        <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-32 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-3 w-12 bg-v3-dim-white shrink-0" />
                    </>
                  );
                }
                if (!doc) return null;
                return (
                  <AnimatedSlotListItemContent
                    dataComponent="desktop_files_split-layout_list-panel_files-list-item"
                    icon={getFileIcon(doc)}
                    iconContainerClassName="bg-v3-primary-light"
                    title={doc.name}
                    subtitle={`${getCategoryLabel(doc)} · ${doc.visibilityScope === "all_branches" ? "모든 지점" : "현재 지점"}`}
                    status={
                      <span className="whitespace-nowrap text-[calc(10.4px*var(--glint-ui-scale,1))] text-v3-text-muted">
                        {formatDate(doc.createdAt)}
                      </span>
                    }
                  />
                );
              }}
            />
        </ListPanel>

        {isLoading ? (
          <DetailSkeleton
            name="files-detail-skeleton"
            headerActions={3}
            sections={[
              { titleWidth: "w-16", rows: ["w-1/2", "w-2/3", "w-1/3", "w-1/2", "w-1/2"] },
              { titleWidth: "w-10", rows: ["w-3/4"] },
            ]}
          />
        ) : selectedDocument ? (
          <FileDetail
            key={selectedDocument.id}
            document={selectedDocument}
            getCategoryLabel={getCategoryLabel}
            onPreview={() => setPreviewDoc(selectedDocument)}
            onEdit={() => setEditDoc(selectedDocument)}
            onDelete={() => setDeleteDoc(selectedDocument)}
          />
        ) : (
          <EmptyState icon={FolderOpen} message="파일을 선택하면 상세 정보가 표시됩니다" />
        )}
      </SplitLayout>

      <Dialog open={isUploadOpen} onOpenChange={handleUploadOpenChange}>
        <DialogContent
          data-component="desktop_files_upload-dialog"
          showCloseButton={false}
          className="flex max-h-[90vh] w-[min(720px,calc(100vw-1.5rem))] max-w-[720px] flex-col overflow-hidden rounded-[28px] border-none bg-v3-dim-white p-0 shadow-[0_20px_60px_hsla(214,50%,20%,0.15)] gap-0"
        >
          <DialogHeader className="shrink-0 flex-row items-start justify-between border-b border-v3-border bg-white p-6 text-left">
            <div data-component="desktop_files_upload-dialog_heading" className="flex min-w-0 flex-col items-start gap-2 pr-12">
              <DialogTitle className="flex items-center gap-2 text-[1.35rem] font-bold tracking-[-0.02em] text-v3-dark">
                <Upload className="h-5 w-5 text-v3-primary" />
                파일 업로드
              </DialogTitle>
              <DialogDescription className="sr-only">
                파일을 선택하고 문서 정보를 입력해 저장소에 업로드합니다.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="업로드 닫기"
              onClick={() => handleUploadOpenChange(false)}
              disabled={uploadMutation.isPending}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div data-component="desktop_files_upload-dialog_content" className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-6">
            <DocumentDropzone
              data-component="desktop_files_upload-dialog_dropzone"
              formId={FILES_UPLOAD_FORM_ID}
              showInlineSubmitButton={false}
              onUploadStateChange={setUploadDropzoneState}
              onUpload={handleUpload}
              isLoading={uploadMutation.isPending}
              uploadProgress={uploadProgress}
              capabilities={uploadCapabilities}
            />
          </div>
          <DialogFooter className="shrink-0 border-t border-v3-border bg-white px-6 py-4 sm:justify-between">
            <Button variant="outline" onClick={() => handleUploadOpenChange(false)} disabled={uploadMutation.isPending}>취소</Button>
            {uploadDropzoneState.hasSelectedFile && (
              <Button
                type="submit"
                form={FILES_UPLOAD_FORM_ID}
                variant="positive"
                disabled={!uploadDropzoneState.canSubmit}
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    업로드 중...
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-4 w-4" />
                    문서 업로드
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentPreviewModal
        data-component="desktop_files_preview-dialog"
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        doc={previewDoc}
        categories={categories}
        onEdit={previewDoc?.canManage ? (doc: Document) => setEditDoc(doc) : undefined}
        onDelete={previewDoc?.canManage ? (doc: Document) => { setPreviewDoc(null); setDeleteDoc(doc); } : undefined}
      />

      <DocumentEditModal open={!!editDoc} onClose={() => setEditDoc(null)} doc={editDoc} onSave={handleUpdate} isLoading={updateMutation.isPending} />

      <AddCategoryModal
        open={isAddCategoryOpen}
        onClose={() => setIsAddCategoryOpen(false)}
        onAdd={handleAddCategory}
        existingColors={categories.filter(c => c.isCustom).map(c => c.color)}
        isLoading={createCategoryMutation.isPending}
      />

      <TwoButtonModal
        open={deleteDoc !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDoc(null);
        }}
        dataComponent="desktop_files_delete-approval"
        title="문서를 삭제하시겠습니까?"
        description="이 작업은 되돌릴 수 없습니다."
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        approvalVariant="destructive"
        isPending={deleteMutation.isPending}
        onApprove={() => void handleDelete()}
      />
    </PageSection>
  );
}

function FileDetail({ document: doc, getCategoryLabel, onPreview, onEdit, onDelete }: {
  document: Document;
  getCategoryLabel: (doc: Document) => string;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DetailPanel data-component="desktop_files_split-layout_detail-panel"
      title={doc.name}
      badges={
        <div data-component="desktop_files_split-layout_detail-panel_visibility-badges" className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold bg-v3-primary-light text-v3-primary">
            {getCategoryLabel(doc)}
          </span>
          <span className="inline-flex items-center rounded-[50px] bg-v3-dim-white px-3 py-1 text-[0.65rem] font-semibold text-v3-text-muted">
            {doc.visibilityScope === "all_branches" ? "모든 지점 공개" : "현재 지점 전용"}
          </span>
        </div>
      }
      subtitle={<>등록일: {formatDate(doc.createdAt)}</>}
      trailing={
        <div data-component="desktop_files_split-layout_detail-panel_files-detail-actions" className="flex items-center gap-2">
          <Button
            variant="positive"
            size="sm"
            data-component="desktop_files_split-layout_detail-panel_files-detail-actions_contracts-detail-preview-trigger"
            onClick={onPreview}
          >
            <Eye className="h-4 w-4" />
            파일 보기
          </Button>

          {doc.canManage && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="문서 작업 더보기"
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors"
              >
                <MoreVertical className="w-5 h-5 text-v3-text-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="w-4 h-4" />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
                <Trash2 className="w-4 h-4" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      }
    >
      <div data-component="desktop_files_split-layout_detail-panel_files-detail-content" className="space-y-5">
        <InfoCard data-component="desktop_files_detail-panel_info-card" title="파일 정보">
          <InfoRow label="파일명" value={doc.name} />
          <InfoRow label="형식" value={getFileFormatLabel(doc).toUpperCase()} />
          <InfoRow label="카테고리" value={getCategoryLabel(doc)} />
          <InfoRow label="등록일" value={formatDate(doc.createdAt)} />
          <InfoRow label="수정일" value={formatDate(doc.updatedAt)} />
          <InfoRow label="공개 범위" value={doc.visibilityScope === "all_branches" ? "모든 지점" : "현재 지점"} />
          <InfoRow label="관리 권한" value={doc.canManage ? "수정·삭제 가능" : "열람만 가능"} />
        </InfoCard>

        {doc.description && (
          <InfoCard data-component="desktop_files_detail-panel_info-card-2" title="설명">
            <p className="text-[0.8rem] text-v3-text">{doc.description}</p>
          </InfoCard>
        )}

        {doc.tags && doc.tags.length > 0 && (
          <InfoCard data-component="desktop_files_detail-panel_info-card-3" title="태그">
            <div data-component="desktop_files_detail-panel_info-card-3_files-detail-tags" className="flex flex-wrap gap-2">
              {doc.tags.map(tag => (
                <span key={tag} className="inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold bg-v3-primary-light text-v3-primary">
                  {tag}
                </span>
              ))}
            </div>
          </InfoCard>
        )}
      </div>
    </DetailPanel>
  );
}
