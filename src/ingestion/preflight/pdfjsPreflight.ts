import { createRequire } from "node:module";
import type { PdfjsExtractResult, PdfjsPage } from "../types.js";
import { computePageStats } from "./pageStats.js";
import type { PageTextStats } from "../types.js";

const require = createRequire(import.meta.url);

type PDFExtractClass = {
  new (): {
    extract(
      filePath: string,
      options?: Record<string, unknown>
    ): Promise<PdfjsExtractResult>;
  };
};

export type PreflightResult = {
  pageCount: number;
  pages: PageTextStats[];
  rawPages: PdfjsPage[];
};

export async function pdfjsPreflight(filePath: string): Promise<PreflightResult> {
  const PDFExtract = require("pdf.js-extract").PDFExtract as PDFExtractClass;
  const extractor = new PDFExtract();

  const result = await extractor.extract(filePath, {});

  const rawPages = result.pages;
  const pages = rawPages.map(computePageStats);

  return {
    pageCount: rawPages.length,
    pages,
    rawPages,
  };
}
