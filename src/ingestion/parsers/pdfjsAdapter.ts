import type { PdfjsPage, SourceBlock } from "../types.js";
import { normalizePdfjsPageToBlocks } from "../normalize/sourceBlock.js";

export function runPdfjsAdapter(
  pages: PdfjsPage[],
  targetPages: number[],
  documentId: string
): SourceBlock[] {
  const targetSet = new Set(targetPages);
  const blocks: SourceBlock[] = [];

  for (const page of pages) {
    if (!targetSet.has(page.pageInfo.num)) continue;
    blocks.push(...normalizePdfjsPageToBlocks(page, documentId));
  }

  return blocks;
}
