import type { PdfjsPage, PageTextStats } from "../types.js";

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const REPLACEMENT_CHAR = "\uFFFD";
const TINY_FONT_THRESHOLD = 2;
const OFF_PAGE_MARGIN = 5;

function computeBboxCoverageRatio(
  items: { x: number; y: number; w: number; h: number }[],
  pageWidth: number,
  pageHeight: number
): number {
  if (items.length === 0 || pageWidth <= 0 || pageHeight <= 0) return 0;
  const totalArea = items.reduce((acc, item) => acc + item.w * item.h, 0);
  const pageArea = pageWidth * pageHeight;
  return Math.min(totalArea / pageArea, 1);
}

export function computePageStats(page: PdfjsPage): PageTextStats {
  const { pageInfo, content } = page;
  const { width: pageWidth, height: pageHeight, num: pageNum } = pageInfo;

  let charCount = 0;
  let cjkCharCount = 0;
  let whitespaceCount = 0;
  let replacementCharCount = 0;
  let offPageItemCount = 0;
  let tinyTextItemCount = 0;

  const fontSizes: number[] = [];
  const xCoords: number[] = [];
  const yCoords: number[] = [];
  const bboxItems: { x: number; y: number; w: number; h: number }[] = [];

  for (const item of content) {
    if (!item.str) continue;

    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = Math.abs(item.width ?? 0);
    const h = Math.abs(item.height ?? 0);

    for (const ch of item.str) {
      if (/\s/.test(ch)) {
        whitespaceCount++;
      } else {
        charCount++;
        if (CJK_REGEX.test(ch)) cjkCharCount++;
        if (ch === REPLACEMENT_CHAR) replacementCharCount++;
      }
    }

    if (h > 0) fontSizes.push(h);
    if (h < TINY_FONT_THRESHOLD && h > 0) tinyTextItemCount++;

    const isOffPage =
      x < -OFF_PAGE_MARGIN ||
      y < -OFF_PAGE_MARGIN ||
      x > pageWidth + OFF_PAGE_MARGIN ||
      y > pageHeight + OFF_PAGE_MARGIN;

    if (isOffPage) offPageItemCount++;

    xCoords.push(x);
    yCoords.push(y);
    bboxItems.push({ x, y, w, h });
  }

  const totalChars = charCount + whitespaceCount;
  const whitespaceRatio = totalChars > 0 ? whitespaceCount / totalChars : 0;
  const cjkCharRatio = charCount > 0 ? cjkCharCount / charCount : 0;
  const replacementCharRatio = charCount > 0 ? replacementCharCount / charCount : 0;
  const avgFontSize =
    fontSizes.length > 0
      ? fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
      : null;
  const bboxCoverageRatio = computeBboxCoverageRatio(bboxItems, pageWidth, pageHeight);
  const hasExtractableText = charCount >= 10;

  return {
    pageNum,
    pageWidth,
    pageHeight,
    textItemCount: content.length,
    charCount,
    cjkCharCount,
    cjkCharRatio,
    whitespaceCount,
    whitespaceRatio,
    replacementCharCount,
    replacementCharRatio,
    avgFontSize,
    bboxCoverageRatio,
    hasExtractableText,
    offPageItemCount,
    tinyTextItemCount,
    xCoords,
    yCoords,
    fontSizes,
  };
}
