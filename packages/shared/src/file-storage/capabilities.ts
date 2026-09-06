export interface DocumentUploadFormatGroup {
    label: string;
    formats: readonly string[];
}

export interface DocumentPreviewCapabilities {
    inlineFormats: readonly string[];
    convertedFormats: readonly string[];
    downloadOnlyFormats: readonly string[];
}

export interface DocumentUploadCapabilities {
    maxFileSizeBytes: number;
    multiple: boolean;
    acceptedExtensions: readonly string[];
    acceptedMimeTypes: readonly string[];
    formatGroups: readonly DocumentUploadFormatGroup[];
    preview: DocumentPreviewCapabilities;
    uploadVisibilityScope: "branch" | "all_branches";
}

export type DocumentVisibilityScope = DocumentUploadCapabilities["uploadVisibilityScope"];

export const DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES: DocumentUploadCapabilities = {
    maxFileSizeBytes: 25 * 1024 * 1024,
    multiple: false,
    acceptedExtensions: [
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".hwp",
        ".hwpx",
        ".heic",
        ".heif",
        ".zip",
        ".txt",
        ".csv",
    ],
    acceptedMimeTypes: [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/hwp",
        "application/haansofthwp",
        "application/vnd.hancom.hwp",
        "application/vnd.hancom.hwpx",
        "application/x-hwp",
        "application/x-hwpx",
        "image/heic",
        "image/heif",
        "application/zip",
        "application/x-zip-compressed",
        "text/plain",
        "text/csv",
        "application/octet-stream",
    ],
    formatGroups: [
        { label: "문서", formats: ["PDF", "HWP", "HWPX", "DOC", "DOCX", "TXT"] },
        { label: "표·발표", formats: ["XLS", "XLSX", "PPT", "PPTX", "CSV"] },
        { label: "이미지", formats: ["PNG", "JPG", "GIF", "WEBP", "HEIC", "HEIF"] },
        { label: "압축", formats: ["ZIP"] },
    ],
    preview: {
        inlineFormats: ["PDF", "PNG", "JPG", "JPEG", "GIF", "WEBP"],
        convertedFormats: ["HWP", "HWPX"],
        downloadOnlyFormats: ["DOC", "DOCX", "XLS", "XLSX", "PPT", "PPTX", "HEIC", "HEIF", "ZIP", "TXT", "CSV"],
    },
    uploadVisibilityScope: "branch",
};

export interface DocumentUploadCandidate {
    name: string;
    type: string;
    size: number;
}

function fileExtension(fileName: string): string {
    const cleanName = fileName.split(/[?#]/)[0] ?? "";
    const match = cleanName.match(/\.([a-z0-9]+)$/i);
    return match?.[1] ? `.${match[1].toLowerCase()}` : "";
}

export function formatFileSizeLimit(bytes: number): string {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export function documentUploadAcceptValue(
    capabilities: DocumentUploadCapabilities = DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
): string {
    return capabilities.acceptedExtensions.join(",");
}

export function validateDocumentUploadCandidate(
    file: DocumentUploadCandidate,
    capabilities: DocumentUploadCapabilities = DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
): string | null {
    if (file.size <= 0) return "빈 파일은 업로드할 수 없습니다.";
    if (file.size > capabilities.maxFileSizeBytes) {
        return `파일 크기가 ${formatFileSizeLimit(capabilities.maxFileSizeBytes)}를 초과합니다.`;
    }

    const extension = fileExtension(file.name);
    const acceptedExtensions = new Set(capabilities.acceptedExtensions.map((value) => value.toLowerCase()));
    if (!acceptedExtensions.has(extension)) {
        return "지원하지 않는 파일 형식입니다.";
    }

    const mimeType = file.type.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
    const acceptedMimeTypes = new Set(capabilities.acceptedMimeTypes.map((value) => value.toLowerCase()));
    if (!acceptedMimeTypes.has(mimeType)) {
        return "지원하지 않는 파일 형식입니다.";
    }

    return null;
}
