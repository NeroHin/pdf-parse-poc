import type { PageTextStats, PageDetection, PdfParseHint } from "../types.js";

const SCANNED_CHAR_THRESHOLD = 20;
const TABLE_SHORT_ITEM_MAX_CHARS = 10;
const TABLE_SHORT_ITEM_MIN_COUNT = 15;
const REPEATED_COORD_THRESHOLD = 4;
const REPEATED_COORD_DISTINCT = 6;
const GARBLED_WHITESPACE_RATIO_THRESHOLD = 0.7;
// CID font / ToUnicode missing: ≥30% replacement chars → likely garbled
const CID_REPLACEMENT_RATIO_THRESHOLD = 0.3;

function hasBadUnicodeSignal(stats: PageTextStats): boolean {
  return (
    stats.whitespaceRatio > GARBLED_WHITESPACE_RATIO_THRESHOLD &&
    stats.charCount > 5
  );
}

function hasRepeatedXColumns(stats: PageTextStats): boolean {
  const xFreq: Record<number, number> = {};
  for (const x of stats.xCoords) {
    const rounded = Math.round(x / 5) * 5; // round to nearest 5 pts
    xFreq[rounded] = (xFreq[rounded] ?? 0) + 1;
  }
  const repeatedCount = Object.values(xFreq).filter(
    (c) => c >= REPEATED_COORD_THRESHOLD
  ).length;
  return repeatedCount >= REPEATED_COORD_DISTINCT;
}

function hasManyShortAlignedItems(stats: PageTextStats): boolean {
  if (stats.textItemCount === 0) return false;
  // CJK documents naturally render short items — skip table check for CJK-heavy pages
  if (stats.cjkCharRatio > 0.3) return false;

  const avgCharsPerItem = stats.charCount / stats.textItemCount;
  return (
    stats.textItemCount >= TABLE_SHORT_ITEM_MIN_COUNT &&
    avgCharsPerItem <= TABLE_SHORT_ITEM_MAX_CHARS &&
    hasRepeatedXColumns(stats)
  );
}

function buildRecommendation(
  layoutClass: PageDetection["layoutClass"],
): {
  parserRecommendation: PageDetection["parserRecommendation"];
  reasons: string[];
} {
  switch (layoutClass) {
    case "suspicious":
      return {
        parserRecommendation: "opendataloader_safety",
        reasons: ["detected hidden/off-page text or garbled text"],
      };
    case "scanned_image":
      return {
        parserRecommendation: "opendataloader_hybrid",
        reasons: ["low extractable text count"],
      };
    case "complex_layout":
      return {
        parserRecommendation: "opendataloader_default",
        reasons: ["table-heavy layout detected"],
      };
    default:
      return {
        parserRecommendation: "pdfjs",
        reasons: ["clean native text layer detected"],
      };
  }
}

export function classifyPage(
  stats: PageTextStats,
  _hint: PdfParseHint
): PageDetection {
  const suspectedScanned =
    stats.charCount < SCANNED_CHAR_THRESHOLD || !stats.hasExtractableText;

  const suspectedGarbledText = hasBadUnicodeSignal(stats);

  // CID font without ToUnicode: high ratio of U+FFFD replacement characters
  const suspectedCidFontEncoding =
    stats.replacementCharRatio >= CID_REPLACEMENT_RATIO_THRESHOLD &&
    stats.charCount >= 10;

  // Table-heavy: only trigger if items are very short AND x coordinates repeat in columns
  const suspectedTableHeavy = !suspectedScanned && hasManyShortAlignedItems(stats);

  // Off-page: tiny/invisible text detection
  const suspectedHiddenOrOffPageText =
    stats.offPageItemCount > 0 ||
    (stats.tinyTextItemCount > 2 && stats.tinyTextItemCount > stats.textItemCount * 0.1);

  let layoutClass: PageDetection["layoutClass"];

  if (suspectedHiddenOrOffPageText || suspectedGarbledText || suspectedCidFontEncoding) {
    layoutClass = "suspicious";
  } else if (suspectedScanned) {
    layoutClass = "scanned_image";
  } else if (suspectedTableHeavy) {
    layoutClass = "complex_layout";
  } else {
    layoutClass = "native_text";
  }

  const { parserRecommendation, reasons } = buildRecommendation(layoutClass);

  if (suspectedCidFontEncoding) {
    reasons.push(
      `CID font encoding issue: ${(stats.replacementCharRatio * 100).toFixed(0)}% replacement chars`
    );
  }

  return {
    page: stats.pageNum,
    textItemCount: stats.textItemCount,
    charCount: stats.charCount,
    cjkCharRatio: stats.cjkCharRatio,
    whitespaceRatio: stats.whitespaceRatio,
    avgFontSize: stats.avgFontSize,
    bboxCoverageRatio: stats.bboxCoverageRatio,
    hasExtractableText: stats.hasExtractableText,
    suspectedScanned,
    suspectedGarbledText,
    suspectedTableHeavy,
    suspectedHiddenOrOffPageText,
    suspectedCidFontEncoding,
    layoutClass,
    parserRecommendation,
    reasons,
  };
}
