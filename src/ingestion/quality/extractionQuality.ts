import type { SourceBlock, PageDetection, QualityReport } from "../types.js";

const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function evaluateExtractionQuality(
  blocks: SourceBlock[],
  detections: PageDetection[]
): QualityReport {
  const blocksByPage = new Map<number, SourceBlock[]>();
  for (const block of blocks) {
    const existing = blocksByPage.get(block.page) ?? [];
    existing.push(block);
    blocksByPage.set(block.page, existing);
  }

  const lowConfidencePages: number[] = [];
  const emptyPages: number[] = [];
  const warnings: string[] = [];

  for (const detection of detections) {
    const pageBlocks = blocksByPage.get(detection.page) ?? [];

    if (pageBlocks.length === 0 && detection.hasExtractableText) {
      emptyPages.push(detection.page);
      warnings.push(
        `第 ${detection.page} 頁偵測到可解析文字但 blocks 為空，可能需要 fallback 解析。`
      );
    }

    const avgConfidence =
      pageBlocks.length > 0
        ? pageBlocks.reduce((sum, b) => sum + b.confidence, 0) / pageBlocks.length
        : 1;

    if (pageBlocks.length > 0 && avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidencePages.push(detection.page);
      warnings.push(
        `第 ${detection.page} 頁平均 confidence (${avgConfidence.toFixed(2)}) 低於閾值，建議 fallback。`
      );
    }
  }

  const requiresFallback = emptyPages.length > 0 || lowConfidencePages.length > 0;

  return { requiresFallback, lowConfidencePages, emptyPages, warnings };
}
