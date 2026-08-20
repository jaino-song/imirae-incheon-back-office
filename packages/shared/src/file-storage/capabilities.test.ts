import {
    DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
    validateDocumentUploadCandidate,
} from "./capabilities";

describe("document upload capabilities", () => {
    it("models every current single-upload storage format", () => {
        expect(DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES).toEqual(expect.objectContaining({
            maxFileSizeBytes: 25 * 1024 * 1024,
            multiple: false,
            acceptedExtensions: expect.arrayContaining([
                ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
                ".hwp", ".hwpx", ".heic", ".heif", ".zip", ".txt", ".csv",
            ]),
        }));
    });

    it("accepts an HWP file even when the browser reports an opaque MIME type", () => {
        expect(validateDocumentUploadCandidate({
            name: "계약서.hwp",
            type: "application/octet-stream",
            size: 1024,
        })).toBeNull();
    });

    it("rejects unsupported extensions and oversized files before upload", () => {
        expect(validateDocumentUploadCandidate({
            name: "payload.html",
            type: "application/octet-stream",
            size: 1024,
        })).toContain("지원하지 않는 파일 형식");
        expect(validateDocumentUploadCandidate({
            name: "large.pdf",
            type: "application/pdf",
            size: 25 * 1024 * 1024 + 1,
        })).toContain("25MB");
    });
});
