import fs from "node:fs";

const source = fs.readFileSync(
  require.resolve("../../../../components/app/files/file-upload-screen"),
  "utf8",
);

describe("mobile file upload navigation lifecycle", () => {
  it("locks header back and cancel while uploading", () => {
    expect(source).toContain("const handleExit = () =>");
    expect(source).toContain("if (isUploading) return");
    // Header back, file input, and footer cancel are all locked while the upload owns the screen.
    expect(source.match(/disabled=\{isUploading\}/g)).toHaveLength(3);
  });
});
