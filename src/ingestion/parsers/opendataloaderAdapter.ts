import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { OdlJsonItem, SourceBlock, PreflightPageInfo } from "../types.js";
import { toNormalizedBbox } from "../normalize/bbox.js";
import {
  collapseWs,
  hasSubstantialOverlap,
} from "../normalize/textOverlap.js";

const ODL_RUNNER = fileURLToPath(new URL("./odlRunner.mjs", import.meta.url));

const JAVA_HOME =
  process.env.JAVA_HOME ||
  (existsSync("/opt/homebrew/opt/openjdk")
    ? "/opt/homebrew/opt/openjdk"
    : undefined);

const ODL_VERSION = "1.10.1";

// Excluded block types that have no meaningful text content
const SKIP_TYPES = new Set(["footer", "header", "image", "picture"]);

const ODL_TYPE_MAP: Record<string, SourceBlock["blockType"]> = {
  heading: "heading",
  paragraph: "paragraph",
  table: "table",
  list: "list",
  image: "image_ocr",
  picture: "image_ocr",
  caption: "unknown",
  formula: "unknown",
};

function mapOdlType(type: string): SourceBlock["blockType"] {
  return ODL_TYPE_MAP[type.toLowerCase()] ?? "unknown";
}

function computeSourceHash(text: string, page: number): string {
  return createHash("sha256")
    .update(`${page}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

function runOdlProcess(
  filePath: string,
  outputDir: string,
  useStructTree: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ) as Record<string, string>;
    if (JAVA_HOME) env.JAVA_HOME = JAVA_HOME;

    const args = [
      ODL_RUNNER,
      filePath,
      outputDir,
      String(useStructTree),
    ];

    const child = spawn(process.execPath, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString().slice(0, 500);
        reject(new Error(`ODL process exited with code ${code}: ${stderr}`));
      }
    });

    child.on("error", reject);
  });
}

function readOdlJson(outputDir: string, filePath: string): OdlJsonItem[] {
  const stem = basename(filePath, extname(filePath));
  const jsonPath = join(outputDir, `${stem}.json`);
  if (!existsSync(jsonPath)) return [];
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as {
    kids?: OdlJsonItem[];
  };
  return raw.kids ?? [];
}

/**
 * Stable key for matching blocks across two ODL passes.
 * Uses page + rounded bbox to handle minor float differences.
 */
function blockKey(item: OdlJsonItem): string {
  const [l, b, r, t] = item["bounding box"];
  return `${item["page number"]}_${Math.round(l)}_${Math.round(b)}_${Math.round(r)}_${Math.round(t)}`;
}

/**
 * Merge two ODL passes:
 * - Pass 1 (default): good at Q headings, misses A paragraphs
 * - Pass 2 (useStructTree): good at A paragraphs, misses Q headings
 *
 * Strategy: for each pass-1 block that is empty, check if pass-2 has a
 * block at the same bbox with content. If so, substitute it.
 * Also add pass-2 blocks that are entirely absent from pass-1 (different bbox).
 */
function mergeOdlPasses(
  pass1Items: OdlJsonItem[],
  pass2Items: OdlJsonItem[]
): OdlJsonItem[] {
  const pass2ByKey = new Map(pass2Items.map((i) => [blockKey(i), i]));
  const pass1Keys = new Set(pass1Items.map(blockKey));

  const merged: OdlJsonItem[] = [];

  for (const item of pass1Items) {
    const key = blockKey(item);
    const hasContent = !!item.content?.trim();
    const alt = pass2ByKey.get(key);

    if (!hasContent && alt?.content?.trim()) {
      // Pass-2 has content for this same bbox – use it
      merged.push({ ...alt });
    } else {
      merged.push(item);
    }
  }

  // Only add struct-only pass-2 blocks when pass-1 has gaps (empty content blocks).
  // If pass-1 already has complete coverage (no empty blocks), the struct-tree pass
  // would only produce overlapping duplicates, so we skip it entirely for that page.
  const pagesWithGaps = new Set(
    pass1Items
      .filter((i) => !i.content?.trim() && !SKIP_TYPES.has(i.type.toLowerCase()))
      .map((i) => i["page number"])
  );

  if (pagesWithGaps.size > 0) {
    const mergedTexts = merged
      .filter((i) => i.content?.trim())
      .map((i) => collapseWs(i.content!));

    for (const item of pass2Items) {
      const key = blockKey(item);
      if (pass1Keys.has(key)) continue;
      const text = item.content?.trim();
      if (!text) continue;
      // Only consider pages where pass-1 had empty blocks
      if (!pagesWithGaps.has(item["page number"])) continue;
      const norm = collapseWs(text);
      const overlapsExisting = hasSubstantialOverlap(norm, mergedTexts);
      if (!overlapsExisting) {
        merged.push(item);
        mergedTexts.push(norm);
      }
    }
  }

  // Sort merged list by page → bbox top-to-bottom (y descending = top of page)
  merged.sort((a, b) => {
    const pgDiff = a["page number"] - b["page number"];
    if (pgDiff !== 0) return pgDiff;
    // ODL bbox: [left, bottom, right, top] – higher "top" = higher on page
    return b["bounding box"][3] - a["bounding box"][3];
  });

  return merged;
}

function itemsToBlocks(
  items: OdlJsonItem[],
  pageInfoMap: Map<number, PreflightPageInfo>,
  documentId: string
): SourceBlock[] {
  const blocks: SourceBlock[] = [];

  for (const item of items) {
    const text = (item.content ?? "").trim();
    if (!text) continue;
    if (SKIP_TYPES.has(item.type.toLowerCase())) continue;

    const pageNum = item["page number"];
    const pageInfo = pageInfoMap.get(pageNum);
    if (!pageInfo) continue;

    const [left, bottom, right, top] = item["bounding box"];
    const bbox = toNormalizedBbox(
      left,
      bottom,
      right - left,
      top - bottom,
      pageInfo.width,
      pageInfo.height
    );

    // Skip if this block substantially overlaps with an already-added block on the same page
    const normalised = collapseWs(text);
    const pageExistingTexts = blocks
      .filter((b) => b.page === pageNum)
      .map((b) => collapseWs(b.text));
    if (hasSubstantialOverlap(normalised, pageExistingTexts)) continue;

    blocks.push({
      id: uuidv4(),
      documentId,
      page: pageNum,
      blockType: mapOdlType(item.type),
      text,
      bbox,
      parser: "opendataloader-default",
      parserVersion: ODL_VERSION,
      extractionMode: "native_text",
      confidence: 0.93,
      warnings: [],
      sourceHash: computeSourceHash(text, pageNum),
      provenance: {
        parserId: "opendataloader-default",
        modelLabel: `OpenDataLoader ${ODL_VERSION}`,
      },
    });
  }

  return blocks;
}

export async function runOpendataloaderAdapter(
  filePath: string,
  pageInfos: PreflightPageInfo[],
  documentId: string,
  outputDir: string
): Promise<{
  blocks: SourceBlock[];
  mergedOdlItems: OdlJsonItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (!JAVA_HOME) {
    warnings.push(
      "找不到 Java 11+ 環境（JAVA_HOME 未設定，/opt/homebrew/opt/openjdk 也不存在）。OpenDataLoader 無法執行。"
    );
    return { blocks: [], mergedOdlItems: [], warnings };
  }

  // Run two ODL passes concurrently
  const outDefault = join(outputDir, "default");
  const outStruct = join(outputDir, "struct");
  mkdirSync(outDefault, { recursive: true });
  mkdirSync(outStruct, { recursive: true });

  await Promise.all([
    runOdlProcess(filePath, outDefault, false),
    runOdlProcess(filePath, outStruct, true),
  ]);

  const pass1 = readOdlJson(outDefault, filePath);
  const pass2 = readOdlJson(outStruct, filePath);

  if (pass1.length === 0 && pass2.length === 0) {
    warnings.push("ODL 兩個 pass 均無輸出，可能 PDF 無可提取文字。");
    return { blocks: [], mergedOdlItems: [], warnings };
  }

  const merged = mergeOdlPasses(pass1, pass2);

  // Count how many blocks were filled by struct pass
  const filledByStruct = merged.filter(
    (item) =>
      !!item.content?.trim() &&
      pass2.some(
        (p2) =>
          blockKey(p2) === blockKey(item) &&
          !pass1.find(
            (p1) => blockKey(p1) === blockKey(item) && p1.content?.trim()
          )
      )
  ).length;

  if (filledByStruct > 0) {
    warnings.push(
      `ODL dual-pass: ${filledByStruct} empty block(s) filled via useStructTree pass`
    );
  }

  const pageInfoMap = new Map(pageInfos.map((p) => [p.num, p]));
  const blocks = itemsToBlocks(merged, pageInfoMap, documentId);

  return { blocks, mergedOdlItems: merged, warnings };
}

export function opendataloaderWarning(
  targetPages: number[],
  mode: string
): string {
  return `第 ${targetPages.join(", ")} 頁建議使用 OpenDataLoader (${mode}) 解析，目前 adapter 尚未接入，該頁面 blocks 可能不完整。`;
}
