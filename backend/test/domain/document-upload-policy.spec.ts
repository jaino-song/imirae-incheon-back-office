import { validateDocumentUploadCandidate } from "domain/services/document-upload-policy";

describe("document upload policy", () => {
    it("accepts opaque HWP and HWPX uploads when their signatures match", () => {
        expect(validateDocumentUploadCandidate({
            fileName: "계약서.hwp",
            mimeType: "application/octet-stream",
            size: 8,
            bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        })).toBeNull();

        expect(validateDocumentUploadCandidate({
            fileName: "계약서.hwpx",
            mimeType: "application/octet-stream",
            size: 4,
            bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        })).toBeNull();
    });

    it("rejects a MIME and extension mismatch", () => {
        expect(validateDocumentUploadCandidate({
            fileName: "photo.png",
            mimeType: "application/pdf",
            size: 8,
            bytes: Buffer.from("%PDF-1.4"),
        })).toBe("file extension does not match its MIME type");
    });

    it("keeps text and CSV uploads available as download-only content", () => {
        expect(validateDocumentUploadCandidate({
            fileName: "명단.csv",
            mimeType: "text/csv",
            size: 8,
            bytes: Buffer.from("name,age"),
        })).toBeNull();
    });
});
