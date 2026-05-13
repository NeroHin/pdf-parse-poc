import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { PdfjsPage, SourceBlock } from "../types.js";
import { toNormalizedBbox } from "./bbox.js";

const PDFJS_EXTRACT_VERSION = "0.2.1";

// Unicode ligature → constituent characters
const LIGATURE_MAP: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
};

const LIGATURE_RE = /[\uFB00-\uFB06]/g;

function normalizeText(raw: string): string {
  // Expand ligatures
  let text = raw.replace(LIGATURE_RE, (c) => LIGATURE_MAP[c] ?? c);
  // Remove U+FFFD replacement chars (CID encoding failure residue)
  text = text.replace(/\uFFFD/g, "");
  // Collapse repeated whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

type RawTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type RawTextGroup = {
  items: RawTextItem[];
  pageNum: number;
  pageWidth: number;
  pageHeight: number;
};

/**
 * Groups adjacent text items on the same approximate Y line into paragraph blocks.
 * pdf.js-extract provides x/y directly in PDF coordinate space (y from bottom-left).
 */
function groupItemsIntoBlocks(page: PdfjsPage): RawTextGroup[] {
  const LINE_GAP_THRESHOLD = 5;

  const { pageInfo, content } = page;
  if (content.length === 0) return [];

  const items: RawTextItem[] = content
    .filter((item) => item.str?.trim().length > 0 && typeof item.x === "number")
    .map((item) => ({
      str: item.str,
      x: item.x,
      y: item.y ?? 0,
      width: Math.abs(item.width ?? 0),
      height: Math.abs(item.height ?? 0),
      fontSize: Math.abs(item.height ?? 0),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x); // top to bottom (PDF y is from bottom)

  if (items.length === 0) return [];

  const groups: RawTextGroup[] = [];
  let current: RawTextItem[] = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const prev = current[current.length - 1];
    const item = items[i];
    const yDiff = Math.abs(prev.y - item.y);

    if (yDiff <= LINE_GAP_THRESHOLD) {
      current.push(item);
    } else {
      groups.push({
        items: current,
        pageNum: pageInfo.num,
        pageWidth: pageInfo.width,
        pageHeight: pageInfo.height,
      });
      current = [item];
    }
  }

  groups.push({
    items: current,
    pageNum: pageInfo.num,
    pageWidth: pageInfo.width,
    pageHeight: pageInfo.height,
  });

  return groups;
}

function computeGroupBbox(group: RawTextGroup) {
  const { items, pageWidth, pageHeight } = group;
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const maxY = Math.max(...items.map((i) => i.y + i.height));

  return toNormalizedBbox(
    minX,
    minY,
    maxX - minX,
    maxY - minY,
    pageWidth,
    pageHeight
  );
}

function inferBlockType(text: string, avgFontSize: number): SourceBlock["blockType"] {
  const trimmed = text.trim();
  if (avgFontSize >= 14) return "heading";
  if (trimmed.startsWith("•") || trimmed.startsWith("-") || /^\d+\./.test(trimmed)) {
    return "list";
  }
  return "paragraph";
}

function computeSourceHash(text: string, page: number): string {
  return createHash("sha256")
    .update(`${page}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

export function normalizePdfjsPageToBlocks(
  page: PdfjsPage,
  documentId: string
): SourceBlock[] {
  const groups = groupItemsIntoBlocks(page);

  return groups
    .map((group): SourceBlock | null => {
      const raw = group.items.map((i) => i.str).join(" ");
      const text = normalizeText(raw);
      if (text.length === 0) return null;

      const avgFontSize =
        group.items.reduce((sum, i) => sum + i.fontSize, 0) / group.items.length;
      const bbox = computeGroupBbox(group);
      const blockType = inferBlockType(text, avgFontSize);
      const sourceHash = computeSourceHash(text, group.pageNum);

      return {
        id: uuidv4(),
        documentId,
        page: group.pageNum,
        blockType,
        text,
        bbox,
        parser: "pdfjs-extract",
        parserVersion: PDFJS_EXTRACT_VERSION,
        extractionMode: "native_text",
        confidence: 0.85,
        warnings: [],
        sourceHash,
      };
    })
    .filter((b): b is SourceBlock => b !== null);
}
