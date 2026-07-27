import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, "..");
const reactPdfEntry = require.resolve("react-pdf");
const workerSource = require.resolve(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  { paths: [reactPdfEntry] }
);
const publicDirectory = path.join(mobileRoot, "public");
const workerTarget = path.join(publicDirectory, "pdf.worker.min.mjs");

await mkdir(publicDirectory, { recursive: true });
await copyFile(workerSource, workerTarget);

console.log(`Copied react-pdf worker to ${workerTarget}`);
