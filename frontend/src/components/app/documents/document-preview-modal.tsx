"use client";

import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Document, getDownloadUrl } from "@/hooks/use-documents";
import { DocumentCategory } from "@/hooks/use-document-categories";
import { formatFileSize, formatDate } from "./document-list";
import { getDownloadFileName, getFileFormatLabel, getPreviewKind } from "./document-preview-utils";
import {
  SharedDocumentPreviewDialog,
  type PreviewMetaItem,
} from "./shared-document-preview-dialog";

interface DocumentPreviewModalProps {
  /** Canonical caller-context data-component base for the preview dialog. */
  "data-component": string;
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  categories: DocumentCategory[];
  onEdit?: (doc: Document) => void;
  onDelete?: (doc: Document) => void;
}

function getCategoryLabel(doc: Document, categories: DocumentCategory[]): string {
  const category = categories.find((item) => item.id === doc.categoryId);
  return doc.categoryLabel ?? category?.label ?? doc.categoryId;
}

export default function DocumentPreviewModal({
  "data-component": dataComponent,
  open,
  onClose,
  doc,
  categories,
  onEdit,
  onDelete,
}: DocumentPreviewModalProps) {
  if (!doc) {
    return null;
  }

  const previewKind = getPreviewKind(doc);
  const srDescription =
    previewKind === "hwp"
      ? "문서 메타데이터와 한글 미리보기를 확인하고 확대, 다운로드를 할 수 있습니다."
      : "문서 메타데이터와 미리보기를 확인하고 확대, 인쇄, 다운로드를 할 수 있습니다.";

  const metaItems: PreviewMetaItem[] = [
    {
      label: "파일 크기",
      value: formatFileSize(doc.fileSize),
    },
    {
      label: "등록일",
      value: formatDate(doc.createdAt),
    },
    {
      label: "파일 포맷",
      value: (
        <span className="uppercase">
          {getFileFormatLabel(doc)}
        </span>
      ),
    },
  ];

  const metaAction =
    onEdit || onDelete ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="문서 작업 더보기"
            className="h-8 w-8"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && <DropdownMenuItem onClick={() => onEdit(doc)}>수정</DropdownMenuItem>}
          {onDelete && (
            <DropdownMenuItem
              onClick={() => {
                onDelete(doc);
                onClose();
              }}
            >
              삭제
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const metaExtra = (
    <>
      {doc.tags && doc.tags.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">태그</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {doc.tags.map((tag, index) => (
              <Badge key={`${doc.id}-tag-${index}`} variant="outline" className="text-xs">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {doc.description && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">설명</p>
          <p className="mt-0.5 text-sm">{doc.description}</p>
        </div>
      )}
    </>
  );

  return (
    <SharedDocumentPreviewDialog
      data-component={dataComponent}
      open={open}
      onClose={onClose}
      title={doc.name}
      badges={[
        <Badge variant="outline" key="category">
          {getCategoryLabel(doc, categories)}
        </Badge>,
        <Badge variant="outline" key="visibility">
          {doc.visibilityScope === "all_branches" ? "모든 지점 공개" : "현재 지점 전용"}
        </Badge>,
      ]}
      srDescription={srDescription}
      metaItems={metaItems}
      metaAction={metaAction}
      metaExtra={metaExtra}
      previewKind={previewKind}
      previewUrl={getDownloadUrl(doc.id)}
      downloadUrl={getDownloadUrl(doc.id, true)}
      downloadFileName={getDownloadFileName(doc)}
      imageAlt={doc.name}
      previewKey={doc.id}
      unsupportedMessage="이 파일 형식은 미리보기를 지원하지 않습니다."
    />
  );
}
