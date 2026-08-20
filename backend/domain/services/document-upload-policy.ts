import {
    DOCUMENT_MAX_FILE_SIZE_BYTES,
    DOCUMENT_UPLOAD_ACCEPTED_EXTENSION_SET,
    DOCUMENT_UPLOAD_ALLOWED_MIME_TYPE_SET,
} from "domain/constants/document-storage.constants";

const MIME_EXTENSIONS: Readonly<Record<string, ReadonlySet<string>>> = {
    "application/pdf": new Set([".pdf"]),
    "image/png": new Set([".png"]),
    "image/jpeg": new Set([".jpg", ".jpeg"]),
    "image/jpg": new Set([".jpg", ".jpeg"]),
    "image/gif": new Set([".gif"]),
    "image/webp": new Set([".webp"]),
    "application/msword": new Set([".doc"]),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set([".docx"]),
    "application/vnd.ms-excel": new Set([".xls", ".csv"]),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": new Set([".xlsx"]),
    "application/vnd.ms-powerpoint": new Set([".ppt"]),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": new Set([".pptx"]),
    "application/hwp": new Set([".hwp"]),
    "application/haansofthwp": new Set([".hwp"]),
    "application/vnd.hancom.hwp": new Set([".hwp"]),
    "application/vnd.hancom.hwpx": new Set([".hwpx"]),
    "application/x-hwp": new Set([".hwp"]),
    "application/x-hwpx": new Set([".hwpx"]),
    "image/heic": new Set([".heic"]),
    "image/heif": new Set([".heif"]),
    "application/zip": new Set([".zip"]),
    "application/x-zip-compressed": new Set([".zip"]),
    "text/plain": new Set([".txt", ".csv"]),
    "text/csv": new Set([".csv"]),
};

const OLE_EXTENSIONS: ReadonlySet<string> = new Set([".doc", ".xls", ".ppt", ".hwp"]);
const ZIP_EXTENSIONS: ReadonlySet<string> = new Set([".docx", ".xlsx", ".pptx", ".hwpx", ".zip"]);

export interface DocumentUploadCandidate {
    fileName: string;
    mimeType?: string | null;
    size: number;
    bytes?: Buffer;
}

export function normalizeDocumentMimeType(mimeType: string | undefined | null): string {
    return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

export function getDocumentFileExtension(fileName: string): string {
    const cleanName = fileName.split(/[?#]/)[0] ?? "";
    const match = cleanName.match(/\.([a-z0-9]+)$/i);
    return match?.[1] ? `.${match[1].toLowerCase()}` : "";
}

function startsWithBytes(bytes: Buffer, signature: readonly number[]): boolean {
    return signature.every((value, index) => bytes[index] === value);
}

function hasZipSignature(bytes: Buffer): boolean {
    return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])
        || startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06])
        || startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function hasIsoBaseMediaBrand(bytes: Buffer): boolean {
    if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    return new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]).has(brand);
}

function contentMatchesExtension(extension: string, bytes: Buffer): boolean {
    if (extension === ".pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    if (extension === ".png") return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (extension === ".jpg" || extension === ".jpeg") return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    if (extension === ".gif") {
        const header = bytes.subarray(0, 6).toString("ascii");
        return header === "GIF87a" || header === "GIF89a";
    }
    if (extension === ".webp") {
        return bytes.subarray(0, 4).toString("ascii") === "RIFF"
            && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    }
    if (OLE_EXTENSIONS.has(extension)) {
        return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    }
    if (ZIP_EXTENSIONS.has(extension)) return hasZipSignature(bytes);
    if (extension === ".heic" || extension === ".heif") return hasIsoBaseMediaBrand(bytes);
    if (extension === ".txt" || extension === ".csv") return !bytes.subarray(0, 4096).includes(0);
    return false;
}

export function validateDocumentUploadCandidate(candidate: DocumentUploadCandidate): string | null {
    if (candidate.size <= 0) return "file must not be empty";
    if (candidate.size > DOCUMENT_MAX_FILE_SIZE_BYTES) {
        return `file size exceeds maximum limit of ${DOCUMENT_MAX_FILE_SIZE_BYTES / (1024 * 1024)}mb`;
    }

    const mimeType = normalizeDocumentMimeType(candidate.mimeType);
    if (!DOCUMENT_UPLOAD_ALLOWED_MIME_TYPE_SET.has(mimeType)) {
        return `unsupported file type: ${mimeType}`;
    }

    const extension = getDocumentFileExtension(candidate.fileName);
    if (!DOCUMENT_UPLOAD_ACCEPTED_EXTENSION_SET.has(extension)) {
        return `unsupported file extension: ${extension || "none"}`;
    }

    if (mimeType !== "application/octet-stream" && !MIME_EXTENSIONS[mimeType]?.has(extension)) {
        return "file extension does not match its MIME type";
    }

    if (candidate.bytes && !contentMatchesExtension(extension, candidate.bytes)) {
        return "file content does not match its format";
    }

    return null;
}
