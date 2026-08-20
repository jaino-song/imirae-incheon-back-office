import type { Document } from "@/hooks/use-documents";

import type { PreviewKind } from "./shared-document-preview-dialog";

type PreviewableDocument = Pick<Document, "mimeType" | "name" | "storagePath" | "storageUrl">;

const HANGUL_DOCUMENT_EXTENSIONS = new Set(["hwp", "hwpx"]);

const HANGUL_DOCUMENT_MIME_TYPES = new Set([
  "application/hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
  "application/vnd.hancom.hwpx",
  "application/x-hwp",
  "application/x-hwpx",
]);

const INLINE_PREVIEW_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/hwp": ".hwp",
  "application/haansofthwp": ".hwp",
  "application/vnd.hancom.hwp": ".hwp",
  "application/vnd.hancom.hwpx": ".hwpx",
  "application/x-hwp": ".hwp",
  "application/x-hwpx": ".hwpx",
};

function getExtensionFromPath(value?: string | null): string {
  if (!value) {
    return "";
  }

  const cleanValue = value.split(/[?#]/)[0] ?? "";
  const extensionMatch = cleanValue.match(/\.([a-z0-9]+)$/i);
  return extensionMatch?.[1]?.toLowerCase() ?? "";
}

export function getDocumentExtension(doc: PreviewableDocument): string {
  return getExtensionFromPath(doc.name) || getExtensionFromPath(doc.storagePath) || getExtensionFromPath(doc.storageUrl);
}

export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] || "";
}

export function isHangulDocument(doc: PreviewableDocument): boolean {
  return HANGUL_DOCUMENT_MIME_TYPES.has(doc.mimeType) || HANGUL_DOCUMENT_EXTENSIONS.has(getDocumentExtension(doc));
}

export function getPreviewKind(doc: PreviewableDocument): PreviewKind {
  if (doc.mimeType === "application/pdf") {
    return "pdf";
  }

  if (INLINE_PREVIEW_IMAGE_MIME_TYPES.has(doc.mimeType.toLowerCase())) {
    return "image";
  }

  if (isHangulDocument(doc)) {
    return "hwp";
  }

  return "unsupported";
}

export function getDownloadFileName(doc: PreviewableDocument): string {
  if (doc.name.includes(".")) {
    return doc.name;
  }

  const extension = getExtensionFromMimeType(doc.mimeType) || `.${getDocumentExtension(doc)}`;
  return extension === "." ? doc.name : `${doc.name}${extension}`;
}

export function getFileFormatLabel(doc: PreviewableDocument): string {
  const extension = getDocumentExtension(doc);
  if (extension) {
    return extension;
  }

  return doc.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace("plain", "txt") || "Unknown";
}
