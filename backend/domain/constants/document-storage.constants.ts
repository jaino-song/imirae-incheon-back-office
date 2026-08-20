export const DOCUMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const DOCUMENT_INLINE_SAFE_MIME_TYPES = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
] as const;

export const DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES = [
    ...DOCUMENT_INLINE_SAFE_MIME_TYPES,
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
] as const;

export const DOCUMENT_UPLOAD_ACCEPTED_EXTENSIONS = [
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
] as const;

export const DOCUMENT_UPLOAD_CAPABILITIES = {
    maxFileSizeBytes: DOCUMENT_MAX_FILE_SIZE_BYTES,
    multiple: false,
    acceptedExtensions: DOCUMENT_UPLOAD_ACCEPTED_EXTENSIONS,
    acceptedMimeTypes: DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES,
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
} as const;

export const DOCUMENT_INLINE_SAFE_MIME_TYPE_SET: ReadonlySet<string> = new Set(
    DOCUMENT_INLINE_SAFE_MIME_TYPES,
);

export const DOCUMENT_UPLOAD_ALLOWED_MIME_TYPE_SET: ReadonlySet<string> = new Set(
    DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES,
);

export const DOCUMENT_UPLOAD_ACCEPTED_EXTENSION_SET: ReadonlySet<string> = new Set(
    DOCUMENT_UPLOAD_ACCEPTED_EXTENSIONS,
);
