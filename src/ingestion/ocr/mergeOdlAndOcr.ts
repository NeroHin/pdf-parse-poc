import type { SourceBlock } from "../types.js";
import { collapseWs, hasSubstantialOverlap } from "../normalize/textOverlap.js";

/** Append OCR repair blocks that are not redundant with existing ODL text on the same page. */
export function mergeOdlBlocksWithOcrRepair(
  odlBlocks: SourceBlock[],
  repairBlocks: SourceBlock[]
): SourceBlock[] {
  const out = [...odlBlocks];
  for (const rb of repairBlocks) {
    const existingTexts = out
      .filter((b) => b.page === rb.page)
      .map((b) => collapseWs(b.text));
    if (hasSubstantialOverlap(collapseWs(rb.text), existingTexts)) continue;
    out.push(rb);
  }
  return out;
}
