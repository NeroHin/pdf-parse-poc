import type {
  SourceBlock,
  PageDetection,
  QualityReport,
  UploadedDocument,
} from "../types.js";

export type ReviewPayload = {
  document: UploadedDocument;
  sourceBlocks: SourceBlock[];
  detections: PageDetection[];
  qualityReport: QualityReport;
  warnings: string[];
};

export function buildReviewPayload(
  document: UploadedDocument,
  blocks: SourceBlock[],
  detections: PageDetection[],
  qualityReport: QualityReport,
  routingWarnings: string[] = []
): ReviewPayload {
  const allWarnings = [
    ...routingWarnings,
    ...qualityReport.warnings,
    ...blocks.flatMap((b) => b.warnings),
  ];

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(allWarnings)];

  return {
    document,
    sourceBlocks: blocks,
    detections,
    qualityReport,
    warnings: uniqueWarnings,
  };
}
