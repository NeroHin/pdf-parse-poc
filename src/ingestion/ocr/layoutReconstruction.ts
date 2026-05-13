import { analyzeLayout } from "esearch-ocr";
import type { Quad } from "./bboxRaster.js";

export type OcrLine = {
  text: string;
  mean: number;
  box: Quad;
};

export type ReconstructedOcrParagraph = OcrLine & {
  layoutStrategy: "esearch_paragraphs" | "two_column_legal_table" | "two_column_table";
  columnRole?: "title" | "article" | "explanation" | "left" | "right" | "unknown";
  columnIndex?: number;
  columnCount?: number;
};

type EsearchColumn = {
  outerBox: Quad;
  parragraphs?: { parse?: OcrLine }[];
};

type EsearchLayoutOutput = {
  columns?: EsearchColumn[];
  parragraphs?: OcrLine[];
};

function minX(box: Quad): number {
  return Math.min(...box.map((p) => p[0]));
}

function maxX(box: Quad): number {
  return Math.max(...box.map((p) => p[0]));
}

function minY(box: Quad): number {
  return Math.min(...box.map((p) => p[1]));
}

function centerX(box: Quad): number {
  return (minX(box) + maxX(box)) / 2;
}

function outerBox(lines: OcrLine[]): Quad {
  const xs = lines.flatMap((line) => line.box.map((p) => p[0]));
  const ys = lines.flatMap((line) => line.box.map((p) => p[1]));
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const y1 = Math.min(...ys);
  const y2 = Math.max(...ys);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function weightedMean(lines: OcrLine[]): number {
  const total = lines.reduce((sum, line) => sum + Math.max(1, line.text.length), 0);
  if (total === 0) return 0;
  return lines.reduce((sum, line) => sum + line.mean * Math.max(1, line.text.length), 0) / total;
}

function compactText(text: string): string {
  return text.replace(/\s/g, "");
}

function topTexts(lines: OcrLine[]): string[] {
  return lines.filter((line) => minY(line.box) < 240).map((line) => compactText(line.text));
}

function hasLegalTableHeaders(lines: OcrLine[]): boolean {
  const texts = topTexts(lines);
  return texts.some((text) => text.includes("條文")) && texts.some((text) => text.includes("說明"));
}

function hasGenericTwoColumnHeaders(lines: OcrLine[]): boolean {
  const topLines = lines
    .filter((line) => minY(line.box) < 240)
    .map((line) => ({ text: compactText(line.text), x: centerX(line.box) }));
  const leftHeaders = topLines.filter((line) => line.x < 420).map((line) => line.text);
  const rightHeaders = topLines.filter((line) => line.x >= 250).map((line) => line.text);
  const hasLeftHeader = leftHeaders.some((text) => /條文|規定|項目|類別|標準|內容/.test(text));
  const hasRightHeader = rightHeaders.some((text) => /說明|備註|定義|理由|日期|規定/.test(text));
  return hasLeftHeader && hasRightHeader;
}

function hasTwoColumnDistribution(lines: OcrLine[], pageWidth: number): boolean {
  const bodyLines = lines.filter((line) => line.text.trim().length >= 2 && minY(line.box) > 70);
  if (bodyLines.length < 12) return false;

  const left = bodyLines.filter((line) => centerX(line.box) < pageWidth * 0.48);
  const right = bodyLines.filter((line) => centerX(line.box) > pageWidth * 0.52);
  if (left.length < 5 || right.length < 5) return false;

  const leftMax = Math.max(...left.map((line) => maxX(line.box)));
  const rightMin = Math.min(...right.map((line) => minX(line.box)));
  return rightMin - leftMax > pageWidth * 0.01 || left.length + right.length >= bodyLines.length * 0.75;
}

function detectTwoColumnStrategy(
  lines: OcrLine[],
  pageWidth: number
): "two_column_legal_table" | "two_column_table" | null {
  if (hasLegalTableHeaders(lines)) return "two_column_legal_table";
  if (hasTwoColumnDistribution(lines, pageWidth) && hasGenericTwoColumnHeaders(lines)) return "two_column_table";
  if (hasTwoColumnDistribution(lines, pageWidth)) return "two_column_table";
  return null;
}

function roleForColumn(
  column: EsearchColumn,
  pageWidth: number,
  strategy: "two_column_legal_table" | "two_column_table"
): "article" | "explanation" | "left" | "right" | "unknown" {
  const c = centerX(column.outerBox);
  if (strategy === "two_column_legal_table") {
    if (c < pageWidth * 0.5) return "article";
    if (c >= pageWidth * 0.5) return "explanation";
  }
  if (c < pageWidth * 0.5) return "left";
  if (c >= pageWidth * 0.5) return "right";
  return "unknown";
}

function isTitleLine(line: OcrLine, pageWidth: number): boolean {
  const text = line.text.replace(/\s/g, "");
  return minY(line.box) < 145 && centerX(line.box) > pageWidth * 0.3 && centerX(line.box) < pageWidth * 0.7 && /草案|法案|文件/.test(text);
}

function isArticleStart(text: string): boolean {
  return /^第[一二三四五六七八九十百零〇○]+條/.test(text.replace(/\s/g, ""));
}

function isExplanationStart(text: string): boolean {
  return /^[一二三四五六七八九十百零〇○]+[、,，:：]/.test(text.trim());
}

function isColumnHeader(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  return /^(條文|說明|規定|備註|項目|類別|標準|內容|定義|理由|日期)$/.test(compact);
}

function joinLineTexts(lines: OcrLine[]): string {
  return lines.map((line) => line.text.trim()).join("");
}

function mergeLines(
  lines: ReconstructedOcrParagraph[],
  shouldStartNew: (text: string) => boolean
): ReconstructedOcrParagraph[] {
  const merged: ReconstructedOcrParagraph[] = [];
  let current: ReconstructedOcrParagraph[] = [];

  function flush() {
    if (current.length === 0) return;
    const first = current[0];
    merged.push({
      ...first,
      text: joinLineTexts(current),
      mean: weightedMean(current),
      box: outerBox(current),
    });
    current = [];
  }

  for (const line of lines) {
    if (isColumnHeader(line.text)) {
      flush();
      merged.push(line);
      continue;
    }
    if (shouldStartNew(line.text)) flush();
    current.push(line);
  }
  flush();
  return merged;
}

function isGenericListStart(text: string): boolean {
  const compact = text.trim();
  return (
    /^[一二三四五六七八九十百零〇○]+[、,，:：]/.test(compact) ||
    /^（[一二三四五六七八九十百零〇○]+）/.test(compact) ||
    /^\([一二三四五六七八九十百零〇○]+\)/.test(compact)
  );
}

function buildTwoColumnLayout(lines: OcrLine[], pageWidth: number, pageHeight: number): EsearchLayoutOutput {
  const leftBox: Quad = [
    [0, 0],
    [pageWidth * 0.515, 0],
    [pageWidth * 0.515, pageHeight],
    [0, pageHeight],
  ];
  const rightBox: Quad = [
    [pageWidth * 0.485, 0],
    [pageWidth, 0],
    [pageWidth, pageHeight],
    [pageWidth * 0.485, pageHeight],
  ];

  return (analyzeLayout as unknown as (src: OcrLine[], op: unknown) => EsearchLayoutOutput)(lines, {
    docDirs: [{ block: "tb", inline: "lr" }],
    columnsTip: [
      { box: leftBox, type: "auto" },
      { box: rightBox, type: "auto" },
    ],
  });
}

export function reconstructOcrParagraphs(
  ocrOutput: { src?: OcrLine[]; columns?: EsearchColumn[]; parragraphs?: OcrLine[] },
  raster: { widthPx: number; heightPx: number }
): ReconstructedOcrParagraph[] {
  const srcLines = ocrOutput.src ?? [];
  const defaultParagraphs = ocrOutput.parragraphs ?? [];
  const strategy = detectTwoColumnStrategy(srcLines, raster.widthPx);

  if (!strategy) {
    return defaultParagraphs.map((line) => ({
      ...line,
      layoutStrategy: "esearch_paragraphs",
      columnRole: "unknown",
    }));
  }

  const layout = buildTwoColumnLayout(srcLines, raster.widthPx, raster.heightPx);
  const titleLines: ReconstructedOcrParagraph[] = [];
  const leftLines: ReconstructedOcrParagraph[] = [];
  const rightLines: ReconstructedOcrParagraph[] = [];
  const unknownLines: ReconstructedOcrParagraph[] = [];
  const columns = layout.columns ?? [];

  for (const [columnIndex, column] of columns.entries()) {
    const role = roleForColumn(column, raster.widthPx, strategy);
    const paragraphs = column.parragraphs ?? [];
    for (const p of paragraphs) {
      if (!p.parse?.text?.trim()) continue;
      const parsed: ReconstructedOcrParagraph = {
        ...p.parse,
        layoutStrategy: strategy,
        columnRole: role,
        columnIndex,
        columnCount: columns.length,
      };

      if (isTitleLine(parsed, raster.widthPx)) {
        titleLines.push({ ...parsed, columnRole: "title" });
      } else if (role === "article" || role === "left") {
        leftLines.push(parsed);
      } else if (role === "explanation" || role === "right") {
        rightLines.push(parsed);
      } else {
        unknownLines.push(parsed);
      }
    }
  }

  const byPosition = (a: ReconstructedOcrParagraph, b: ReconstructedOcrParagraph) =>
    minY(a.box) - minY(b.box) || minX(a.box) - minX(b.box);

  titleLines.sort(byPosition);
  leftLines.sort(byPosition);
  rightLines.sort(byPosition);
  unknownLines.sort(byPosition);

  const leftStart = strategy === "two_column_legal_table" ? isArticleStart : isGenericListStart;
  const rightStart = strategy === "two_column_legal_table" ? isExplanationStart : isGenericListStart;
  const reconstructed = [
    ...titleLines,
    ...mergeLines(leftLines, leftStart),
    ...mergeLines(rightLines, rightStart),
    ...unknownLines,
  ];
  if (reconstructed.length === 0) {
    return defaultParagraphs.map((line) => ({
      ...line,
      layoutStrategy: "esearch_paragraphs",
      columnRole: "unknown",
    }));
  }

  return reconstructed;
}
