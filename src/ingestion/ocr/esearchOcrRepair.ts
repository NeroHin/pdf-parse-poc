import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { basename as pathBasename, join } from "node:path";
import { ImageData } from "@napi-rs/canvas";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { init } from "esearch-ocr";
import * as ort from "onnxruntime-node";
import pLimit from "p-limit";
import type { PreflightPageInfo, SourceBlock, SourceBlockProvenance } from "../types.js";
import type { OcrRepairTrigger } from "./ocrTriggers.js";
import { quadToNormalizedBbox, type Quad } from "./bboxRaster.js";
import { ensureEsearchNodeCanvasEnv } from "./nodeCanvasEnv.js";
import { rasterizePdfPagePoppler } from "./popplerRasterize.js";
import type { ResolvedOcrModels } from "./modelPaths.js";

const ESEARCH_LIB_VERSION = "esearch-ocr-8.5.0";
const MEAN_CONF_THRESHOLD = 0.55;

type OcrEngine = Awaited<ReturnType<typeof init>>;

let primaryEngine: OcrEngine | null = null;
let fallbackEngine: OcrEngine | null = null;

async function ensurePrimaryEngine(models: ResolvedOcrModels): Promise<OcrEngine> {
  if (primaryEngine) return primaryEngine;
  ensureEsearchNodeCanvasEnv();
  primaryEngine = await init({
    ort,
    det: { input: models.det },
    rec: {
      input: models.rec,
      decodeDic: models.dictText,
      optimize: { space: false },
    },
    docCls: models.docCls ? { input: models.docCls } : undefined,
    analyzeLayout: {},
    dev: false,
    log: false,
  });
  return primaryEngine;
}

async function ensureFallbackEngine(models: ResolvedOcrModels): Promise<OcrEngine | null> {
  if (!models.recFallback || !models.dictFallbackText) return null;
  if (fallbackEngine) return fallbackEngine;
  ensureEsearchNodeCanvasEnv();
  fallbackEngine = await init({
    ort,
    det: { input: models.det },
    rec: {
      input: models.recFallback,
      decodeDic: models.dictFallbackText,
      optimize: { space: true },
    },
    docCls: models.docCls ? { input: models.docCls } : undefined,
    analyzeLayout: {},
    dev: false,
    log: false,
  });
  return fallbackEngine;
}

async function pngToImageData(pngPath: string): Promise<ImageData> {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new ImageData(new Uint8ClampedArray(data), info.width, info.height);
}

async function preprocessRaster(img: ImageData): Promise<ImageData> {
  const { data, info } = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .greyscale()
    .normalize()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new ImageData(new Uint8ClampedArray(data), info.width, info.height);
}

function avgConfidence(paragraphs: { mean: number }[]): number {
  if (paragraphs.length === 0) return 0;
  return paragraphs.reduce((s, p) => s + p.mean, 0) / paragraphs.length;
}

function safeUnlink(p: string) {
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

type Para = {
  text: string;
  mean: number;
  box: Quad;
};

async function runBestEffortOcr(
  models: ResolvedOcrModels,
  pdfPath: string,
  pageNum: number,
  pageInfo: PreflightPageInfo,
  workDir: string,
  primaryDpi: number,
  fallbackDpi: number
): Promise<{
  paragraphs: Para[];
  reasons: string[];
  raster: NonNullable<SourceBlockProvenance["raster"]>;
  modelLabel: string;
}> {
  const reasons: string[] = [];
  const engine = await ensurePrimaryEngine(models);

  let usedDpi = primaryDpi;
  const prefix1 = `doc${pageNum}a`;
  const r1 = await rasterizePdfPagePoppler(pdfPath, pageNum, primaryDpi, workDir, prefix1);
  reasons.push(`poppler_raster_${primaryDpi}`);
  let img = await pngToImageData(r1.pngPath);
  safeUnlink(r1.pngPath);

  let out = await engine.ocr(img);
  let paragraphs: Para[] = (out.parragraphs ?? []) as Para[];
  let mean = avgConfidence(paragraphs);

  if (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0) {
    reasons.push("preprocess_greyscale_normalize");
    const pre = await preprocessRaster(img);
    out = await engine.ocr(pre);
    paragraphs = (out.parragraphs ?? []) as Para[];
    mean = avgConfidence(paragraphs);
    img = pre;
  }

  if (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0) {
    reasons.push(`reraster_${fallbackDpi}`);
    const prefix2 = `doc${pageNum}b`;
    const r2 = await rasterizePdfPagePoppler(pdfPath, pageNum, fallbackDpi, workDir, prefix2);
    img = await pngToImageData(r2.pngPath);
    usedDpi = fallbackDpi;
    safeUnlink(r2.pngPath);
    out = await engine.ocr(img);
    paragraphs = (out.parragraphs ?? []) as Para[];
    mean = avgConfidence(paragraphs);
  }

  const fb = await ensureFallbackEngine(models);
  if (fb && (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0)) {
    reasons.push("fallback_rec_ppocr_v4_doc");
    out = await fb.ocr(img);
    paragraphs = (out.parragraphs ?? []) as Para[];
    mean = avgConfidence(paragraphs);
  }

  const raster: NonNullable<SourceBlockProvenance["raster"]> = {
    engine: "poppler",
    dpi: usedDpi,
    widthPx: img.width,
    heightPx: img.height,
    pagePtsWidth: pageInfo.width,
    pagePtsHeight: pageInfo.height,
  };

  const modelLabel = `${ESEARCH_LIB_VERSION};det=${pathBasename(models.det)};rec=${pathBasename(models.rec)}`;

  return { paragraphs, reasons, raster, modelLabel };
}

function hashSnippet(text: string, page: number): string {
  return createHash("sha256")
    .update(`${page}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

export async function runEsearchOcrRepairForPages(options: {
  pdfPath: string;
  documentId: string;
  pageTriggers: Map<number, OcrRepairTrigger[]>;
  pageInfos: PreflightPageInfo[];
  models: ResolvedOcrModels;
  workDir: string;
  concurrency: number;
}): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  const { documentId, pageTriggers, pageInfos, models, workDir, concurrency } = options;
  const warnings: string[] = [];
  const blocks: SourceBlock[] = [];

  const dpiPrimary = Number(process.env.OCR_RASTER_DPI_PRIMARY ?? 150);
  const dpiFallback = Number(process.env.OCR_RASTER_DPI_FALLBACK ?? 220);

  const pageMap = new Map(pageInfos.map((p) => [p.num, p]));
  const limit = pLimit(Math.max(1, concurrency));

  await Promise.all(
    [...pageTriggers.entries()].map(([pageNum, triggers]) =>
      limit(async () => {
        const pageInfo = pageMap.get(pageNum);
        if (!pageInfo) return;

        try {
          const outcome = await runBestEffortOcr(
            models,
            options.pdfPath,
            pageNum,
            pageInfo,
            workDir,
            dpiPrimary,
            dpiFallback
          );

          const provBase: SourceBlockProvenance = {
            parserId: "esearch-ocr-repair",
            modelLabel: outcome.modelLabel,
            raster: outcome.raster,
            fallbackReasons: outcome.reasons,
            repairTriggers: triggers,
          };

          for (const p of outcome.paragraphs) {
            if (!p.text?.trim()) continue;
            const bbox = quadToNormalizedBbox(
              p.box,
              outcome.raster.widthPx,
              outcome.raster.heightPx,
              pageInfo.width,
              pageInfo.height
            );
            blocks.push({
              id: uuidv4(),
              documentId,
              page: pageNum,
              blockType: "paragraph",
              text: p.text.trim(),
              bbox,
              parser: "esearch-ocr-repair",
              parserVersion: ESEARCH_LIB_VERSION,
              extractionMode: "ocr",
              confidence: Math.min(0.99, Math.max(0.5, p.mean)),
              warnings: [],
              sourceHash: hashSnippet(p.text, pageNum),
              provenance: provBase,
            });
          }
        } catch (e) {
          warnings.push(
            `OCR repair 第 ${pageNum} 頁失敗: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      })
    )
  );

  blocks.sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y);

  return { blocks, warnings };
}
