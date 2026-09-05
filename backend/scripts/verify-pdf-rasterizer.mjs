// Renders a 2-page synthetic PDF through the compiled rasterizer and checks the PNG.
// Run after `pnpm --filter ./backend build`: `pnpm --filter ./backend run verify:pdf-rasterizer`
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PdfPageRasterizerService, PdfPageOutOfRangeError } = require(
    "../dist/infrastructure/pdf/pdf-page-rasterizer.service.js",
);
const { createCanvas, loadImage } = require("@napi-rs/canvas");

// Minimal 2-page PDF: page 1 blue, page 2 red. pdf.js tolerates the missing xref table.
const MINI_PDF = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 6 0 R >> endobj
5 0 obj << /Length 25 >> stream
0 0 1 rg 0 0 200 100 re f
endstream
endobj
6 0 obj << /Length 25 >> stream
1 0 0 rg 0 0 200 100 re f
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF
`);

// pdfjs-dist ships its cmaps and standard fonts as data files next to the
// installed package; the service resolves them relative to that package root
// (see cMapUrl/standardFontDataUrl there). If a future pdfjs-dist upgrade
// moves or renames these directories, Korean (and other CID-font) glyphs
// silently stop rendering with no error anywhere else in this pipeline — so
// pin their existence here, resolved the same way the service resolves them.
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
assert.ok(
    fs.existsSync(path.join(pdfjsRoot, "cmaps")),
    `pdfjs-dist cmaps directory must exist at ${path.join(pdfjsRoot, "cmaps")}`,
);
assert.ok(
    fs.existsSync(path.join(pdfjsRoot, "standard_fonts")),
    `pdfjs-dist standard_fonts directory must exist at ${path.join(pdfjsRoot, "standard_fonts")}`,
);

/** Decode a PNG buffer and read back its centre pixel as [r, g, b, a]. */
async function centrePixel(png) {
    const img = await loadImage(png);
    const ctx = createCanvas(img.width, img.height).getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data];
}

const service = new PdfPageRasterizerService();

// Page 2 (red) is the primary subject: signature, dimensions, and — the part
// a blank white or fully transparent canvas would also satisfy — that the
// decoded centre pixel is actually opaque red, not blank.
const page2Png = await service.renderPageToPng(MINI_PDF, 2, { width: 400 });
assert.equal(page2Png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
assert.equal(page2Png.readUInt32BE(16), 400, "IHDR width");
assert.equal(page2Png.readUInt32BE(20), 200, "IHDR height");
assert.deepEqual(await centrePixel(page2Png), [255, 0, 0, 255], "page 2 renders red at centre");

// Page 1 (blue) pins page selection: a rasterizer that ignored pageNumber and
// always rendered the same page would pass every assertion above.
const page1Png = await service.renderPageToPng(MINI_PDF, 1, { width: 400 });
assert.deepEqual(await centrePixel(page1Png), [0, 0, 255, 255], "page 1 renders blue at centre");

await assert.rejects(() => service.renderPageToPng(MINI_PDF, 3), PdfPageOutOfRangeError);
await assert.rejects(() => service.renderPageToPng(MINI_PDF, 2, { width: 0 }), RangeError);

console.log(`pdf rasterizer ok: ${page2Png.length} bytes`);
