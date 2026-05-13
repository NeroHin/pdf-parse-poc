import type { PageTextStats } from "../types.js";
import type { OdlJsonItem } from "../types.js";
import { pagesWithStructuralHoles } from "./structuralHoles.js";

/** Aligns with classifyPage scanned heuristic */
export const SCAN_OR_LOW_TEXT_CHAR_THRESHOLD = 20;

export type OcrRepairTrigger = "scan_or_low_text" | "structural_hole" | "table_layout";

export function pageNeedsScanOrLowText(stats: PageTextStats): boolean {
  return (
    stats.charCount < SCAN_OR_LOW_TEXT_CHAR_THRESHOLD ||
    !stats.hasExtractableText
  );
}

export function computeOcrRepairPages(
  pageStatsByNum: Map<number, PageTextStats>,
  mergedOdlItems: OdlJsonItem[],
  opts: {
    enabled: boolean;
    repairOnScanOrLowText: boolean;
    repairOnStructuralHole: boolean;
    repairOnTableLayout?: boolean;
  }
): Map<number, OcrRepairTrigger[]> {
  const out = new Map<number, OcrRepairTrigger[]>();
  if (!opts.enabled) return out;

  const holePages = pagesWithStructuralHoles(mergedOdlItems);
  const tablePages = new Set(
    mergedOdlItems
      .filter((item) => item.type.toLowerCase() === "table" && Array.isArray(item.rows) && item.rows.length > 0)
      .map((item) => item["page number"])
  );

  for (const [pageNum, stats] of pageStatsByNum) {
    const reasons: OcrRepairTrigger[] = [];
    if (opts.repairOnScanOrLowText && pageNeedsScanOrLowText(stats)) {
      reasons.push("scan_or_low_text");
    }
    if (opts.repairOnStructuralHole && holePages.has(pageNum)) {
      reasons.push("structural_hole");
    }
    if (opts.repairOnTableLayout && tablePages.has(pageNum)) {
      reasons.push("table_layout");
    }
    if (reasons.length > 0) {
      out.set(pageNum, reasons);
    }
  }

  return out;
}
