import { Injectable } from "@nestjs/common";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type * as PdfJs from "pdfjs-dist";

export class PdfPageOutOfRangeError extends Error {
    constructor(
        readonly pageNumber: number,
        readonly pageCount: number,
        message: string = `PDF page ${pageNumber} is out of range (1..${pageCount})`,
    ) {
        super(message);
        this.name = "PdfPageOutOfRangeError";
    }
}

export const DEFAULT_RASTER_WIDTH = 1240;

// pdfjs-dist 4.x is ESM-only and the backend compiles to CommonJS. A dynamic
// import written directly would be rewritten to require() by tsc, so the import
// goes through a Function shell. The specifier is a constant — never interpolate.
const PDFJS_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";
const importEsm = new Function("specifier", "return import(specifier)") as (
    specifier: string,
) => Promise<unknown>;

type PdfJsModule = typeof PdfJs;

@Injectable()
export class PdfPageRasterizerService {
    private pdfjsPromise: Promise<PdfJsModule> | null = null;

    private loadPdfJs(): Promise<PdfJsModule> {
        if (!this.pdfjsPromise) {
            // Do not let a transient failure (e.g. a cold-start race) poison every
            // future call for the life of the process: on rejection, clear the cache
            // so the next call retries the import instead of replaying the failure.
            this.pdfjsPromise = (importEsm(PDFJS_SPECIFIER) as Promise<PdfJsModule>).catch(
                (error: unknown) => {
                    this.pdfjsPromise = null;
                    throw error;
                },
            );
        }
        return this.pdfjsPromise;
    }

    /** Render one page (1-based) to a white-background PNG scaled to `width` px. */
    async renderPageToPng(
        pdf: Buffer,
        pageNumber: number,
        options: { width?: number } = {},
    ): Promise<Buffer> {
        const targetWidth = options.width ?? DEFAULT_RASTER_WIDTH;
        if (!Number.isFinite(targetWidth) || targetWidth < 1) {
            throw new RangeError(`PDF raster width must be a positive finite number, got ${targetWidth}`);
        }
        const pdfjs = await this.loadPdfJs();
        const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
        const doc = await pdfjs.getDocument({
            data: Uint8Array.from(pdf),
            // Node has no FontFace API: embedded CID glyphs must be drawn as paths.
            disableFontFace: true,
            useSystemFonts: false,
            cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps") + path.sep).href,
            cMapPacked: true,
            standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts") + path.sep).href,
        }).promise;

        try {
            if (!Number.isInteger(pageNumber)) {
                throw new PdfPageOutOfRangeError(
                    pageNumber,
                    doc.numPages,
                    `PDF page number must be a positive integer, got ${pageNumber}`,
                );
            }
            if (pageNumber < 1 || pageNumber > doc.numPages) {
                throw new PdfPageOutOfRangeError(pageNumber, doc.numPages);
            }
            const page = await doc.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: targetWidth / base.width });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({
                canvasContext: context as unknown as CanvasRenderingContext2D,
                viewport,
            }).promise;
            return canvas.toBuffer("image/png");
        } finally {
            await doc.destroy();
        }
    }
}
