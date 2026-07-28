"use client";

import { useState } from "react";
import {
  X,
  Download,
  Printer,
  ZoomIn,
  ZoomOut,
  MoreVertical,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

interface DocumentPreviewModalProps {
  /** Caller-context canonical base for this surface. */
  "data-component": string;
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  categories: DocumentCategory[];
  onEdit?: (doc: Document) => void;
  onDelete?: (doc: Document) => void;
}

function getCategoryLabel(
  categoryId: string,
  categories: DocumentCategory[]
): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.label || categoryId;
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
  const [zoom, setZoom] = useState(1);

  if (!doc) return null;

  // Helper to get file extension from mimetype
  const getExtensionFromMimetype = (mimetype: string): string => {
    const mimeToExt: Record<string, string> = {
      "application/pdf": ".pdf",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
      "application/vnd.ms-excel": ".xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        ".xlsx",
    };
    return mimeToExt[mimetype] || "";
  };

  const handlePrint = () => {
    // Create a hidden iframe for printing
    const iframe = window.document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = getDownloadUrl(doc.id);

    // When loaded, print
    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("Print failed", e);
      }
      // Cleanup after a delay to ensure print dialog has opened
      setTimeout(() => {
        window.document.body.removeChild(iframe);
      }, 2000);
    };

    window.document.body.appendChild(iframe);
  };

  const handleDownload = () => {
    let filename = doc.name;
    // Add extension if missing
    if (!filename.includes(".")) {
      filename += getExtensionFromMimetype(doc.mimeType);
    }
    const link = window.document.createElement("a");
    link.href = getDownloadUrl(doc.id, true);
    link.download = filename;
    link.target = "_blank";
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));

  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <DialogContent
        data-component={dataComponent}
        className="max-w-4xl h-[90vh] flex flex-col p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader data-component={`${dataComponent}_header`} className="px-6 py-4 border-b border-border flex-row justify-between items-start">
          <div>
            <DialogTitle className="text-lg font-semibold">
              {doc.name}
            </DialogTitle>
            <Badge variant="outline" className="mt-1">
              {getCategoryLabel(doc.categoryId, categories)}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Metadata Section */}
          <div data-component={`${dataComponent}_meta`} className="px-6 py-4 bg-muted/30 border-b border-border">
            <div className="flex gap-6 flex-wrap mb-2">
              <div>
                <p className="text-xs text-muted-foreground">파일 크기</p>
                <p className="text-sm mt-0.5">{formatFileSize(doc.fileSize)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">등록일</p>
                <p className="text-sm mt-0.5">{formatDate(doc.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">파일 포맷</p>
                <p className="text-sm mt-0.5 uppercase">
                  {doc.mimeType
                    .split("/")[1]
                    ?.replace("jpeg", "jpg")
                    .replace("plain", "txt") || "Unknown"}
                </p>
              </div>
              {(onEdit || onDelete) && (
                <div className="ml-auto self-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onEdit && (
                        <DropdownMenuItem onClick={() => onEdit(doc)}>
                          수정
                        </DropdownMenuItem>
                      )}
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
                </div>
              )}
            </div>
            {doc.tags && doc.tags.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">태그</p>
                <div className="flex gap-1 flex-wrap mt-1">
                  {doc.tags.map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {doc.description && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">설명</p>
                <p className="text-sm mt-0.5">{doc.description}</p>
              </div>
            )}
          </div>

          {/* Preview Section */}
          <div className="flex-1 flex flex-col bg-muted/50 overflow-hidden relative min-h-[400px]">
            {isPdf && (
              <iframe
                src={`${getDownloadUrl(doc.id)}#toolbar=0`}
                className="w-full h-full border-none"
                title={doc.name}
              />
            )}

            {isImage && (
              <div className="w-full h-full overflow-auto flex justify-center items-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated binary downloads are served through an app API route; next/image optimization is not suitable here. */}
                <img
                  src={getDownloadUrl(doc.id)}
                  alt={doc.name}
                  className="max-w-full max-h-full object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                  }}
                />

                {/* Zoom controls for image */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 rounded-full flex items-center gap-1 p-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleZoomOut}
                    className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-white text-sm px-2">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleZoomIn}
                    className="h-8 w-8 text-white hover:text-white hover:bg-white/20"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {!isPdf && !isImage && (
              <div className="flex justify-center items-center h-full">
                <p className="text-muted-foreground">
                  Preview not available for this file type
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter data-component={`${dataComponent}_footer`} className="px-6 py-4 border-t border-border justify-end">
          <Button variant="ghost" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            인쇄
          </Button>
          <Button onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            다운로드
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
