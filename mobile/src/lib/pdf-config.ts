"use client";

import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export { pdfjs };
