"use client";

import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  SharedDocumentPreviewDialog,
  type PreviewMetaItem,
} from "@/components/app/documents/shared-document-preview-dialog";
import { eformsignApi } from "@/services/api";

interface ContractDocumentPreviewModalProps {
  "data-component": string;
  open: boolean;
  onClose: () => void;
  document: EformsignDocument | null;
  customerName?: string | null;
  canDownloadReceipt?: boolean;
  onReviewConfirm?: () => void;
  isReviewConfirming?: boolean;
}

function formatDate(timestamp: number): string {
  return formatDateForDisplay(timestamp);
}

function getPreviewUrl(documentId: string, attachment = false): string {
  const base = `/api/eformsign/documents/${documentId}/preview`;
  return attachment ? `${base}?attachment=true` : base;
}

export function ContractDocumentPreviewModal({
  "data-component": dataComponent,
  open,
  onClose,
  document,
  customerName,
  canDownloadReceipt = false,
  onReviewConfirm,
  isReviewConfirming = false,
}: ContractDocumentPreviewModalProps) {
  if (!document) {
    return null;
  }

  const metaItems: PreviewMetaItem[] = [
    {
      label: "고객",
      value: customerName ?? "-",
    },
    {
      label: "작성일",
      value: formatDate(document.created_date),
    },
    {
      label: "문서번호",
      value: document.document_number ?? "-",
    },
    {
      label: "파일 포맷",
      value: <span className="uppercase">PDF</span>,
    },
    {
      label: "문서 ID",
      value: <span className="break-all font-mono">{document.id}</span>,
      className: "min-w-[16rem] flex-1",
    },
  ];

  return (
    <SharedDocumentPreviewDialog
      data-component={dataComponent}
      open={open}
      onClose={onClose}
      title={document.document_name}
      badges={[
        <Badge variant="outline" key="template">
          {document.template?.name ?? "전자문서 계약서"}
        </Badge>,
      ]}
      srDescription="전자문서 메타데이터와 미리보기를 확인하고 확대, 인쇄, 다운로드를 할 수 있습니다."
      metaItems={metaItems}
      previewKind="pdf"
      previewUrl={getPreviewUrl(document.id)}
      downloadUrl={getPreviewUrl(document.id, true)}
      downloadFileName={`${document.document_name || document.id}.pdf`}
      receiptDownloadUrl={
        canDownloadReceipt ? eformsignApi.getDocumentReceiptDownloadUrl(document.id) : undefined
      }
      receiptDownloadFileName={`${document.document_name || document.id} 영수증.pdf`}
      overlayLabel="PDF 미리보기"
      previewKey={document.id}
      footerAction={onReviewConfirm ? (
        <Button
          variant="positive"
          size="sm"
          data-component={`${dataComponent}_footer_review-action_review-confirm`}
          onClick={onReviewConfirm}
          disabled={isReviewConfirming}
          className="min-w-[88px] hover:translate-y-0 hover:shadow-[0_4px_24px_hsla(214,50%,20%,0.06)]"
        >
          {isReviewConfirming ? (
            <Spinner className="mr-2 h-4 w-4" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          {isReviewConfirming ? "확인 중..." : "확인"}
        </Button>
      ) : undefined}
    />
  );
}
