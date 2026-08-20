import { getPreviewKind } from "../document-preview-utils";

describe("document preview safety", () => {
  it("previews only server-inline raster images", () => {
    expect(getPreviewKind({
      name: "photo.webp",
      mimeType: "image/webp",
      storagePath: "photo.webp",
      storageUrl: null,
    })).toBe("image");
  });

  it.each(["image/heic", "image/svg+xml"])(
    "keeps %s in the download-only fallback",
    (mimeType) => {
      expect(getPreviewKind({
        name: "asset.bin",
        mimeType,
        storagePath: "asset.bin",
        storageUrl: null,
      })).toBe("unsupported");
    },
  );
});
