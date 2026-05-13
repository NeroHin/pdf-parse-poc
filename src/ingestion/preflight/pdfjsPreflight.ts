import { createRequire } from "node:module";
import type { PdfjsExtractResult, PdfjsPage, PreflightPageInfo } from "../types.js";
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
  pageInfos: PreflightPageInfo[];
};

// CMap data for CJK font encoding — resolves ToUnicode issues for CID fonts
const CMAP_URL = new URL(
  "../../../node_modules/pdfjs-dist/cmaps/",
  import.meta.url
).href;

export async function pdfjsPreflight(filePath: string): Promise<PreflightResult> {
  const PDFExtract = require("pdf.js-extract").PDFExtract as PDFExtractClass;
  const extractor = new PDFExtract();

  const result = await extractor.extract(filePath, {
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  });

  const rawPages = result.pages;
  const pages = rawPages.map(computePageStats);
  const pageInfos: PreflightPageInfo[] = rawPages.map((p) => ({
    num: p.pageInfo.num,
    width: p.pageInfo.width,
    height: p.pageInfo.height,
  }));

  return {
    pageCount: rawPages.length,
    pages,
    rawPages,
    pageInfos,
  };
}
