"use client";

import React, { useState, useEffect } from "react";
import { FileText, ImageIcon, File } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Document } from "@/hooks/use-documents";
import { DocumentCategory } from "@/hooks/use-document-categories";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

interface DocumentListProps {
  documents: Document[];
  categories: DocumentCategory[];
  isLoading?: boolean;
  onPreview: (doc: Document) => void;
  onEdit: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export const formatDate = (dateString: string): string => {
  return formatDateForDisplay(dateString);
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.includes("pdf")) {
    return <FileText className="h-5 w-5 text-destructive" />;
  }
  if (mimeType.includes("image")) {
    return <ImageIcon className="h-5 w-5 text-info" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
};

function getCategoryLabel(categoryId: string, categories: DocumentCategory[]): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.label || categoryId;
}

// Custom hook to detect mobile breakpoint
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

export default function DocumentList({
  documents,
  categories,
  isLoading = false,
  onPreview,
}: DocumentListProps) {
  const isMobile = useIsMobile();

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-border">
              <th className="text-center font-medium text-muted-foreground text-sm py-3">
                문서명
              </th>
              <th className="text-center font-medium text-muted-foreground text-sm py-3 w-[110px] whitespace-nowrap">
                등록일
              </th>
              {!isMobile && (
                <th className="text-center font-medium text-muted-foreground text-sm py-3 w-[120px]">
                  카테고리
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i} className="border-b border-border">
                <td className="text-center py-3">
                  <Skeleton className="h-4 w-4/5 mx-auto" />
                </td>
                <td className="text-center py-3">
                  <Skeleton className="h-4 w-4/5 mx-auto" />
                </td>
                {!isMobile && (
                  <td className="text-center py-3">
                    <Skeleton className="h-4 w-3/5 mx-auto" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-border rounded-lg bg-muted/30">
        <File className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h6 className="text-lg font-semibold text-foreground/60 mb-1">
          등록된 문서가 없습니다
        </h6>
        <p className="text-sm text-muted-foreground">
          새로운 문서를 업로드해보세요
        </p>
      </div>
    );
  }

  return (
    <div data-component="desktop_contracts_document-list" className="overflow-x-auto">
      <table data-component="desktop_contracts_document-list_table" className="w-full table-fixed">
        <thead data-component="desktop_contracts_document-list_table_header">
          <tr className="border-b border-border">
            <th className="text-center font-medium text-muted-foreground text-sm py-3">
              문서명
            </th>
            <th className="text-center font-medium text-muted-foreground text-sm py-3 w-[110px] whitespace-nowrap">
              등록일
            </th>
            {!isMobile && (
              <th className="text-center font-medium text-muted-foreground text-sm py-3 w-[120px]">
                카테고리
              </th>
            )}
          </tr>
        </thead>
        <tbody data-component="desktop_contracts_document-list_table_body">
          {documents.map((doc) => (
            <tr
              key={doc.id}
              data-component="desktop_contracts_document-list_table_body_row"
              className="border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onPreview(doc)}
            >
              <td className="text-center text-sm text-foreground py-3 pl-3 pr-1">
                <div className="flex items-center gap-2 justify-start">
                  {getFileIcon(doc.mimeType)}
                  <span className="font-medium">{doc.name}</span>
                </div>
              </td>
              <td className="text-center text-sm text-foreground py-3 px-1">
                {formatDate(doc.createdAt)}
              </td>
              {!isMobile && (
                <td className="text-center py-3 px-1">
                  <Badge variant="secondary">
                    {getCategoryLabel(doc.categoryId, categories)}
                  </Badge>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
