import type { OdlJsonItem, PageTextStats, PreflightPageInfo } from "../types.js";

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const REPLACEMENT_CHAR = "\uFFFD";
const OFF_PAGE_MARGIN = 5;

function emptyStats(info: PreflightPageInfo): PageTextStats {
  return {
    pageNum: info.num,
    pageWidth: info.width,
    pageHeight: info.height,
    textItemCount: 0,
    charCount: 0,
    cjkCharCount: 0,
    cjkCharRatio: 0,
    whitespaceCount: 0,
    whitespaceRatio: 0,
    replacementCharCount: 0,
    replacementCharRatio: 0,
    avgFontSize: null,
    bboxCoverageRatio: 0,
    hasExtractableText: false,
    offPageItemCount: 0,
    tinyTextItemCount: 0,
    xCoords: [],
    yCoords: [],
    fontSizes: [],
  };
}

export function buildOdlPageStats(
  pageInfos: PreflightPageInfo[],
  mergedOdlItems: OdlJsonItem[]
): PageTextStats[] {
  const byPage = new Map(pageInfos.map((info) => [info.num, emptyStats(info)]));

  for (const item of mergedOdlItems) {
    const pageNum = item["page number"];
    const stats = byPage.get(pageNum);
    if (!stats) continue;

    const text = item.content ?? "";
    const [left, bottom, right, top] = item["bounding box"];
    const width = Math.max(0, right - left);
    const height = Math.max(0, top - bottom);

    stats.textItemCount++;
    stats.xCoords.push(left);
    stats.yCoords.push(bottom);
    if (typeof item["font size"] === "number" && item["font size"] > 0) {
      stats.fontSizes.push(item["font size"]);
    }

    const isOffPage =
      left < -OFF_PAGE_MARGIN ||
      bottom < -OFF_PAGE_MARGIN ||
      right > stats.pageWidth + OFF_PAGE_MARGIN ||
      top > stats.pageHeight + OFF_PAGE_MARGIN;
    if (isOffPage) stats.offPageItemCount++;

    if (height > 0 && height < 2) stats.tinyTextItemCount++;

    for (const ch of text) {
      if (/\s/.test(ch)) {
        stats.whitespaceCount++;
      } else {
        stats.charCount++;
        if (CJK_REGEX.test(ch)) stats.cjkCharCount++;
        if (ch === REPLACEMENT_CHAR) stats.replacementCharCount++;
      }
    }

    const pageArea = stats.pageWidth * stats.pageHeight;
    if (pageArea > 0) {
      stats.bboxCoverageRatio = Math.min(
        1,
        stats.bboxCoverageRatio + (width * height) / pageArea
      );
    }
  }

  for (const stats of byPage.values()) {
    const totalChars = stats.charCount + stats.whitespaceCount;
    stats.whitespaceRatio = totalChars > 0 ? stats.whitespaceCount / totalChars : 0;
    stats.cjkCharRatio = stats.charCount > 0 ? stats.cjkCharCount / stats.charCount : 0;
    stats.replacementCharRatio =
      stats.charCount > 0 ? stats.replacementCharCount / stats.charCount : 0;
    stats.avgFontSize =
      stats.fontSizes.length > 0
        ? stats.fontSizes.reduce((a, b) => a + b, 0) / stats.fontSizes.length
        : null;
    stats.hasExtractableText = stats.charCount >= 10;
  }

  return [...byPage.values()].sort((a, b) => a.pageNum - b.pageNum);
}
